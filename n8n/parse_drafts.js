// Pulls the {"drafts": [...]} JSON out of the model response, wherever the node put it.
const out = $input.first().json;
const code = $('Normalize Request').first().json.code;

function find(v) {
  if (v && typeof v === 'object') {
    if (Array.isArray(v.drafts)) return v.drafts;
    for (const k of Object.keys(v)) {
      const r = find(v[k]);
      if (r) return r;
    }
  } else if (typeof v === 'string' && v.includes('drafts')) {
    const s = v.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    try { return find(JSON.parse(s)); } catch (e) { return null; }
  }
  return null;
}

const drafts = find(out) || [];
return [{ json: { p_code: code, p_drafts: drafts } }];
