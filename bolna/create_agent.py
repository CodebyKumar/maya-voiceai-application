"""Creates (or updates) the Bolna voice agent through the Bolna v2 API.

Usage:
    python3 bolna/create_agent.py --dry-run        # print the payload, call nothing
    python3 bolna/create_agent.py                  # create the agent
    python3 bolna/create_agent.py --update <id>    # replace an existing agent's config

Reads BOLNA_API_KEY from .env in the project root. Never prints the key.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tools import tool_definitions, tool_params  # noqa: E402

AGENT_NAME = "Voice Interviewer"
# Built per call by the interview page (web/index.html, buildWelcome) from the profile and open form.
WELCOME = "{{welcome_message}}"


def load_key():
    if os.environ.get("BOLNA_API_KEY"):
        return os.environ["BOLNA_API_KEY"]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("BOLNA_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("BOLNA_API_KEY not found in .env")


def payload():
    return {
        "agent_config": {
            "agent_name": AGENT_NAME,
            "agent_welcome_message": WELCOME,
            "tasks": [{
                "task_type": "conversation",
                "toolchain": {"execution": "parallel", "pipelines": [["transcriber", "llm", "synthesizer"]]},
                "tools_config": {
                    "llm_agent": {
                        "agent_type": "simple_llm_agent",
                        "agent_flow_type": "streaming",
                        # A little warmth for natural phrasing; the backend enforces every rule.
                        "llm_config": {"provider": "openai", "model": "gpt-4.1-mini", "max_tokens": 200, "temperature": 0.6},
                    },
                    "synthesizer": {
                        "provider": "elevenlabs",
                        "provider_config": {"voice": "Angelica", "voice_id": "IkSv4tkouLJ6kYsQA7XD", "model": "eleven_turbo_v2_5"},
                        "stream": True,
                        "buffer_size": 250,
                        "audio_format": "wav",
                    },
                    "transcriber": {
                        "provider": "deepgram",
                        "model": "nova-3",
                        "language": "en",
                        "stream": True,
                        "encoding": "linear16",
                        "sampling_rate": 16000,
                        "endpointing": 200,
                    },
                    "input": {"provider": "plivo", "format": "wav"},
                    "output": {"provider": "plivo", "format": "wav"},
                    "api_tools": {"tools": tool_definitions(), "tools_params": tool_params()},
                },
                # Generous silence and call limits: drafting can take ~7s and a review takes a few minutes.
                # Two spoken words cut the agent off (a lone "yeah" does not), it waits 300 ms
                # before replying so pauses are not treated as the end of an answer, and it
                # backchannels ("mm-hmm") during long answers.
                "task_config": {
                    "call_terminate": 600,
                    "hangup_after_silence": 30,
                    "number_of_words_for_interruption": 2,
                    "incremental_delay": 300,
                    "backchanneling": True,
                    "backchanneling_message_gap": 5,
                    "backchanneling_start_delay": 5,
                    "check_if_user_online": True,
                    "trigger_user_online_message_after": 12,
                },
            }],
        },
        "agent_prompts": {"task_1": {"system_prompt": (ROOT / "bolna" / "prompt.md").read_text()}},
    }


def main():
    body = payload()
    if "--dry-run" in sys.argv:
        print(json.dumps(body, indent=2))
        return
    if "--update-tools" in sys.argv or "--tune-latency" in sys.argv:
        mode = "--update-tools" if "--update-tools" in sys.argv else "--tune-latency"
        agent_id = sys.argv[sys.argv.index(mode) + 1]
        url = f"https://api.bolna.ai/v2/agent/{agent_id}"
        get = urllib.request.Request(url, headers={"Authorization": "Bearer " + load_key()})
        with urllib.request.urlopen(get, timeout=30) as response:
            live = json.load(response)
        # PUT requires the full task configuration. Start from the live agent so its
        # voice, telephony settings and existing tools remain intact.
        fields = ("agent_name", "agent_welcome_message", "agent_type", "webhook_url", "tasks", "calling_guardrails", "webhook_headers", "webhook_config", "ingest_source_config", "call_summary_enabled", "custom_analytics", "sip_headers", "dispositions")
        config = {name: live[name] for name in fields if name in live}
        prompts = live.get("agent_prompts") or {}
        if mode == "--update-tools":
            api_tools = config["tasks"][0]["tools_config"]["api_tools"]
            new_tool = next(tool for tool in tool_definitions() if tool["name"] == "voice_turn")
            api_tools["tools"] = [tool for tool in api_tools["tools"] if tool.get("name") != "voice_turn"] + [new_tool]
            api_tools["tools_params"]["voice_turn"] = tool_params()["voice_turn"]
            api_tools["tools_params"]["get_current"]["url"] = os.environ.get("FORM_STATE_URL", tool_params()["voice_turn"]["url"].removesuffix("/voice-turn") + "/form-state")
            prompts.setdefault("task_1", {})["system_prompt"] = (ROOT / "bolna" / "prompt.md").read_text()
        else:
            config["tasks"][0]["task_config"]["incremental_delay"] = 300
            config["tasks"][0]["tools_config"]["transcriber"]["endpointing"] = 200
        body = {"agent_config": config, "agent_prompts": prompts}
        method = "PUT"
    elif "--update" in sys.argv:
        agent_id = sys.argv[sys.argv.index("--update") + 1]
        # Patch just the prompt; PUT would replace the live agent's whole configuration.
        body = {"agent_prompts": body["agent_prompts"]}
        method, url = "PATCH", f"https://api.bolna.ai/v2/agent/{agent_id}"
    else:
        method, url = "POST", "https://api.bolna.ai/v2/agent"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method=method, headers={
        "Authorization": "Bearer " + load_key(),
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(r.status, r.read().decode())
    except urllib.error.HTTPError as e:
        print(e.code, e.read().decode())
        sys.exit(1)


if __name__ == "__main__":
    main()
