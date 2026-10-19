// Keep the applicant and Maya's complete saved conversation, in chronological order.
export function conversationTurns(calls) {
  return [...(Array.isArray(calls) ? calls : [])]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .flatMap((call) => Array.isArray(call.transcript) ? call.transcript : [])
    .flatMap((turn) => {
      if (!turn || typeof turn.text !== "string" || !turn.text.trim()) return [];
      const role = String(turn.role || "").toLowerCase();
      if (["user", "human", "caller", "applicant"].includes(role)) return [{ role: "user", text: turn.text }];
      if (["agent", "assistant", "bot", "ai", "maya"].includes(role)) return [{ role: "agent", text: turn.text }];
      return [];
    });
}

export function isContactField(field) {
  return /\b(email|e-mail|phone|telephone|mobile|contact|address|linkedin|portfolio)\b/i.test(`${field.label || ""} ${field.type || ""}`);
}

// A lone checkbox ("I accept the terms") is read as a choice with one option, so the
// person's yes or no answers it: yes selects the option, no skips it when it is optional.
export function checkboxAnswer(field, message) {
  if (!field || !/choice/.test(field.type || "") || !Array.isArray(field.options) || field.options.length !== 1) return null;
  const text = String(message || "").toLowerCase();
  const no = /\b(no|nope|nah|don't|dont|do not|not|decline|rather not)\b/.test(text);
  const yes = /\b(yes|yeah|yep|yup|sure|ok|okay|i do|accept|agree|consent|fine|go ahead)\b/.test(text);
  if (yes && !no) return { decision: "revise", answer: field.options[0] };
  if (no && !yes && !field.required) return { decision: "skip" };
  return null;
}

export function prioritizeForm(state) {
  if (!state?.form) return state;
  const form = state.form;
  const reopened = state.status === "revising" ? state.current : null;
  const done = (form.done || []).filter((field) => !reopened?.field_id || field.field_id !== reopened.field_id);
  const fromResume = (form.from_resume || []).filter((field) => !reopened?.field_id || field.field_id !== reopened.field_id);
  const filled = new Set([...fromResume, ...done].map((field) => field.field_id).filter(Boolean));
  const needed = (form.still_needed || []).filter((field) => !filled.has(field.field_id));
  if (reopened?.field_id && !needed.some((field) => field.field_id === reopened.field_id)) {
    needed.unshift({ field_id: reopened.field_id, label: reopened.label, type: reopened.type, options: reopened.options, required: reopened.required, hint: reopened.missing_info });
  }
  // Stable sort: role-specific questions come before routine contact details.
  needed.sort((a, b) => Number(isContactField(a)) - Number(isContactField(b)));
  return { ...state, form: { ...form, done, from_resume: fromResume, still_needed: needed } };
}
