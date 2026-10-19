# Maya Personal AI Interviewer

A voice agent that turns a job application form (or a job posting) into answers you have reviewed and approved.
You talk to Maya on a voice call or type in the chat; she asks one question at a time, drafts what she can from your resume, and only saves what you confirm.
Nothing is ever submitted for you.

**Live demo:** https://voiceai-five-ashy.vercel.app/

Built in a day for the AI Garage Voice AI Buildathon (18 October 2026, Noida), Challenge A: Personal Interviewer.
System components and diagrams are in [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md).

## Highlights

- **Voice and text, one session:** a Bolna voice call and the browser chat share the same application state, so you can switch between them or reconnect after a dropped call and carry on.
- **Grounded drafts, visible gaps:** answers are drafted only from your resume, links and what you said; anything without a source is shown as a gap instead of being invented.
- **Review before anything counts:** every answer is confirmed, revised or skipped by you, revisions are numbered, and approval is bound to the exact revision you saw.
- **No auto-submit:** the app stops at the approval gate. Google Forms open pre-filled for you to submit yourself; other forms get a copy button.
- **Reads real forms:** Browserless renders the public page so field labels, types, required flags and choices come from the actual form.

## Tech stack

Bolna (voice agent), n8n Cloud (orchestration and form/profile agents), Groq (chat and drafting agents), Browserless (form rendering), Supabase (Postgres state and RPC rules), plain Node.js with no dependencies, deployed on Vercel.

## Quick start

Needs Node 20 or newer. No install step: there are no dependencies.

```
npm start      # node web/server.mjs, serves http://localhost:8787
npm test       # node --test web/*.test.mjs
```

Create a `.env` in the project root (values already in the environment win):

| Variable | Required | What it does |
|---|---|---|
| `BOLNA_API_KEY` | yes, for voice calls | The server mints short-lived call sessions, so the key never reaches the browser |
| `GROQ_API_KEY` | recommended | Turns on the local chat and drafting agents in `web/agents.mjs`; without it, drafting falls back to n8n |
| `GROQ_MODEL` | no | Groq model id, defaults to `openai/gpt-oss-20b` |
| `BOLNA_AGENT_ID` | no | Overrides the default Maya agent |
| `INTERVIEWER_WEBHOOK` | no | Overrides the n8n interviewer webhook URL |
| `PORT`, `HOST` | no | Defaults to `8787` on `127.0.0.1` |

The n8n workflow **Voice Interviewer API** must be active.

## Using the page

Layout: your profile on the left, Maya in the centre with two tabs (**Application form**: the answers filling in live; **Conversation**: the full transcript of every call and chat for this application), and your applications in a drawer on the right.

1. **Your profile:** upload a resume (PDF, Word or text) and add links (LinkedIn, GitHub, portfolio). The page extracts the text and hidden links in the browser, n8n reads the links and builds a reusable profile, and every application started afterwards uses it, so Maya only asks role-specific questions and real gaps. A fictional sample is in `samples/sample_resume.pdf`. Open a saved profile with `?profile=KEY`.
2. **Read the form:** paste a job form or posting link and press **Read form** (or just say the link on the call). With a profile, the form is drafted from it as soon as the link is read.
3. **Interview:** press **Start interview** for a voice call, or type in the chat. If a session is open when the call starts, Maya gets its code and carries on from where it left off. Yes/no checkboxes (such as "I agree to the terms") are answered by saying yes or no.
4. **Review and approve:** the form tab shows questions, drafts (with what they were based on), gaps, your confirmations and changes, the revision number, and the approval stamp.
5. **Use the answers:** after approval, Google Forms get an **Open pre-filled form** button (you check it and press Submit yourself); other forms get **Copy answers**.

The right drawer lists every application this browser started or opened; click one to reopen it, or **New** to start fresh.
A session can also be opened directly with `http://localhost:8787/?code=ABC123`.

### Demo form

For a compact six-field demo, run `createVoiceAIDemoForm` from [demo_application_form.gs](demo_application_form.gs) in Google Apps Script.
The first four fields (name, email, technical skills, and relevant experience) are designed to be filled from the resume.
Maya collects the final two (motivation and start date) in the interview.

## Deploying

[vercel.json](vercel.json) deploys the same server as a single Vercel function ([api/index.mjs](api/index.mjs) re-exports the handler from `web/server.mjs`), with every path rewritten to it. Set the environment variables above in the Vercel project.

## Pieces

| Path | What it is |
|---|---|
| `web/index.html` | The interview page |
| `web/server.mjs` | Local server: serves the page, mints Bolna call sessions, proxies n8n and Supabase |
| `web/chat.mjs` | Text chat coordinator: turns a typed message into the next backend action |
| `web/agents.mjs` | Groq agents: answer extraction, next-question choice, and grounded resume drafting |
| `web/conversation.mjs` | Shared helpers: transcript ordering, field priority, checkbox answers |
| `web/profile-view.js` | Profile panel rendering |
| `web/*.test.mjs` | Unit tests (`npm test`) |
| `api/` | Vercel entry point |
| `bolna/` | Maya's prompt, tool definitions, and `create_agent.py` (`--dry-run`, `--update <agent_id>`) |
| `n8n/` | Code-node sources, extraction, drafting and profile prompts, and `build_workflow.py`, which generates `workflow.sdk.ts` |
| `samples/` | Fictional resume for testing |
| `demo_application_form.gs` | Apps Script that creates the demo Google Form |

Supabase holds all state in `sessions`, `fields`, `profiles` and `events`; every rule lives in the `iv_*` Postgres functions.
AI agents only suggest answers; the Supabase RPC functions are the only place state changes.
