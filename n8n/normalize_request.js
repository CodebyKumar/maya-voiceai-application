// Turns a Bolna tool call (or a curl test) into one routed request.
const raw = $input.first().json;
const b = raw.body && typeof raw.body === 'object' ? raw.body : raw;

// Bolna leaves "%(name)s" in place when the model omits an optional argument, and
// "{{client_ref}}" stays literal on calls that did not pass that variable.
function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || /^%\(.*\)s$/.test(s) || /\{\{.*\}\}/.test(s) || /^(null|none|undefined)$/i.test(s)) return null;
  return s;
}

const action = (clean(b.action) || '').toLowerCase();
const code = clean(b.code ?? b.session_code) || '';
const revision = parseInt(clean(b.revision) || '', 10);

const rpc = {
  save_profile: ['iv_save_profile', { p_code: code, p_facts: clean(b.facts) || '' }],
  get_current: ['iv_get_current', { p_code: code }],
  save_decision: ['iv_save_decision', {
    p_code: code,
    p_field_id: clean(b.field_id) || '',
    p_decision: clean(b.decision) || '',
    p_answer: clean(b.answer),
  }],
  get_preview: ['iv_get_preview', { p_code: code }],
  decide: ['iv_decide', {
    p_code: code,
    p_decision: clean(b.decision) || '',
    p_revision: Number.isFinite(revision) ? revision : null,
    p_field_id: clean(b.field_id),
  }],
};

let route = 'unknown';
let fn = null;
let args = {};
let formUrl = null;
const clientRef = clean(b.client_ref);
const profileKey = clean(b.profile_key);
let resumeText = '';
let links = [];

if (action === 'start_session') {
  route = 'start';
  formUrl = clean(b.form_url ?? b.url);
  if (formUrl && !/^https?:\/\//i.test(formUrl)) formUrl = 'https://' + formUrl.replace(/\s+/g, '');
} else if (action === 'draft_answers') {
  route = 'draft';
} else if (action === 'build_profile') {
  route = 'profile';
  resumeText = typeof b.resume_text === 'string' ? b.resume_text : '';
  const raw = Array.isArray(b.links) ? b.links : String(b.links || '').split(/[\s,]+/);
  links = raw.map((l) => clean(l)).filter(Boolean);
} else if (rpc[action]) {
  route = 'rpc';
  fn = rpc[action][0];
  args = rpc[action][1];
}

return [{ json: {
  action, route, code, fn, args, form_url: formUrl, client_ref: clientRef,
  profile_key: profileKey, resume_text: resumeText, links,
} }];
