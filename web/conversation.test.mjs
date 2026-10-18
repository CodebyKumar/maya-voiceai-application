import test from "node:test";
import assert from "node:assert/strict";
import { conversationTurns, prioritizeForm } from "./conversation.mjs";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("conversation context includes all text and voice turns in order and excludes tool events", () => {
  const early = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "agent" : "user", text: `turn ${i}` }));
  const calls = [{ created_at: "2026-01-02", transcript: [{ role: "assistant", text: "Voice reply" }, { role: "tool", text: "Drafted 10 answers" }] }, { created_at: "2026-01-01", transcript: early }];
  const turns = conversationTurns(calls);
  assert.equal(turns.length, 31);
  assert.equal(turns[0].text, "turn 0");
  assert.equal(turns.at(-1).text, "Voice reply");
});

test("resume drafts and saved answers are excluded from missing fields", () => {
  const state = { form: { from_resume: [{ field_id: "email", draft: "a@example.com" }], done: [{ field_id: "phone", answer: "123" }], still_needed: [{ field_id: "email", label: "Email" }, { field_id: "phone", label: "Phone" }, { field_id: "role", label: "Why this role?" }] } };
  const result = prioritizeForm(state);
  assert.deepEqual(result.form.still_needed.map((field) => field.field_id), ["role"]);
  assert.equal(result.form.from_resume[0].draft, "a@example.com");
});

test("an explicitly reopened field can be corrected even if the previous answer is still saved", () => {
  const state = { status: "revising", current: { field_id: "city", label: "City", type: "short_text" }, form: { from_resume: [], done: [{ field_id: "city", answer: "Mumbai" }], still_needed: [] } };
  const result = prioritizeForm(state);
  assert.equal(result.form.still_needed[0].field_id, "city");
  assert.equal(result.form.done.length, 0);
});

test("voice context keeps a long form and the entire conversation as valid JSON", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const fn = html.match(/  function buildVoiceContext\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(fn);
  const fields = Array.from({ length: 54 }, (_, i) => ({ field_id: `field${i}`, label: `Question ${i}`, status: i === 53 ? "drafted" : "pending", draft: i === 53 ? "resume value" : null }));
  const turns = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "agent" : "user", text: `turn ${i} ${"x".repeat(500)}` }));
  const result = vm.runInNewContext(`${fn}; buildVoiceContext()`, { code: "ABC123", lastView: { code: "ABC123", fields, status: "reviewing" }, savedCalls: [{ created_at: "2026-01-01", transcript: turns }] });
  const context = JSON.parse(result);
  assert.equal(context.conversation.length, 40);
  assert.equal(context.conversation[0].text, turns[0].text);
  assert.equal(context.form.from_resume[0].field_id, "field53");
  assert.equal(context.form.still_needed.length, 53);
});
