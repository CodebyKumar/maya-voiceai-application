// Local server for the interview page.
//   node web/server.mjs   then open http://localhost:8787
// Serves web/ and mints short-lived Bolna web-call sessions so the Bolna key never reaches the browser.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatHandler } from "./chat.mjs";
import { createAgents } from "./agents.mjs";
import { prioritizeForm } from "./conversation.mjs";

const WEB = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 8787);

// Read BOLNA_API_KEY / BOLNA_AGENT_ID from ../.env unless already set in the environment.
const env = { ...process.env };
try {
  for (const line of readFileSync(join(WEB, "..", ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const AGENT_ID = env.BOLNA_AGENT_ID || "9cf39a81-0a80-4849-b80f-e2879e440924";
const WEBHOOK_URL = env.INTERVIEWER_WEBHOOK || "https://voiceai-kk.app.n8n.cloud/webhook/interviewer";
// Public by design (publishable key); only the iv_* functions are callable with it.
const SUPABASE_RPC = "https://pqkpwzsluzubzugpytrv.supabase.co/rest/v1/rpc/";
const SUPABASE_KEY = "sb_publishable_3vJzlPUXI89-soVAkOjZAA_gblzL0xN";
if (!env.BOLNA_API_KEY) console.warn("BOLNA_API_KEY is missing from .env: calls will fail to start");

async function callWebhook(body) {
  const r = await fetch(WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw new Error("The interview service is temporarily unavailable.");
  try { return await r.json(); } catch { throw new Error("The interview service returned an invalid response."); }
}

async function callRpc(fn, args) {
  const r = await fetch(SUPABASE_RPC + fn, {
    method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("Could not access the saved conversation.");
  return r.json();
}

// These operations are already database RPCs in the n8n workflow. Calling them
// directly avoids an extra network round trip for every voice turn.
async function voiceBackend(body) {
  if (body.action === "get_current") return callRpc("iv_get_current", { p_code: body.code });
  if (body.action === "save_profile") return callRpc("iv_save_profile", { p_code: body.code, p_facts: body.facts || "" });
  if (body.action === "save_decision") return callRpc("iv_save_decision", {
    p_code: body.code, p_field_id: body.field_id || "", p_decision: body.decision || "", p_answer: body.answer || null,
  });
  return callWebhook(body);
}

const agents = createAgents({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL, webhook: voiceBackend, rpc: callRpc });
const chat = createChatHandler({ webhook: callWebhook, rpc: callRpc, promptPath: join(WEB, "..", "bolna", "prompt.md"), agents });

async function jsonBody(req, maxSize = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) { const e = new Error("Request is too large."); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
  catch { const e = new Error("Invalid request."); e.status = 400; throw e; }
}

function sendJson(res, status, value) {
  return res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(value));
}

async function forwardJson(res, response) {
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); }
  catch { value = { ok: false, error: response.ok ? "The service returned an empty or unreadable response. Please try again." : `The service is unavailable (HTTP ${response.status}). Please try again.` }; }
  return sendJson(res, response.ok && value?.ok === false ? 502 : response.status, value);
}

async function chatMessage(req, res) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) { const error = new Error("Message is too large."); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { const error = new Error("Invalid message."); error.status = 400; throw error; }
  const result = await chat(body || {});
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(result));
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

async function mintSession(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let user_data;
  try { ({ user_data } = JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch {}
  const r = await fetch("https://api.bolna.ai/web-call/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: AGENT_ID, user_data }),
  });
  return forwardJson(res, r);
}

// Starts a session from a link pasted on the page: same n8n action the agent's start_session tool uses.
async function startFromLink(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start_session",
      form_url: String(body.form_url || ""),
      client_ref: String(body.client_ref || ""),
      profile_key: String(body.profile_key || ""),
    }),
    signal: AbortSignal.timeout(60000),
  });
  return forwardJson(res, r);
}

// Builds or updates the reusable profile from resume text (extracted in the browser) and links.
async function buildProfile(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "build_profile",
      profile_key: String(body.profile_key || ""),
      resume_text: String(body.resume_text || "").slice(0, 20000),
      links: Array.isArray(body.links) ? body.links.slice(0, 8).map(String) : [],
    }),
    signal: AbortSignal.timeout(120000),
  });
  return forwardJson(res, r);
}

// Fills the open application from the attached profile (same action the agent's draft_answers tool uses).
async function draftAnswers(req, res) {
  const body = await jsonBody(req);
  if (agents.enabled) {
    const result = await agents.draft(String(body.code || ""));
    return sendJson(res, result.ok ? 200 : 502, result);
  }
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "draft_answers", code: String(body.code || "") }),
    signal: AbortSignal.timeout(90000),
  });
  return forwardJson(res, r);
}

// Bolna keeps the transcript on the call's execution record; normalise it to [{role, text}].
function parseTranscript(raw) {
  if (Array.isArray(raw)) {
    return raw.flatMap((t) => {
      const role = String(t.role || t.speaker || "").toLowerCase();
      if (!/^(user|human|caller|applicant|assistant|agent|bot|ai|maya)$/.test(role)) return [];
      const content = t.content ?? t.text ?? t.message;
      if (typeof content !== "string" || !content.trim()) return [];
      return [{ role: /^(user|human|caller|applicant)$/.test(role) ? "user" : "agent", text: content.trim() }];
    });
  }
  const turns = [];
  for (const line of String(raw || "").split(/\n+/)) {
    const m = line.match(/^\s*(assistant|agent|bot|ai|user|human|caller)\s*:\s*(.*)$/i);
    if (m) turns.push({ role: /user|human|caller/i.test(m[1]) ? "user" : "agent", text: m[2].trim() });
    else if (line.trim() && turns.length) turns[turns.length - 1].text += " " + line.trim();
  }
  return turns.filter((t) => t.text);
}

// GET /transcript?run_id=...&code=...  Reads the call from Bolna and saves it against the application.
async function transcript(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const runId = q.get("run_id") || "";
  const code = q.get("code") || "";
  if (!/^[\w-]{8,}$/.test(runId)) return sendJson(res, 400, { ok: false, error: "Invalid call." });
  const r = await fetch(`https://api.bolna.ai/executions/${runId}`, {
    headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return res.writeHead(r.status, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, status: "unavailable" }));
  const ex = await r.json();
  const turns = parseTranscript(ex.transcript ?? ex.conversation ?? ex.messages);
  let saved = false;
  if (code && turns.length) {
    const result = await callRpc("iv_save_call", { p_code: code, p_run_id: runId, p_status: ex.status || null, p_transcript: turns });
    if (result?.ok === false) throw new Error(result.error || "Could not save the call transcript.");
    saved = true;
  }
  sendJson(res, 200, { ok: true, saved, status: ex.status || null, transcript: turns });
}

export async function handler(req, res) {
  try {
    const forwarded = new URL(req.url, "http://local");
    if (forwarded.searchParams.has("__path")) {
      const path = forwarded.searchParams.get("__path");
      forwarded.searchParams.delete("__path");
      req.url = path + (forwarded.searchParams.size ? `?${forwarded.searchParams}` : "");
    }
    if (req.method === "POST" && req.url === "/bolna-session") return await mintSession(req, res);
    if (req.method === "POST" && req.url === "/start") return await startFromLink(req, res);
    if (req.method === "POST" && req.url === "/profile") return await buildProfile(req, res);
    if (req.method === "POST" && req.url === "/draft") return await draftAnswers(req, res);
    if (req.method === "POST" && req.url === "/chat") return await chatMessage(req, res);
    if (req.method === "POST" && req.url === "/analyze") return sendJson(res, 200, await agents.analyze(await jsonBody(req)));
    if (req.method === "POST" && req.url === "/voice-turn") return sendJson(res, 200, await agents.analyze(await jsonBody(req)));
    if (req.method === "POST" && req.url === "/form-state") {
      const body = await jsonBody(req);
      const code = String(body.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return sendJson(res, 400, { ok: false, error: "Invalid application code." });
      const state = prioritizeForm(await voiceBackend({ action: "get_current", code }));
      if (!state.ok) return sendJson(res, 400, state);
      delete state.current;
      state.next_step = "Resume drafts are already filled; do not ask for those details again. Focus on form.still_needed, especially role questions. Check drafts only after the remaining questions, before final approval.";
      return sendJson(res, 200, state);
    }
    if (req.method === "GET" && req.url.startsWith("/transcript")) return await transcript(req, res);
    if (req.method === "GET" && req.url === "/health") return res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    const path = new URL(req.url, "http://x").pathname;
    const file = normalize(join(WEB, path === "/" ? "index.html" : path));
    if (!file.startsWith(WEB) || file.endsWith(".mjs")) return sendJson(res, 404, { ok: false, error: "Page not found." });
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch (e) {
    const status = e.status || (e.code === "ENOENT" ? 404 : 500);
    return sendJson(res, status, { ok: false, error: status === 404 ? "Page not found." : e.message || "Something went wrong." });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  http.createServer(handler).listen(PORT, env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1"), () => console.log(`Interview page listening on port ${PORT}`));
}
