# Voice Interviewer - 1 hour build plan

Tick as we go. Owner: **You** = in a dashboard, **Claude** = via MCP / files. See [PROJECT.md](PROJECT.md) for details.

## 0:00-0:08 Setup (you, in parallel with Claude's schema work)
- [x] You: Browserless token -> n8n credential on node "Render Form (Browserless)"
- [x] ~~Supabase key in n8n~~ not needed: n8n calls Supabase RPCs with the publishable key
- [ ] You: Create fictional Google Form "Job Application - Test" (6 fields) and share the public URL
- [x] n8n AI gateway credits work (gpt-4o-mini)
- [x] Go given

## 0:08-0:15 Data layer (Claude)
- [x] Create `sessions`, `fields`, `events` tables with RLS on, plus `iv_*` state functions
- [x] 19-step SQL test of the state machine passes; advisors checked

## 0:15-0:30 Backend workflow, text only (Claude)
- [x] n8n workflow "Voice Interviewer API" (inactive): webhook + Switch on `action`
- [x] `start_session`: Browserless -> form parser -> save -> return code (parser tested on a real Google Form; needs Browserless credential in n8n)
- [x] `save_profile`, `draft_answers` (tested through n8n)
- [x] `get_current`, `save_decision` (idempotent cursor)
- [x] `get_preview`, `decide` (approval bound to revision)
- [x] Test each action with fictional data through the live webhook
- [x] Workflow activated; live webhook tested end to end

## 0:30-0:40 Bolna agent, chat mode (Claude writes, you paste)
- [x] Claude: `bolna/prompt.md`, `bolna/tools.py`, `bolna/create_agent.py`
- [x] Agent created (`9cf39a81-...`) and updated with client_ref + any-URL prompt
- [ ] Run the full path in chat mode (no voice credit)

## Added after the plan
- [x] Any URL: AI question extraction for non-Google forms and job postings (tested on httpbin, Lever apply page, Lever posting)
- [x] Interview page `web/`: live sheet, voice call (Bolna Web Call SDK), paste-a-link, sessions sidebar
- [x] Pre-filled Google Form link after approval (user submits)
- [x] Interviewer persona prompt (Maya): natural questions, acknowledgements, follow-ups, no reading out labels or lists
- [x] Interruptions: barge-in after 2 words, 500 ms reply delay, backchanneling; detour rules in prompt
- [x] Fix: changing an earlier answer mid-review returns to the next open question (was skipping to preview)

## Feature: profile from resume and links (done, needs your test)
Goal: upload a resume once, add links, build a reusable profile; interviews then ask only role-specific questions and gaps.
- [x] Supabase: `profiles` table, `sessions.profile_id`, `iv_upsert_profile`, `iv_get_profile`, `iv_attach_profile`; session create/view/draft include the profile
- [x] n8n: `build_profile` action (reads each link with Browserless, marks LinkedIn login walls, LLM builds a structured profile with sources) - live, ~15 s
- [x] n8n: drafting uses resume profile + call notes (call notes win); skills/experience drafted from resume with quoted evidence; motivation/logistics left for the call
- [x] Page: upload PDF / DOCX / TXT, text + hidden links extracted in the browser (verified on sample PDF), editable link list, profile card with sources
- [x] Page: profile kept per browser (or `?profile=KEY`), attached to new and open sessions, passed into calls
- [x] Bolna: `start_session` gets `profile_key`; prompt skips background questions when a profile is attached
- [x] Tested live with the fictional sample resume (`samples/sample_resume.pdf`): profile PAUBLQWG, session U6FYDF
- [ ] You: upload the sample resume on the page and run a call with a profile attached
- Known limits: LinkedIn needs a login (marked, not guessed); scanned-image PDFs have no text; evidence quotes are sometimes paraphrased

## Conversation quality (done, needs your test)
- [x] Greeting built per call by the page (`{{welcome_message}}`): new person, has resume, form open, returning partway, already approved
- [x] Every reply = specific acknowledgement + next question; examples of human phrasing for common form questions
- [x] Backend `next_step` hints reworded so the agent never reads questions out verbatim

## Layout v2: agent at the centre (done, needs your test)
- [x] Left sidebar: profile only (upload, links, card)
- [x] Centre: Maya (call button, progress), link box, tabs **Conversation** and **Application form** (form fills live, badge shows new answers / gaps)
- [x] Right: applications as a slide-out drawer (button with count, Esc / scrim to close)
- [x] Transcript: each call's conversation fetched from Bolna (server-side key), saved to Supabase `calls`, shown per application across calls; polled during the call (whether Bolna exposes words mid-call is to be confirmed on a live call)
- [x] Fill from profile: reading a link with a profile attached drafts the form immediately (`/draft`)
- [x] URL options for demos: `?code=`, `?profile=`, `?tab=form`, `?drawer=open`

## Follow-ups
- [ ] Sync `n8n/build_workflow.py` with the live workflow (profile nodes, URL-free host parsing, draft prompt); the live workflow is the source of truth until then
- [ ] Delete test sessions and test profiles before the demo

## 0:40-0:50 Voice + tests
- [ ] One browser voice run end to end
- [ ] Run the test checklist in PROJECT.md section 9, log failures below, fix the top one

## 0:50-1:00 Demo + submit
- [ ] Rehearse the 3-5 min script, record it
- [ ] Submit: https://forms.gle/UTvyQic2TRWCz5f67

## Stretch (only if time is left)
- [ ] Fill dry run: Browserless fills the form in a sandbox without submitting
- [ ] Hindi demo via Sarvam

## Failure log
| Input | Failure | Root cause | Fix and retest |
|---|---|---|---|
| | | | |
