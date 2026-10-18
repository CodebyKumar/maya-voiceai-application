// One item per link to read (max 5). Always emits at least one item so the chain
// still runs for a resume with no links; that item has url = null and is skipped later.
const req = $('Normalize Request').first().json;
const seen = {};
const items = [];

for (let raw of req.links || []) {
  let url = String(raw || '').trim().replace(/[).,;]+$/, '');
  if (!url) continue;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  // Regex, not new URL(): the n8n Code sandbox does not reliably provide URL.
  const m = url.match(/^https?:\/\/([^\/?#:]+)/i);
  if (!m) continue;
  const host = m[1].toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) continue;
  const key = url.toLowerCase().replace(/\/+$/, '');
  if (seen[key]) continue;
  seen[key] = true;
  const kind = /linkedin\.com$/.test(host) ? 'linkedin'
    : /github\.com$/.test(host) ? 'github'
    : 'website';
  items.push({ json: { url, kind } });
  if (items.length >= 5) break;
}

return items.length ? items : [{ json: { url: null, kind: 'none' } }];
