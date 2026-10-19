import test from "node:test";
import assert from "node:assert/strict";
import { createChatHandler } from "./chat.mjs";
import { fileURLToPath } from "node:url";

const promptPath = fileURLToPath(new URL("../bolna/prompt.md", import.meta.url));

function harness({ revision = 2, previous = [], model } = {}) {
  const calls = previous.length ? [{ created_at: "2026-01-01", transcript: previous }] : [];
  const actions = [];
  const rpc = async (fn, args) => {
    if (fn === "iv_get_calls") return calls;
    if (fn === "iv_save_call") {
      let row = calls.find((call) => call.run_id === args.p_run_id);
      if (!row) { row = { run_id: args.p_run_id, created_at: new Date().toISOString() }; calls.push(row); }
      row.transcript = structuredClone(args.p_transcript);
      return { ok: true };
    }
    throw new Error(`Unexpected RPC ${fn}`);
  };
  const webhook = async (body) => {
    actions.push(body);
    if (body.action === "get_current") return { ok: true, status: "previewing", revision };
    if (body.action === "chat") return { ok: true, text: model ?? JSON.stringify({ reply: "Let's review first.", actions: [] }) };
    if (body.action === "decide") return { ok: true };
    if (body.action === "get_preview") return { ok: true, revision, answers: [{ label: "Choice", answer: "A" }] };
    throw new Error(`Unexpected action ${body.action}`);
  };
  return { chat: createChatHandler({ webhook, rpc, promptPath }), calls, actions };
}

test("approval requires a saved preview of the current revision", async () => {
  const previous = [{ role: "agent", text: "Here is the complete preview (revision 2):\nChoice: A" }];
  const h = harness({ previous });
  const result = await h.chat({ code: "ABC123", message: "APPROVE" });
  assert.match(result.reply, /approved/i);
  assert.deepEqual(h.actions.find((a) => a.action === "decide"), { action: "decide", code: "ABC123", decision: "approve", revision: 2 });
  assert.equal(h.calls.at(-1).transcript.length, 2);
});

test("a stale preview cannot be approved", async () => {
  const previous = [{ role: "agent", text: "Here is the complete preview (revision 1):\nChoice: A" }];
  const h = harness({ previous, revision: 2 });
  const result = await h.chat({ code: "ABC123", message: "approve" });
  assert.match(result.reply, /changed/i);
  assert.equal(h.actions.some((a) => a.action === "decide"), false);
});

test("an approval request without a prior preview cannot approve or ask the model to approve", async () => {
  const h = harness();
  const result = await h.chat({ code: "ABC123", message: "approve" });
  assert.match(result.reply, /preview first/i);
  assert.equal(h.actions.some((a) => a.action === "decide" || a.action === "chat"), false);
});

test("model output cannot approve without the explicit confirmation path", async () => {
  const h = harness({ model: JSON.stringify({ reply: "", actions: [{ action: "decide", decision: "approve" }] }) });
  await assert.rejects(h.chat({ code: "ABC123", message: "Please go ahead" }), /took too long/);
  assert.equal(h.actions.some((a) => a.action === "decide"), false);
});

test("a greeting cannot cause the model to save an invented answer", async () => {
  const h = harness({ model: JSON.stringify({ reply: "", actions: [{ action: "save_decision", field_id: "choice", decision: "revise", answer: "A" }] }) });
  const result = await h.chat({ code: "ABC123", message: "Hi Maya, can we start?" });
  assert.match(result.reply, /application open/);
  assert.equal(h.actions.some((a) => a.action === "save_decision"), false);
});

test("a greeting cannot silently confirm a draft", async () => {
  const h = harness({ model: JSON.stringify({ reply: "", actions: [{ action: "save_decision", field_id: "choice", decision: "confirm" }] }) });
  await h.chat({ code: "ABC123", message: "Hi Maya" });
  assert.equal(h.actions.some((a) => a.action === "save_decision"), false);
});

test("the extraction agent can shorten an answer to the exact relevant words", async () => {
  let count = 0;
  const saved = [];
  const rpc = async (fn) => fn === "iv_get_calls" ? [] : { ok: true };
  const webhook = async (body) => {
    if (body.action === "get_current") return { ok: true, status: "reviewing", form: { from_resume: [], still_needed: [{ field_id: "city" }] } };
    if (body.action === "save_decision") { saved.push(body); return { ok: true }; }
    throw new Error("Unexpected webhook action");
  };
  const agents = { enabled: true, plan: async () => ({ answers: [{ field_id: "city", answer: "Pune" }] }), complete: async () => count++ ? { reply: "Got it.", actions: [] } : { actions: [{ action: "save_decision", field_id: "city", decision: "revise", answer: "I live in Pune" }] } };
  await createChatHandler({ webhook, rpc, promptPath, agents })({ code: "ABC123", message: "I live in Pune." });
  assert.equal(saved[0].answer, "Pune");
});

test("the model cannot save a choice absent from the person's message", async () => {
  const h = harness({ model: JSON.stringify({ reply: "", actions: [{ action: "save_decision", field_id: "choice", decision: "revise", answer: "A" }] }) });
  await assert.rejects(h.chat({ code: "ABC123", message: "I would like to begin the interview." }), /took too long/);
  assert.equal(h.actions.some((a) => a.action === "save_decision"), false);
});

test("the article 'a' is not evidence for selecting option A", async () => {
  const h = harness({ model: JSON.stringify({ reply: "", actions: [{ action: "save_decision", field_id: "choice", decision: "revise", answer: "A" }] }) });
  await assert.rejects(h.chat({ code: "ABC123", message: "I built a project." }), /took too long/);
  assert.equal(h.actions.some((a) => a.action === "save_decision"), false);
});

test("the model can save an answer actually stated by the person", async () => {
  let modelCalls = 0;
  const actions = [];
  const rpc = async (fn) => fn === "iv_get_calls" ? [] : { ok: true };
  const webhook = async (body) => {
    actions.push(body);
    if (body.action === "get_current") return { ok: true, status: "reviewing", revision: 0, form: { from_resume: [] } };
    if (body.action === "chat") return { ok: true, text: JSON.stringify(modelCalls++ ? { reply: "Got it, B.", actions: [] } : { reply: "", actions: [{ action: "save_decision", field_id: "choice", decision: "revise", answer: "B" }] }) };
    if (body.action === "save_decision") return { ok: true };
    throw new Error("Unexpected action");
  };
  await createChatHandler({ webhook, rpc, promptPath })({ code: "ABC123", message: "I choose B." });
  assert.ok(actions.some((a) => a.action === "save_decision" && a.answer === "B"));
});

test("decodes the live gateway's double-escaped JSON without losing quoted text", async () => {
  const output = JSON.stringify({ reply: 'You said "blue". What next?', actions: [] });
  const model = output.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const h = harness({ model });
  const result = await h.chat({ code: "ABC123", message: "Blue" });
  assert.equal(result.reply, 'You said "blue". What next?');
});

test("preview includes the exact revision and all returned answers", async () => {
  let count = 0;
  // Have the model request the real preview and let the server render it.
  const rpc = async (fn) => fn === "iv_get_calls" ? [] : { ok: true };
  const webhook = async (body) => {
    if (body.action === "get_current") return { ok: true, revision: 5, status: "reviewing" };
    if (body.action === "chat") { count++; return { ok: true, text: '{\\"reply\\":\\"\\",\\"actions\\":[{\\"action\\":\\"get_preview\\"}]}' }; }
    if (body.action === "get_preview") return { ok: true, revision: 5, answers: [{ label: "Name", answer: "Asha" }, { label: "Choice", answer: "B" }] };
    throw new Error("Unexpected action");
  };
  const result = await createChatHandler({ webhook, rpc, promptPath })({ code: "ABC123", message: "Show me the answers" });
  assert.match(result.reply, /revision 5/);
  assert.match(result.reply, /Name: Asha/);
  assert.match(result.reply, /Choice: B/);
  assert.equal(count, 1);
});

test("a yes to a lone consent checkbox saves that checkbox", async () => {
  let modelCalls = 0;
  const actions = [];
  const rpc = async (fn) => fn === "iv_get_calls" ? [] : { ok: true };
  const terms = { field_id: "termsConditions", label: "I accept the Terms and conditions", type: "multi_choice", options: ["checkbox"], required: false };
  const webhook = async (body) => {
    actions.push(body);
    if (body.action === "get_current") return { ok: true, status: "reviewing", revision: 0, form: { from_resume: [], still_needed: [terms], done: [] } };
    if (body.action === "chat") return { ok: true, text: JSON.stringify(modelCalls++ ? { reply: "Done, accepted.", actions: [] } : { reply: "", actions: [{ action: "save_decision", field_id: "termsConditions", decision: "revise", answer: "checkbox" }] }) };
    if (body.action === "save_decision") return { ok: true };
    throw new Error("Unexpected action");
  };
  await createChatHandler({ webhook, rpc, promptPath })({ code: "ABC123", message: "yes" });
  assert.ok(actions.some((a) => a.action === "save_decision" && a.field_id === "termsConditions" && a.answer === "checkbox"));
});
