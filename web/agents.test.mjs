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
    return { ok: true, json: async () => ({ choices: [{ message: { content: prompt.includes("extract application") ? '{"answers":[]}' : '{"next_question":"Where are you based?"}' } }] }) };
  };
  const result = await createAgents({ apiKey: "test", fetchImpl }).plan({ state: { form: {} }, message: "Hello" });
  assert.equal(peak, 2);
  assert.match(result.next_question, /based/);
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
