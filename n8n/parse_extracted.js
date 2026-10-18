// Cleans the LLM's extracted questions into the same shape the Google Forms parser returns.
const out = $input.first().json;
const page = $('Parse Form Questions').first().json;

function find(v) {
  if (v && typeof v === 'object') {
    if (Array.isArray(v.fields)) return v;
    for (const k of Object.keys(v)) {
      const r = find(v[k]);
      if (r) return r;
    }
  } else if (typeof v === 'string' && v.includes('fields')) {
    const s = v.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    try { return find(JSON.parse(s)); } catch (e) { return null; }
  }
  return null;
}

const TYPES = ['short_text', 'long_text', 'email', 'phone', 'url', 'number', 'date', 'single_choice', 'multi_choice', 'unsupported'];
const result = find(out) || { fields: [] };
const used = {};
const fields = [];

for (const f of result.fields) {
  const label = String((f && f.label) || '').trim();
  if (!label) continue;
  let id = String(f.field_id || '').trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  while (used[id]) id += '_2';
  used[id] = true;
  const type = TYPES.includes(f.type) ? f.type : 'short_text';
  const options = Array.isArray(f.options) ? f.options.map(o => String(o).trim()).filter(Boolean) : [];
  fields.push({ field_id: id, label, type, required: f.required === true, options });
}

let title = result.form_title || page.form_title;
if (result.source === 'job_posting' && title) title = title + ' (questions from the job posting)';

return [{ json: {
  form_url: page.form_url,
  form_title: title,
  fields,
  error: fields.length ? null : 'No application questions were found on this page',
} }];
