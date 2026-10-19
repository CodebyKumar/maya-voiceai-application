import { workflow, node, trigger, switchCase, ifElse, newCredential, expr } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'Tool Call',
    parameters: { httpMethod: 'POST', path: 'interviewer', responseMode: 'responseNode', options: {} },
    position: [0, 300]
  },
  output: [{ body: { action: 'get_current', code: 'ABC123' } }]
});

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Request',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Turns a Bolna tool call (or a curl test) into one routed request.\nconst raw = $input.first().json;\nconst b = raw.body && typeof raw.body === 'object' ? raw.body : raw;\n\n// Bolna leaves \"%(name)s\" in place when the model omits an optional argument, and\n// \"{{client_ref}}\" stays literal on calls that did not pass that variable.\nfunction clean(v) {\n  if (v === undefined || v === null) return null;\n  const s = String(v).trim();\n  if (!s || /^%\\(.*\\)s$/.test(s) || /\\{\\{.*\\}\\}/.test(s) || /^(null|none|undefined)$/i.test(s)) return null;\n  return s;\n}\n\nconst action = (clean(b.action) || '').toLowerCase();\nconst code = clean(b.code ?? b.session_code) || '';\nconst revision = parseInt(clean(b.revision) || '', 10);\n\nconst rpc = {\n  save_profile: ['iv_save_profile', { p_code: code, p_facts: clean(b.facts) || '' }],\n  get_current: ['iv_get_current', { p_code: code }],\n  save_decision: ['iv_save_decision', {\n    p_code: code,\n    p_field_id: clean(b.field_id) || '',\n    p_decision: clean(b.decision) || '',\n    p_answer: clean(b.answer),\n  }],\n  get_preview: ['iv_get_preview', { p_code: code }],\n  decide: ['iv_decide', {\n    p_code: code,\n    p_decision: clean(b.decision) || '',\n    p_revision: Number.isFinite(revision) ? revision : null,\n    p_field_id: clean(b.field_id),\n  }],\n};\n\nlet route = 'unknown';\nlet fn = null;\nlet args = {};\nlet formUrl = null;\nconst clientRef = clean(b.client_ref);\nconst profileKey = clean(b.profile_key);\nlet resumeText = '';\nlet links = [];\n\nif (action === 'start_session') {\n  route = 'start';\n  formUrl = clean(b.form_url ?? b.url);\n  if (formUrl && !/^https?:\\/\\//i.test(formUrl)) formUrl = 'https://' + formUrl.replace(/\\s+/g, '');\n} else if (action === 'draft_answers') {\n  route = 'draft';\n} else if (action === 'build_profile') {\n  route = 'profile';\n  resumeText = typeof b.resume_text === 'string' ? b.resume_text : '';\n  const raw = Array.isArray(b.links) ? b.links : String(b.links || '').split(/[\\s,]+/);\n  links = raw.map((l) => clean(l)).filter(Boolean);\n} else if (rpc[action]) {\n  route = 'rpc';\n  fn = rpc[action][0];\n  args = rpc[action][1];\n}\n\nreturn [{ json: {\n  action, route, code, fn, args, form_url: formUrl, client_ref: clientRef,\n  profile_key: profileKey, resume_text: resumeText, links,\n} }];\n" },
    position: [220, 300]
  },
  output: [{ action: 'get_current', route: 'rpc', code: 'ABC123', fn: 'iv_get_current', args: { p_code: 'ABC123' }, form_url: null }]
});

const route = switchCase({
  version: 3.2,
  config: {
    name: 'Route Action',
    parameters: {
      rules: {
        values: [
          { outputKey: 'start', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.route }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'start' }], combinator: 'and' } },
          { outputKey: 'draft', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.route }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'draft' }], combinator: 'and' } },
          { outputKey: 'rpc', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.route }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'rpc' }], combinator: 'and' } }
        ]
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'unknown' }
    },
    position: [440, 300]
  }
});

const fetchForm = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Render Form (Browserless)',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: 'https://production-sfo.browserless.io/content',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpQueryAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ url: $json.form_url, gotoOptions: { waitUntil: "networkidle2", timeout: 20000 } }) }}'),
      options: { timeout: 30000, response: { response: { responseFormat: 'text', outputPropertyName: 'html' } } }
    },
    credentials: { httpQueryAuth: newCredential('Browserless') },
    position: [680, 80]
  },
  output: [{ html: '<html><title>Job Application</title></html>' }]
});

const parseForm = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Form Questions',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Reads the HTML Browserless rendered and returns the real questions on the form.\n// Google Forms: parsed exactly from FB_PUBLIC_LOAD_DATA_.\n// Any other page: input / textarea / select tags become hints, and the page is\n// compacted for the \"Extract Questions (LLM)\" step (needs_ai = true).\nconst res = $input.first().json;\nconst formUrl = $('Normalize Request').first().json.form_url;\nconst html = typeof res.html === 'string' ? res.html : '';\n\nfunction decode(s) {\n  return String(s || '')\n    .replace(/<[^>]+>/g, ' ')\n    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '\"')\n    .replace(/&#39;|&#x27;/g, \"'\").replace(/&lt;/g, '<').replace(/&gt;/g, '>')\n    .replace(/\\s+/g, ' ').trim();\n}\n\nfunction refineText(label) {\n  const l = label.toLowerCase();\n  if (/e-?mail/.test(l)) return 'email';\n  if (/phone|mobile|whatsapp|contact number/.test(l)) return 'phone';\n  if (/linkedin|github|portfolio|website|url|link/.test(l)) return 'url';\n  return 'short_text';\n}\n\n// Strips everything an LLM does not need to see the form: scripts, styles, svg,\n// layout tags and all attributes except the ones that describe a field.\nfunction compactMarkup(h) {\n  const keep = /\\s(name|id|type|for|required|placeholder|aria-label|aria-required|value|role)(=(\"[^\"]*\"|'[^']*'))?/gi;\n  return h\n    .replace(/<\\/?(div|span|section|article|p|br|hr|i|b|strong|em|small|ul|ol|li|a|img|picture|source|header|footer|nav|main|aside|figure|button|svg|path|g|use|noscript|iframe)\\b[^>]*>/gi, ' ')\n    .replace(/<(\\w+)([^>]*)>/g, (m, tag, attrs) => '<' + tag + (attrs.match(keep) || []).join('') + '>')\n    .replace(/\\s+/g, ' ')\n    .trim();\n}\n\nlet fields = [];\nlet title = null;\nlet error = null;\nlet needsAi = false;\nlet pageText = '';\nlet formMarkup = '';\n\nif (!formUrl) {\n  error = 'No form link was given';\n} else if (!html) {\n  error = (res.error && (res.error.message || res.error)) || 'The page could not be opened';\n} else {\n  const t = html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);\n  title = t ? decode(t[1]) : null;\n\n  const g = html.match(/FB_PUBLIC_LOAD_DATA_\\s*=\\s*([\\s\\S]*?);\\s*<\\/script>/);\n  if (g) {\n    try {\n      const data = JSON.parse(g[1]);\n      title = (data[1] && data[1][8]) || data[3] || title;\n      const items = (data[1] && data[1][1]) || [];\n      for (const item of items) {\n        const label = decode(item[1]);\n        const typeCode = item[3];\n        const entries = item[4];\n        if (!Array.isArray(entries) || !entries.length) continue; // section headers, images\n        const entry = entries[0];\n        const options = Array.isArray(entry[1]) ? entry[1].map(o => decode(o[0])).filter(Boolean) : [];\n        let type = 'short_text';\n        if (typeCode === 0) type = refineText(label);\n        else if (typeCode === 1) type = 'long_text';\n        else if (typeCode === 2 || typeCode === 3 || typeCode === 5) type = 'single_choice';\n        else if (typeCode === 4) type = 'multi_choice';\n        else if (typeCode === 9) type = 'date';\n        else if (typeCode === 10) type = 'short_text';\n        else type = 'unsupported';\n        fields.push({\n          field_id: 'entry.' + entry[0],\n          label: label || 'Question ' + (fields.length + 1),\n          type,\n          required: entry[2] === 1 || entry[2] === true,\n          options,\n        });\n      }\n    } catch (e) {\n      error = 'The form data could not be read';\n    }\n  } else {\n    // Any other page: the LLM step does the real extraction; the tag parse below is a hint.\n    needsAi = true;\n    const body = html\n      .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')\n      .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')\n      .replace(/<svg[\\s\\S]*?<\\/svg>/gi, ' ')\n      .replace(/<!--[\\s\\S]*?-->/g, ' ');\n    pageText = decode(body).slice(0, 12000);\n    const forms = body.match(/<form[\\s\\S]*?<\\/form>/gi);\n    formMarkup = compactMarkup(forms ? forms.join('\\n') : body).slice(0, 20000);\n\n    const labels = {};\n    for (const m of html.matchAll(/<label[^>]*for=[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)<\\/label>/gi)) {\n      labels[m[1]] = decode(m[2]);\n    }\n    const attr = (tag, name) => {\n      const m = tag.match(new RegExp(name + '\\\\s*=\\\\s*[\"\\']([^\"\\']*)[\"\\']', 'i'));\n      return m ? m[1] : null;\n    };\n    const seen = {};\n    const tags = html.match(/<(input|textarea|select)\\b[^>]*>/gi) || [];\n    for (const tag of tags) {\n      const kind = tag.match(/^<(\\w+)/)[1].toLowerCase();\n      const inputType = (attr(tag, 'type') || (kind === 'input' ? 'text' : kind)).toLowerCase();\n      if (/hidden|submit|button|reset|image|search|password|file/.test(inputType)) continue;\n      const name = attr(tag, 'name') || attr(tag, 'id');\n      if (!name) continue;\n      const id = attr(tag, 'id');\n      const label = (id && labels[id]) || attr(tag, 'aria-label') || attr(tag, 'placeholder') || name;\n      const required = /\\srequired(\\s|>|=|\\/)/i.test(tag) || attr(tag, 'aria-required') === 'true';\n      if (inputType === 'radio' || inputType === 'checkbox') {\n        const optLabel = (id && labels[id]) || attr(tag, 'value') || label;\n        if (seen[name]) { seen[name].options.push(decode(optLabel)); continue; }\n        const f = { field_id: name, label: decode(name.replace(/[_\\-.]+/g, ' ')), type: inputType === 'radio' ? 'single_choice' : 'multi_choice', required, options: [decode(optLabel)] };\n        seen[name] = f;\n        fields.push(f);\n        continue;\n      }\n      if (seen[name]) continue;\n      let type = 'short_text';\n      if (inputType === 'email') type = 'email';\n      else if (inputType === 'tel') type = 'phone';\n      else if (inputType === 'url') type = 'url';\n      else if (inputType === 'number') type = 'number';\n      else if (inputType === 'date') type = 'date';\n      else if (kind === 'textarea') type = 'long_text';\n      else if (kind === 'select') type = 'single_choice';\n      else type = refineText(label);\n      const f = { field_id: name, label: decode(label), type, required, options: [] };\n      seen[name] = f;\n      fields.push(f);\n    }\n    // Options for <select>\n    for (const m of html.matchAll(/<select\\b[^>]*name=[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)<\\/select>/gi)) {\n      if (seen[m[1]]) {\n        seen[m[1]].options = [...m[2].matchAll(/<option[^>]*>([\\s\\S]*?)<\\/option>/gi)]\n          .map(o => decode(o[1])).filter(o => o && !/^(select|choose)/i.test(o));\n      }\n    }\n  }\n\n  if (!fields.length && !error && !needsAi) {\n    error = /accounts\\.google\\.com|ServiceLogin|sign in to continue/i.test(html)\n      ? 'This form needs a login, so it cannot be read'\n      : 'No fillable questions were found on this page';\n  }\n}\n\nreturn [{ json: {\n  form_url: formUrl, form_title: title, fields, error,\n  needs_ai: needsAi && !error, page_text: pageText, form_markup: formMarkup,\n} }];\n" },
    position: [900, 80]
  },
  output: [{ form_url: 'https://example.com/form', form_title: 'Job Application', fields: [{ field_id: 'entry.1', label: 'Full name', type: 'short_text', required: true, options: [] }], error: null }]
});

const needsAi = ifElse({
  version: 2.2,
  config: {
    name: 'Needs AI Extraction?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.needs_ai }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      },
      options: {}
    },
    position: [1120, -80]
  }
});

const extractQuestions = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {
    name: 'Extract Questions (LLM)',
    parameters: {
      resource: 'text',
      operation: 'response',
      modelId: { __rl: true, mode: 'id', value: 'gpt-4o-mini' },
      responses: { values: [{ type: 'text', role: 'system', content: "You read a web page that a job applicant wants to apply through, and return the questions the applicant must answer.\n1. If the page contains an application form, list every fillable field in page order: the label as shown, its type, whether it is required, and its options. Use the field's name or id attribute as field_id when visible, otherwise a short snake_case id. Ignore search boxes, newsletter signups, cookie banners, login and password fields, and hidden fields. File uploads (resume, CV) get type unsupported. Set source to \"form\".\n2. If there is no form but the page is a job posting, create the questions an application for this job needs: full name, email, phone, then one question for each requirement, qualification or screening criterion the posting states (for example \"How many years of experience do you have with Python?\"), and why they want this role. Only use requirements that are written on the page. These questions are open: use short_text, long_text or number, never options. Set source to \"job_posting\".\n3. If the page is neither, return an empty fields list and source \"none\".\nNever invent requirements, options or fields that are not on the page.\nAllowed types: short_text, long_text, email, phone, url, number, date, single_choice, multi_choice, unsupported.\nReply with JSON only, no markdown: {\"source\":\"form\",\"form_title\":\"\",\"fields\":[{\"field_id\":\"\",\"label\":\"\",\"type\":\"short_text\",\"required\":true,\"options\":[]}]}" }, { type: 'text', role: 'user', content: expr('{{ JSON.stringify({ url: $json.form_url, page_title: $json.form_title, fields_found_by_tag_parser: $json.fields, form_markup: $json.form_markup, page_text: $json.page_text }) }}') }] },
      simplify: true,
      options: { maxTokens: 3000 }
    },
    position: [1340, -200]
  },
  output: [{ output: [{ content: [{ text: '{"source":"form","form_title":"","fields":[]}' }] }] }]
});

const cleanExtracted = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Clean Extracted Questions',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Cleans the LLM's extracted questions into the same shape the Google Forms parser returns.\nconst out = $input.first().json;\nconst page = $('Parse Form Questions').first().json;\n\nfunction find(v) {\n  if (v && typeof v === 'object') {\n    if (Array.isArray(v.fields)) return v;\n    for (const k of Object.keys(v)) {\n      const r = find(v[k]);\n      if (r) return r;\n    }\n  } else if (typeof v === 'string' && v.includes('fields')) {\n    const s = v.replace(/^```(json)?/i, '').replace(/```$/, '').trim();\n    try { return find(JSON.parse(s)); } catch (e) { return null; }\n  }\n  return null;\n}\n\nconst TYPES = ['short_text', 'long_text', 'email', 'phone', 'url', 'number', 'date', 'single_choice', 'multi_choice', 'unsupported'];\nconst result = find(out) || { fields: [] };\nconst used = {};\nconst fields = [];\n\nfor (const f of result.fields) {\n  const label = String((f && f.label) || '').trim();\n  if (!label) continue;\n  let id = String(f.field_id || '').trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);\n  while (used[id]) id += '_2';\n  used[id] = true;\n  const type = TYPES.includes(f.type) ? f.type : 'short_text';\n  const options = Array.isArray(f.options) ? f.options.map(o => String(o).trim()).filter(Boolean) : [];\n  fields.push({ field_id: id, label, type, required: f.required === true, options });\n}\n\nlet title = result.form_title || page.form_title;\nif (result.source === 'job_posting' && title) title = title + ' (questions from the job posting)';\n\nreturn [{ json: {\n  form_url: page.form_url,\n  form_title: title,\n  fields,\n  error: fields.length ? null : 'No application questions were found on this page',\n} }];\n" },
    position: [1560, -200]
  },
  output: [{ form_url: 'https://example.com/form', form_title: 'Job Application', fields: [], error: null }]
});

const createSession = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Save Session (Supabase)',
    parameters: {
      method: 'POST',
      url: 'https://pqkpwzsluzubzugpytrv.supabase.co/rest/v1/rpc/iv_create_session',
      sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: [{ name: 'apikey', value: 'sb_publishable_3vJzlPUXI89-soVAkOjZAA_gblzL0xN' }, { name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ p_form_url: $json.form_url, p_form_title: $json.form_title, p_fields: $json.fields, p_error: $json.error, p_client_ref: $("Normalize Request").first().json.client_ref }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    position: [1780, 80]
  },
  output: [{ ok: true, status: 'collecting', code: 'ABC123' }]
});

const getSession = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Load Session (Supabase)',
    parameters: {
      method: 'POST',
      url: 'https://pqkpwzsluzubzugpytrv.supabase.co/rest/v1/rpc/iv_get_view',
      sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: [{ name: 'apikey', value: 'sb_publishable_3vJzlPUXI89-soVAkOjZAA_gblzL0xN' }, { name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ p_code: $json.code }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    position: [680, 300]
  },
  output: [{ ok: true, code: 'ABC123', form_title: 'Job Application', profile: { notes: ['Name Asha Rao'] }, resume_profile: {}, fields: [] }]
});

const draftAnswers = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {
    name: 'Draft Answers (LLM)',
    parameters: {
      resource: 'text',
      operation: 'response',
      modelId: { __rl: true, mode: 'id', value: 'gpt-4o-mini' },
      responses: { values: [{ type: 'text', role: 'system', content: "You draft answers for a job application form on behalf of an applicant. Use ONLY facts from applicant_notes (what they said on the call) and resume_profile (built from their resume and links). When the two disagree, applicant_notes win. Never invent or assume anything. Questions about skills, tools, experience or past work SHOULD be drafted from resume_profile whenever it has relevant facts (roles, highlights, skills): write a short first-person answer using only those facts, and quote the resume line in evidence. If the resume shows only partial experience, draft what it supports. Only motivation and logistics questions (why this role or company, availability, start date, notice period, salary, relocation, how they heard about it) must come from applicant_notes only; if the notes do not answer them, set draft to null so the interviewer asks. For every field return: field_id; draft (the answer text, or null if unknown); evidence (a short quote with its source, like \"Resume: 3 years at Acme\" or \"Said: I love fixing broken processes\", or null); missing_info (if draft is null, a short plain question to ask the applicant, otherwise null). For single_choice fields the draft must be exactly one of the options. For multi_choice fields the draft must be options separated by commas. For email, phone and url fields copy the value exactly as given. Return one entry per field. Reply with JSON only, no markdown, shaped {\"drafts\":[{\"field_id\":\"\",\"draft\":null,\"evidence\":null,\"missing_info\":null}]}." }, { type: 'text', role: 'user', content: expr('{{ JSON.stringify({ form_title: $json.form_title, applicant_notes: ($json.profile || {}).notes || [], resume_profile: $json.resume_profile || null, fields: ($json.fields || []).map(f => ({ field_id: f.field_id, label: f.label, type: f.type, required: f.required, options: f.options })) }) }}') }] },
      simplify: true,
      options: { maxTokens: 3000 }
    },
    position: [900, 300]
  },
  output: [{ output: [{ content: [{ text: '{"drafts":[]}' }] }] }]
});

const parseDrafts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Drafts',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Pulls the {\"drafts\": [...]} JSON out of the model response, wherever the node put it.\nconst out = $input.first().json;\nconst code = $('Normalize Request').first().json.code;\n\nfunction find(v) {\n  if (v && typeof v === 'object') {\n    if (Array.isArray(v.drafts)) return v.drafts;\n    for (const k of Object.keys(v)) {\n      const r = find(v[k]);\n      if (r) return r;\n    }\n  } else if (typeof v === 'string' && v.includes('drafts')) {\n    const s = v.replace(/^```(json)?/i, '').replace(/```$/, '').trim();\n    try { return find(JSON.parse(s)); } catch (e) { return null; }\n  }\n  return null;\n}\n\nconst drafts = find(out) || [];\nreturn [{ json: { p_code: code, p_drafts: drafts } }];\n" },
    position: [1120, 300]
  },
  output: [{ p_code: 'ABC123', p_drafts: [] }]
});

const saveDrafts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Save Drafts (Supabase)',
    parameters: {
      method: 'POST',
      url: 'https://pqkpwzsluzubzugpytrv.supabase.co/rest/v1/rpc/iv_save_drafts',
      sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: [{ name: 'apikey', value: 'sb_publishable_3vJzlPUXI89-soVAkOjZAA_gblzL0xN' }, { name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json) }}'),
      options: { response: { response: { neverError: true } } }
    },
    position: [1340, 300]
  },
  output: [{ ok: true, status: 'reviewing', drafted: 3 }]
});

const callRpc = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Run State Action (Supabase)',
    parameters: {
      method: 'POST',
      url: expr('https://pqkpwzsluzubzugpytrv.supabase.co/rest/v1/rpc/{{ $json.fn }}'),
      sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: [{ name: 'apikey', value: 'sb_publishable_3vJzlPUXI89-soVAkOjZAA_gblzL0xN' }, { name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json.args) }}'),
      options: { response: { response: { neverError: true } } }
    },
    position: [680, 520]
  },
  output: [{ ok: true, status: 'reviewing' }]
});

const unknownAction = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Unknown Action',
    parameters: {
      mode: 'raw',
      jsonOutput: '{ "ok": false, "error": "unknown_action", "next_step": "Use one of: start_session, save_profile, draft_answers, get_current, save_decision, get_preview, decide." }',
      options: {}
    },
    position: [680, 720]
  },
  output: [{ ok: false, error: 'unknown_action' }]
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Reply to Agent',
    parameters: { respondWith: 'json', responseBody: expr('{{ JSON.stringify($json) }}'), options: {} },
    position: [1580, 300]
  },
  output: [{ ok: true }]
});

export default workflow('voice-interviewer-api', 'Voice Interviewer API')
  .add(webhook)
  .to(normalize)
  .to(route
    .onCase(0, fetchForm.to(parseForm.to(needsAi
      .onTrue(extractQuestions.to(cleanExtracted.to(createSession.to(respond))))
      .onFalse(createSession))))
    .onCase(1, getSession.to(draftAnswers.to(parseDrafts.to(saveDrafts.to(respond)))))
    .onCase(2, callRpc.to(respond))
    .onCase(3, unknownAction.to(respond)));
