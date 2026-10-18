// Reads the HTML Browserless rendered and returns the real questions on the form.
// Google Forms: parsed exactly from FB_PUBLIC_LOAD_DATA_.
// Any other page: input / textarea / select tags become hints, and the page is
// compacted for the "Extract Questions (LLM)" step (needs_ai = true).
const res = $input.first().json;
const formUrl = $('Normalize Request').first().json.form_url;
const html = typeof res.html === 'string' ? res.html : '';

function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function refineText(label) {
  const l = label.toLowerCase();
  if (/e-?mail/.test(l)) return 'email';
  if (/phone|mobile|whatsapp|contact number/.test(l)) return 'phone';
  if (/linkedin|github|portfolio|website|url|link/.test(l)) return 'url';
  return 'short_text';
}

// Strips everything an LLM does not need to see the form: scripts, styles, svg,
// layout tags and all attributes except the ones that describe a field.
function compactMarkup(h) {
  const keep = /\s(name|id|type|for|required|placeholder|aria-label|aria-required|value|role)(=("[^"]*"|'[^']*'))?/gi;
  return h
    .replace(/<\/?(div|span|section|article|p|br|hr|i|b|strong|em|small|ul|ol|li|a|img|picture|source|header|footer|nav|main|aside|figure|button|svg|path|g|use|noscript|iframe)\b[^>]*>/gi, ' ')
    .replace(/<(\w+)([^>]*)>/g, (m, tag, attrs) => '<' + tag + (attrs.match(keep) || []).join('') + '>')
    .replace(/\s+/g, ' ')
    .trim();
}

let fields = [];
let title = null;
let error = null;
let needsAi = false;
let pageText = '';
let formMarkup = '';

if (!formUrl) {
  error = 'No form link was given';
} else if (!html) {
  error = (res.error && (res.error.message || res.error)) || 'The page could not be opened';
} else {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  title = t ? decode(t[1]) : null;

  const g = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);\s*<\/script>/);
  if (g) {
    try {
      const data = JSON.parse(g[1]);
      title = (data[1] && data[1][8]) || data[3] || title;
      const items = (data[1] && data[1][1]) || [];
      for (const item of items) {
        const label = decode(item[1]);
        const typeCode = item[3];
        const entries = item[4];
        if (!Array.isArray(entries) || !entries.length) continue; // section headers, images
        const entry = entries[0];
        const options = Array.isArray(entry[1]) ? entry[1].map(o => decode(o[0])).filter(Boolean) : [];
        let type = 'short_text';
        if (typeCode === 0) type = refineText(label);
        else if (typeCode === 1) type = 'long_text';
        else if (typeCode === 2 || typeCode === 3 || typeCode === 5) type = 'single_choice';
        else if (typeCode === 4) type = 'multi_choice';
        else if (typeCode === 9) type = 'date';
        else if (typeCode === 10) type = 'short_text';
        else type = 'unsupported';
        fields.push({
          field_id: 'entry.' + entry[0],
          label: label || 'Question ' + (fields.length + 1),
          type,
          required: entry[2] === 1 || entry[2] === true,
          options,
        });
      }
    } catch (e) {
      error = 'The form data could not be read';
    }
  } else {
    // Any other page: the LLM step does the real extraction; the tag parse below is a hint.
    needsAi = true;
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    pageText = decode(body).slice(0, 12000);
    const forms = body.match(/<form[\s\S]*?<\/form>/gi);
    formMarkup = compactMarkup(forms ? forms.join('\n') : body).slice(0, 20000);

    const labels = {};
    for (const m of html.matchAll(/<label[^>]*for=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi)) {
      labels[m[1]] = decode(m[2]);
    }
    const attr = (tag, name) => {
      const m = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
      return m ? m[1] : null;
    };
    const seen = {};
    const tags = html.match(/<(input|textarea|select)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const kind = tag.match(/^<(\w+)/)[1].toLowerCase();
      const inputType = (attr(tag, 'type') || (kind === 'input' ? 'text' : kind)).toLowerCase();
      if (/hidden|submit|button|reset|image|search|password|file/.test(inputType)) continue;
      const name = attr(tag, 'name') || attr(tag, 'id');
      if (!name) continue;
      const id = attr(tag, 'id');
      const label = (id && labels[id]) || attr(tag, 'aria-label') || attr(tag, 'placeholder') || name;
      const required = /\srequired(\s|>|=|\/)/i.test(tag) || attr(tag, 'aria-required') === 'true';
      if (inputType === 'radio' || inputType === 'checkbox') {
        const optLabel = (id && labels[id]) || attr(tag, 'value') || label;
        if (seen[name]) { seen[name].options.push(decode(optLabel)); continue; }
        const f = { field_id: name, label: decode(name.replace(/[_\-.]+/g, ' ')), type: inputType === 'radio' ? 'single_choice' : 'multi_choice', required, options: [decode(optLabel)] };
        seen[name] = f;
        fields.push(f);
        continue;
      }
      if (seen[name]) continue;
      let type = 'short_text';
      if (inputType === 'email') type = 'email';
      else if (inputType === 'tel') type = 'phone';
      else if (inputType === 'url') type = 'url';
      else if (inputType === 'number') type = 'number';
      else if (inputType === 'date') type = 'date';
      else if (kind === 'textarea') type = 'long_text';
      else if (kind === 'select') type = 'single_choice';
      else type = refineText(label);
      const f = { field_id: name, label: decode(label), type, required, options: [] };
      seen[name] = f;
      fields.push(f);
    }
    // Options for <select>
    for (const m of html.matchAll(/<select\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)) {
      if (seen[m[1]]) {
        seen[m[1]].options = [...m[2].matchAll(/<option[^>]*>([\s\S]*?)<\/option>/gi)]
          .map(o => decode(o[1])).filter(o => o && !/^(select|choose)/i.test(o));
      }
    }
  }

  if (!fields.length && !error && !needsAi) {
    error = /accounts\.google\.com|ServiceLogin|sign in to continue/i.test(html)
      ? 'This form needs a login, so it cannot be read'
      : 'No fillable questions were found on this page';
  }
}

return [{ json: {
  form_url: formUrl, form_title: title, fields, error,
  needs_ai: needsAi && !error, page_text: pageText, form_markup: formMarkup,
} }];
