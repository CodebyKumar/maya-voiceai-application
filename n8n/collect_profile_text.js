// Joins the resume text with the readable text of each link, and records what could
// and could not be read (LinkedIn usually shows a login wall to logged-out visitors).
const req = $('Normalize Request').first().json;
const sources = $('Prepare Profile Sources').all();
const results = $input.all();

function pageText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const pages = [];
const report = [{ type: 'resume', status: req.resume_text ? 'read' : 'not_given' }];

sources.forEach((s, i) => {
  const { url, kind } = s.json;
  if (!url) return;
  const html = results[i] && typeof results[i].json.html === 'string' ? results[i].json.html : '';
  const text = pageText(html);
  let status = 'read';
  if (!text) status = 'unreachable';
  else if (kind === 'linkedin' && /authwall|sign in to (view|see)|join linkedin|log in or sign up/i.test(text)) status = 'login_required';
  else if (text.length < 200) status = 'nearly_empty';
  report.push({ type: kind, url, status });
  if (status === 'read') pages.push({ url, kind, text: text.slice(0, 8000) });
});

return [{ json: {
  profile_key: req.profile_key,
  resume_text: String(req.resume_text || '').slice(0, 20000),
  pages,
  sources: report,
} }];
