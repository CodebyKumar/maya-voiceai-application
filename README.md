# Voice Personal Interviewer

A voice agent that turns a job application form (or a job posting) into answers you have reviewed and approved.
Nothing is ever submitted for you. Full design: [PROJECT.md](PROJECT.md). Build plan: [TODO.md](TODO.md).

## Run the interview page

```
node web/server.mjs
```

Layout: your profile on the left, Maya in the centre with two tabs (**Conversation**: the full transcript of every call for this application; **Application form**: the answers filling in live), and your applications in a drawer on the right.

Open http://localhost:8787, paste a job form or posting link and press **Read form** (or just say the link on the call), then press **Start interview**. With a profile, the form is filled from it as soon as the link is read.
If a session is open when the call starts, the agent gets its code and carries on from where it left off.
The right sidebar lists every application this browser started or opened; click one to reopen it, or **New** to start fresh.
**Your profile:** upload a resume (PDF, Word or text) and add links (LinkedIn, GitHub, portfolio). The page extracts the text and hidden links in the browser, n8n reads the links and builds a reusable profile, and every application started afterwards uses it, so the call only asks role-specific questions and real gaps. A fictional sample is in `samples/sample_resume.pdf`. Open a saved profile with `?profile=KEY`.
The right side fills in live: questions, drafts (with what they were based on), gaps, your confirmations and changes, the revision number, and the approval stamp.
After approval, Google Forms get an **Open pre-filled form** button (you check it and press Submit yourself); other forms get **Copy answers**.

Needs `BOLNA_API_KEY` in `.env` (the server mints short-lived call sessions so the key never reaches the browser) and the n8n workflow **Voice Interviewer API** to be active.
A session can also be opened directly with `http://localhost:8787/?code=ABC123`.

## Pieces

| Folder | What it is |
|---|---|
| `web/` | Interview page (`index.html`) and its local server (`server.mjs`) |
| `bolna/` | Agent prompt, tool definitions, and `create_agent.py` (`--dry-run`, `--update <agent_id>`) |
| `n8n/` | Code-node sources, extraction prompt, and `build_workflow.py`, which generates `workflow.sdk.ts` |

Supabase holds all state in `sessions`, `fields` and `events`; every rule lives in the `iv_*` Postgres functions.
