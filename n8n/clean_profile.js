// Normalises the LLM's profile JSON and pairs it with the source report for saving.
const out = $input.first().json;
const collected = $('Collect Profile Text').first().json;

function find(v) {
  if (v && typeof v === 'object') {
    if (!Array.isArray(v) && ('name' in v || 'skills' in v || 'experience' in v)) return v;
    for (const k of Object.keys(v)) {
      const r = find(v[k]);
      if (r) return r;
    }
  } else if (typeof v === 'string' && v.includes('{')) {
    const s = v.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    try { return find(JSON.parse(s)); } catch (e) { return null; }
  }
  return null;
}

const p = find(out) || {};
const str = (v) => (v == null ? '' : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : []);

const data = {
  name: str(p.name),
  email: str(p.email),
  phone: str(p.phone),
  location: str(p.location),
  headline: str(p.headline),
  current_role: str(p.current_role),
  current_company: str(p.current_company),
  total_years_experience: Number.isFinite(Number(p.total_years_experience)) && p.total_years_experience !== null && p.total_years_experience !== ''
    ? Number(p.total_years_experience) : null,
  skills: list(p.skills).map(str).filter(Boolean).slice(0, 40),
  experience: list(p.experience).slice(0, 12).map((e) => ({
    title: str(e && e.title), company: str(e && e.company), start: str(e && e.start), end: str(e && e.end),
    highlights: list(e && e.highlights).map(str).filter(Boolean).slice(0, 6),
  })),
  education: list(p.education).slice(0, 6).map((e) => ({
    degree: str(e && e.degree), institution: str(e && e.institution), year: str(e && e.year),
  })),
  links: {
    linkedin: str(p.links && p.links.linkedin),
    github: str(p.links && p.links.github),
    portfolio: str(p.links && p.links.portfolio),
    other: list(p.links && p.links.other).map(str).filter(Boolean).slice(0, 6),
  },
  achievements: list(p.achievements).map(str).filter(Boolean).slice(0, 10),
  summary: str(p.summary),
};

// Keep every link the person gave, even ones that could not be read (LinkedIn login wall).
for (const src of collected.sources || []) {
  if (!src.url) continue;
  if (src.type === 'linkedin' && !data.links.linkedin) data.links.linkedin = src.url;
  else if (src.type === 'github' && !data.links.github) data.links.github = src.url;
  else if (src.type === 'website' && !data.links.portfolio) data.links.portfolio = src.url;
  else if (![data.links.linkedin, data.links.github, data.links.portfolio, ...data.links.other].includes(src.url)) data.links.other.push(src.url);
}

const empty = !data.name && !data.email && !data.skills.length && !data.experience.length;

return [{ json: {
  p_key: collected.profile_key || null,
  p_data: data,
  p_sources: collected.sources,
  empty,
} }];
