"""Generates n8n/workflow.sdk.ts (n8n Workflow SDK code) from the Code-node JS files.

Run: python3 n8n/build_workflow.py
The JS files are embedded with json.dumps so regex backslashes survive unchanged.
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
SUPABASE_RPC = "https://pqkpwzsluzubzugpytrv.supabase.co/rest/v1/rpc/"
# Publishable key: designed to be public; only the iv_* API functions are granted to it.
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3vJzlPUXI89-soVAkOjZAA_gblzL0xN"
# n8n gateway credits rejected gpt-4.1-mini and the json_object text format; gpt-4o-mini works.
LLM_MODEL = "gpt-4o-mini"

EXTRACT_INSTRUCTIONS = (HERE / "extract_instructions.txt").read_text().strip()

DRAFT_INSTRUCTIONS = (HERE / "draft_instructions.txt").read_text().strip()


def js(name):
    return json.dumps((HERE / name).read_text())


def rpc_headers():
    return (
        "sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: ["
        f"{{ name: 'apikey', value: '{SUPABASE_PUBLISHABLE_KEY}' }}, "
        "{ name: 'Content-Type', value: 'application/json' }] }"
    )


code = f"""import {{ workflow, node, trigger, switchCase, ifElse, newCredential, expr }} from '@n8n/workflow-sdk';

const webhook = trigger({{
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {{
    name: 'Tool Call',
    parameters: {{ httpMethod: 'POST', path: 'interviewer', responseMode: 'responseNode', options: {{}} }},
    position: [0, 300]
  }},
  output: [{{ body: {{ action: 'get_current', code: 'ABC123' }} }}]
}});

const normalize = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{
    name: 'Normalize Request',
    parameters: {{ mode: 'runOnceForAllItems', language: 'javaScript', jsCode: {js('normalize_request.js')} }},
    position: [220, 300]
  }},
  output: [{{ action: 'get_current', route: 'rpc', code: 'ABC123', fn: 'iv_get_current', args: {{ p_code: 'ABC123' }}, form_url: null }}]
}});

const route = switchCase({{
  version: 3.2,
  config: {{
    name: 'Route Action',
    parameters: {{
      rules: {{
        values: [
          {{ outputKey: 'start', conditions: {{ options: {{ caseSensitive: true, leftValue: '', typeValidation: 'strict' }}, conditions: [{{ leftValue: expr('{{{{ $json.route }}}}'), operator: {{ type: 'string', operation: 'equals' }}, rightValue: 'start' }}], combinator: 'and' }} }},
          {{ outputKey: 'draft', conditions: {{ options: {{ caseSensitive: true, leftValue: '', typeValidation: 'strict' }}, conditions: [{{ leftValue: expr('{{{{ $json.route }}}}'), operator: {{ type: 'string', operation: 'equals' }}, rightValue: 'draft' }}], combinator: 'and' }} }},
          {{ outputKey: 'rpc', conditions: {{ options: {{ caseSensitive: true, leftValue: '', typeValidation: 'strict' }}, conditions: [{{ leftValue: expr('{{{{ $json.route }}}}'), operator: {{ type: 'string', operation: 'equals' }}, rightValue: 'rpc' }}], combinator: 'and' }} }}
        ]
      }},
      options: {{ fallbackOutput: 'extra', renameFallbackOutput: 'unknown' }}
    }},
    position: [440, 300]
  }}
}});

const fetchForm = node({{
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {{
    name: 'Render Form (Browserless)',
    onError: 'continueRegularOutput',
    parameters: {{
      method: 'POST',
      url: 'https://production-sfo.browserless.io/content',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpQueryAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{{{ JSON.stringify({{ url: $json.form_url, gotoOptions: {{ waitUntil: "networkidle2", timeout: 20000 }} }}) }}}}'),
      options: {{ timeout: 30000, response: {{ response: {{ responseFormat: 'text', outputPropertyName: 'html' }} }} }}
    }},
    credentials: {{ httpQueryAuth: newCredential('Browserless') }},
    position: [680, 80]
  }},
  output: [{{ html: '<html><title>Job Application</title></html>' }}]
}});

const parseForm = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{
    name: 'Parse Form Questions',
    parameters: {{ mode: 'runOnceForAllItems', language: 'javaScript', jsCode: {js('parse_form.js')} }},
    position: [900, 80]
  }},
  output: [{{ form_url: 'https://example.com/form', form_title: 'Job Application', fields: [{{ field_id: 'entry.1', label: 'Full name', type: 'short_text', required: true, options: [] }}], error: null }}]
}});

const needsAi = ifElse({{
  version: 2.2,
  config: {{
    name: 'Needs AI Extraction?',
    parameters: {{
      conditions: {{
        options: {{ caseSensitive: true, leftValue: '', typeValidation: 'loose' }},
        conditions: [{{ leftValue: expr('{{{{ $json.needs_ai }}}}'), rightValue: '', operator: {{ type: 'boolean', operation: 'true', singleValue: true }} }}],
        combinator: 'and'
      }},
      options: {{}}
    }},
    position: [1120, -80]
  }}
}});

const extractQuestions = node({{
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {{
    name: 'Extract Questions (LLM)',
    parameters: {{
      resource: 'text',
      operation: 'response',
      modelId: {{ __rl: true, mode: 'id', value: '{LLM_MODEL}' }},
      responses: {{ values: [{{ type: 'text', role: 'system', content: {json.dumps(EXTRACT_INSTRUCTIONS)} }}, {{ type: 'text', role: 'user', content: expr('{{{{ JSON.stringify({{ url: $json.form_url, page_title: $json.form_title, fields_found_by_tag_parser: $json.fields, form_markup: $json.form_markup, page_text: $json.page_text }}) }}}}') }}] }},
      simplify: true,
      options: {{ maxTokens: 3000 }}
    }},
    position: [1340, -200]
  }},
  output: [{{ output: [{{ content: [{{ text: '{{"source":"form","form_title":"","fields":[]}}' }}] }}] }}]
}});

const cleanExtracted = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{
    name: 'Clean Extracted Questions',
    parameters: {{ mode: 'runOnceForAllItems', language: 'javaScript', jsCode: {js('parse_extracted.js')} }},
    position: [1560, -200]
  }},
  output: [{{ form_url: 'https://example.com/form', form_title: 'Job Application', fields: [], error: null }}]
}});

const createSession = node({{
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {{
    name: 'Save Session (Supabase)',
    parameters: {{
      method: 'POST',
      url: '{SUPABASE_RPC}iv_create_session',
      {rpc_headers()},
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{{{ JSON.stringify({{ p_form_url: $json.form_url, p_form_title: $json.form_title, p_fields: $json.fields, p_error: $json.error, p_client_ref: $("Normalize Request").first().json.client_ref }}) }}}}'),
      options: {{ response: {{ response: {{ neverError: true }} }} }}
    }},
    position: [1780, 80]
  }},
  output: [{{ ok: true, status: 'collecting', code: 'ABC123' }}]
}});

const getSession = node({{
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {{
    name: 'Load Session (Supabase)',
    parameters: {{
      method: 'POST',
      url: '{SUPABASE_RPC}iv_get_view',
      {rpc_headers()},
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{{{ JSON.stringify({{ p_code: $json.code }}) }}}}'),
      options: {{ response: {{ response: {{ neverError: true }} }} }}
    }},
    position: [680, 300]
  }},
  output: [{{ ok: true, code: 'ABC123', form_title: 'Job Application', profile: {{ notes: ['Name Asha Rao'] }}, resume_profile: {{}}, fields: [] }}]
}});

const draftAnswers = node({{
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {{
    name: 'Draft Answers (LLM)',
    parameters: {{
      resource: 'text',
      operation: 'response',
      modelId: {{ __rl: true, mode: 'id', value: '{LLM_MODEL}' }},
      responses: {{ values: [{{ type: 'text', role: 'system', content: {json.dumps(DRAFT_INSTRUCTIONS)} }}, {{ type: 'text', role: 'user', content: expr('{{{{ JSON.stringify({{ form_title: $json.form_title, applicant_notes: ($json.profile || {{}}).notes || [], resume_profile: $json.resume_profile || null, fields: ($json.fields || []).map(f => ({{ field_id: f.field_id, label: f.label, type: f.type, required: f.required, options: f.options }})) }}) }}}}') }}] }},
      simplify: true,
      options: {{ maxTokens: 3000 }}
    }},
    position: [900, 300]
  }},
  output: [{{ output: [{{ content: [{{ text: '{{"drafts":[]}}' }}] }}] }}]
}});

const parseDrafts = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{
    name: 'Parse Drafts',
    parameters: {{ mode: 'runOnceForAllItems', language: 'javaScript', jsCode: {js('parse_drafts.js')} }},
    position: [1120, 300]
  }},
  output: [{{ p_code: 'ABC123', p_drafts: [] }}]
}});

const saveDrafts = node({{
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {{
    name: 'Save Drafts (Supabase)',
    parameters: {{
      method: 'POST',
      url: '{SUPABASE_RPC}iv_save_drafts',
      {rpc_headers()},
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{{{ JSON.stringify($json) }}}}'),
      options: {{ response: {{ response: {{ neverError: true }} }} }}
    }},
    position: [1340, 300]
  }},
  output: [{{ ok: true, status: 'reviewing', drafted: 3 }}]
}});

const callRpc = node({{
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {{
    name: 'Run State Action (Supabase)',
    parameters: {{
      method: 'POST',
      url: expr('{SUPABASE_RPC}{{{{ $json.fn }}}}'),
      {rpc_headers()},
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{{{ JSON.stringify($json.args) }}}}'),
      options: {{ response: {{ response: {{ neverError: true }} }} }}
    }},
    position: [680, 520]
  }},
  output: [{{ ok: true, status: 'reviewing' }}]
}});

const unknownAction = node({{
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {{
    name: 'Unknown Action',
    parameters: {{
      mode: 'raw',
      jsonOutput: '{{ "ok": false, "error": "unknown_action", "next_step": "Use one of: start_session, save_profile, draft_answers, get_current, save_decision, get_preview, decide." }}',
      options: {{}}
    }},
    position: [680, 720]
  }},
  output: [{{ ok: false, error: 'unknown_action' }}]
}});

const respond = node({{
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {{
    name: 'Reply to Agent',
    parameters: {{ respondWith: 'json', responseBody: expr('{{{{ JSON.stringify($json) }}}}'), options: {{}} }},
    position: [1580, 300]
  }},
  output: [{{ ok: true }}]
}});

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
"""

(HERE / "workflow.sdk.ts").write_text(code)
print("wrote", HERE / "workflow.sdk.ts", len(code), "chars")
