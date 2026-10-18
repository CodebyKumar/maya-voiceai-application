import test from "node:test";
import assert from "node:assert/strict";
import { createAgents } from "./agents.mjs";

test("the extractor and interview coordinator run concurrently", async () => {
  let active = 0, peak = 0;
  const fetchImpl = async (_url, options) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    const prompt = JSON.parse(options.body).messages[0].content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: prompt.includes("extract application") ? '{"answers":[]}' : '{"field_id":"city","next_question":"Where are you based?"}' } }] }) };
  };
  const result = await createAgents({ apiKey: "test", fetchImpl }).plan({ state: { form: { still_needed: [{ field_id: "city", label: "City" }] } }, message: "Hello" });
  assert.equal(peak, 2);
  assert.match(result.next_question, /based/);
});

test("the coordinator cannot choose a resume-filled email over a missing role question", async () => {
  const prompts = [];
  const fetchImpl = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const prompt = payload.messages[0].content;
    prompts.push(JSON.parse(payload.messages[1].content));
    const content = prompt.includes("extract application") ? '{"answers":[]}' : '{"field_id":"email","next_question":"What is your email?"}';
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  const form = { from_resume: [{ field_id: "email", label: "Email", draft: "asha@example.com" }], done: [], still_needed: [{ field_id: "email", label: "Email" }, { field_id: "role", label: "Why this role?", hint: "What interests you about this role?" }] };
  const result = await createAgents({ apiKey: "test", fetchImpl }).plan({ state: { form }, message: "Let's continue" });
  assert.equal(result.next_question, "What interests you about this role?");
  assert.deepEqual(prompts[1].form.still_needed.map((f) => f.field_id), ["role"]);
});

test("the form agent refuses an answer absent from the user's words", async () => {
  const actions = [];
  const state = { ok: true, status: "reviewing", form: { still_needed: [{ field_id: "city", label: "City" }], from_resume: [] } };
  const webhook = async (body) => { actions.push(body); return body.action === "get_current" ? state : { ok: true }; };
  const fetchImpl = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    const content = prompt.includes("extract application") ? '{"answers":[{"field_id":"city","answer":"Pune"}]}' : '{"next_question":"Where are you based?"}';
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  const result = await createAgents({ apiKey: "test", webhook, fetchImpl }).analyze({ code: "ABC123", message: "I live in Delhi." });
  assert.equal(result.saved, 0);
  assert.equal(actions.some((action) => action.action === "save_decision"), false);
});

test("the interview gateway can respond when Groq is rate limited", async () => {
  const webhook = async (body) => {
    assert.equal(body.action, "chat");
    return { ok: true, text: '{\\"next_question\\":\\"Where are you based?\\"}' };
  };
  const fetchImpl = async () => ({ ok: false, status: 429 });
  const result = await createAgents({ apiKey: "test", webhook, fetchImpl }).complete("Return JSON", {});
  assert.equal(result.next_question, "Where are you based?");
});

test("after saving an answer the voice agent is directed to a remaining question", async () => {
  const question = { field_id: "city", label: "City", hint: "Where are you based?" };
  const next = { field_id: "role", label: "Motivation", hint: "Why this role?" };
  let answered = false, modelHistory;
  const webhook = async (body) => {
    if (body.action === "get_current") return { ok: true, status: "reviewing", form: { from_resume: [], done: answered ? [question] : [], still_needed: answered ? [next] : [question, next] } };
    if (body.action === "save_decision") { answered = true; return { ok: true }; }
    throw new Error("Unexpected action");
  };
  const rpc = async () => [{ created_at: "2026-01-01", transcript: [{ role: "user", text: "Earlier detail" }, { role: "agent", text: "Earlier question" }] }];
  const fetchImpl = async (_url, options) => {
    const payload = JSON.parse(options.body);
    modelHistory = JSON.parse(payload.messages[1].content).conversation;
    const content = payload.messages[0].content.includes("extract application") ? '{"answers":[{"field_id":"city","answer":"Pune"}]}' : '{"field_id":"city","next_question":"Where are you based?"}';
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  const result = await createAgents({ apiKey: "test", webhook, rpc, fetchImpl }).analyze({ code: "ABC123", message: "Pune" });
  assert.equal(result.saved, 1);
  assert.equal(result.next_question, "Why this role?");
  assert.equal(modelHistory[0].text, "Earlier detail");
});

test("voice turns fetch state and history concurrently and avoid a second state read when nothing was saved", async () => {
  let active = 0, peak = 0, reads = 0;
  const getData = async (value) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return value;
  };
  const webhook = async ({ action }) => {
    assert.equal(action, "get_current"); reads++;
    return getData({ ok: true, status: "reviewing", form: { still_needed: [{ field_id: "role", label: "Role" }] } });
  };
  const rpc = async () => getData([]);
  const modelOptions = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    modelOptions.push(body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: body.messages[0].content.includes("extract application") ? '{"answers":[]}' : '{"field_id":"role","next_question":"What interests you?"}' } }] }) };
  };
  const result = await createAgents({ apiKey: "test", webhook, rpc, fetchImpl }).analyze({ code: "ABC123", message: "Tell me more." });
  assert.equal(result.next_question, "What interests you?");
  assert.equal(reads, 1);
  assert.equal(peak, 2);
  assert.equal(modelOptions.length, 2);
  assert.ok(modelOptions.every((options) => options.reasoning_effort === "low"));
});
