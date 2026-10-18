"""Bolna custom function definitions for the voice interviewer.

Every tool POSTs to the same n8n webhook with a fixed `action`; n8n routes it.
Used by create_agent.py, and printable as JSON for pasting into the dashboard:
    python3 bolna/tools.py
"""
import json
import os

WEBHOOK_URL = "https://voiceai-kk.app.n8n.cloud/webhook/interviewer"

CODE = {"type": "string", "description": "The 6 character session code, letters and digits, e.g. 7UJ3DZ"}
FIELD_ID = {"type": "string", "description": "The exact field_id from the backend form state; any open field may be answered"}

# name -> (description, pre_call_message, properties, required)
TOOLS = {
    "voice_turn": (
        "Send the applicant's exact words to the form and interview agents, then get the updated form and a suggested next question. Use after each substantive user turn.",
        "",
        {"code": CODE, "message": {"type": "string", "description": "Exactly what the applicant just said"}, "previous_question": {"type": "string", "description": "The question you just asked, if any"}},
        ["code", "message"],
    ),
    "start_session": (
        "Start a new application session from a public link: a job application form (Google Forms, Lever, any HTML form) or a job posting page. Call this as soon as the person gives a URL.",
        "Let me open that page and read the questions. This can take a few seconds.",
        {
            "form_url": {"type": "string", "description": "The full public form URL the person gave"},
            # Filled by Bolna from the call variable {{client_ref}}; links the web panel to this session.
            "client_ref": {"type": "string", "description": "The browser session reference from the system prompt. Never ask the person for it."},
            # Filled by Bolna from {{profile_key}}: attaches the saved resume profile to the new session.
            "profile_key": {"type": "string", "description": "The saved profile key from the system prompt, if any. Never ask the person for it."},
        },
        ["form_url"],
    ),
    "save_profile": (
        "Save facts the person just told you about themselves (name, contact details, experience, motivation). Call after each answer during fact gathering.",
        "",
        {"code": CODE, "facts": {"type": "string", "description": "What the person said, in their own words"}},
        ["code", "facts"],
    ),
    "draft_answers": (
        "Draft answers for every form question from the saved facts. Call once you have gathered the main facts.",
        "Give me a moment to draft your answers.",
        {"code": CODE},
        ["code"],
    ),
    "get_current": (
        "Get the session and full form state, including resume drafts, missing information and answered fields. Use this to resume or check progress.",
        "",
        {"code": CODE},
        ["code"],
    ),
    "save_decision": (
        "Save the person's decision on any open question: confirm an accepted draft, revise it with their answer, or skip it. To change an already answered question, reopen it first with decide(revise).",
        "",
        {
            "code": CODE,
            "field_id": FIELD_ID,
            "decision": {"type": "string", "enum": ["confirm", "revise", "skip"], "description": "confirm, revise or skip"},
            "answer": {"type": "string", "description": "The new answer, only when decision is revise"},
        },
        ["code", "field_id", "decision"],
    ),
    "get_preview": (
        "Get every saved answer and the current revision number, to read back before approval.",
        "",
        {"code": CODE},
        ["code"],
    ),
    "decide": (
        "Record the final decision after reading the preview: approve the exact revision, revise one question, or cancel. Only approve after the person clearly says approve.",
        "",
        {
            "code": CODE,
            "decision": {"type": "string", "enum": ["approve", "revise", "cancel"], "description": "approve, revise or cancel"},
            "revision": {"type": "integer", "description": "The revision number from the latest get_preview, required to approve"},
            "field_id": {"type": "string", "description": "Only for revise: the field_id of the question to change"},
        },
        ["code", "decision"],
    ),
}


def tool_definitions():
    """The `tools` list Bolna passes to the LLM."""
    out = []
    for name, (desc, pre, props, req) in TOOLS.items():
        t = {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": props, "required": req},
            "key": "custom_task",
        }
        if pre:
            t["pre_call_message"] = pre
        out.append(t)
    return out


def tool_params():
    """The `tools_params` map: how Bolna calls the webhook for each tool."""
    params = {}
    for name, (_, _, props, _) in TOOLS.items():
        body = {"action": name}
        # Always %s: n8n parses numbers itself, and %i fails on a missing optional value.
        for p in props:
            body[p] = "%(" + p + ")s"
        url = os.environ.get("VOICE_TURN_URL", "https://voiceai-five-ashy.vercel.app/voice-turn") if name == "voice_turn" else WEBHOOK_URL
        params[name] = {"method": "POST", "url": url, "api_token": None, "param": json.dumps(body)}
    return params


def dashboard_functions():
    """One JSON object per tool in the dashboard's custom function format."""
    out = []
    params = tool_params()
    for t in tool_definitions():
        p = params[t["name"]]
        out.append({**t, "value": {"method": "POST", "url": p["url"], "param": json.loads(p["param"]), "headers": {}}})
    return out


if __name__ == "__main__":
    print(json.dumps(dashboard_functions(), indent=2))
