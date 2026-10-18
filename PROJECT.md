# Voice Personal Interviewer

AI Garage Voice AI Buildathon, Challenge A (Personal Interviewer). 18 Oct 2026, PayTM office. Build time: 1 hour.

> **One sentence:** We are helping a job applicant turn a public job application form into a set of reviewed,
> grounded answers, by talking to a voice agent that never invents facts and never submits without approval.

---

## 1. Final goal (what "done" means)

At the end of the hour we demo one complete loop, first in text, then by voice:

1. The user gives the agent **one public application form URL**.
2. The backend **reads the real form** (Browserless) and saves each question with its type, required flag and options.
3. The agent **asks a few profile questions**, then **drafts answers only from what the user said**. Anything unknown is shown as a gap, not guessed.
4. The agent walks the user through **each answer: confirm, revise or skip**. Every decision is saved.
5. The user can **pause and come back** with a short session code and land on the exact same question.
6. The agent reads out a **final preview** and asks: **approve, revise or cancel**.
7. Approval is locked to **one exact revision** of the answers. Nothing is filled or submitted.

**Judging lens we must hit:** loop works, interview adapts, gaps are visible, user can correct, recovers from
delay/disconnect, consequential action is protected.

**After approval:** Google Forms get a pre-filled link the user opens and submits themselves; other forms get Copy answers.

**Out of scope:** the agent filling or submitting the form itself, login-protected forms, file uploads, resumes as PDF,
phone calls, multiple users, real personal data.

---

## 2. Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Voice agent | **Bolna** | Custom function tools call any HTTP endpoint (OpenAI function-calling spec), chat mode to test without spending voice credit, $5 signup credit. Sarvam stays as the backup if we want a Hindi demo. |
| Orchestration | **n8n Cloud** (`voiceai-kk.app.n8n.cloud`) | Public webhook URLs out of the box, connected to Claude via MCP, so Claude builds the workflows. |
| LLM (extraction + drafting) | **n8n gateway AI credits** (OpenAI / Gemini / Anthropic nodes) | The instance reports managed credentials for these nodes, so no separate LLM key should be needed. |
| Form reader | **Browserless** | Renders the public form and returns real HTML so questions are never guessed. |
| State | **Supabase** (project `pqkpwzsluzubzugpytrv`) | Sessions, fields, answers, revisions, approvals. Backend state is the source of truth, not the transcript. |
| Question extraction | Google Forms: exact parser. Any other URL: LLM reads the rendered page | A form page gives its real fields. A job posting with no form gives questions built only from its stated requirements (open-ended, marked in the title). Anything else returns no questions, so the agent asks for another link. Login-walled pages and forms inside iframes are not supported. |

---

## 3. User journey

```
User: "Help me apply to this job" + URL
  -> start_session        : Browserless reads form, LLM extracts fields, saved. Agent reads back a 6-char session code.
  -> profile questions     : agent asks 3-5 short facts it needs (name, email, phone, experience, why this role)
  -> draft_answers        : LLM drafts each field from those facts only; unknowns marked as gaps
  -> review loop           : for each field -> get_current -> agent reads draft -> user confirms / revises / skips
                             -> save_decision (only advances if field_id matches the cursor)
  -> pause (any time)      : user hangs up; later says the code -> get_current resumes at the same field
  -> get_preview           : agent reads every answer + revision number
  -> decide                : approve (locks that revision) | revise (back to a field) | cancel (stopped)
  -> end                   : "Approved revision 4. Nothing has been filled or submitted."
```

### State machine (`sessions.status`)

`extracting -> collecting -> reviewing -> previewing -> approved | cancelled`

- `failed` if the URL is broken, private, or has no readable form. Agent says so and stops safely.
- From `previewing`, `revise` goes back to `reviewing` at the chosen field.
- Any edit after approval bumps the revision and clears the approval.

---

## 4. Architecture

```
 +---------+   voice / chat   +-----------------+   HTTPS POST (custom functions)   +---------------------------+
 |  User   | <--------------> |  Bolna agent    | --------------------------------> |  n8n Cloud webhook        |
 +---------+                  |  (STT, LLM, TTS)| <-------------------------------- |  "Interviewer API"        |
                              +-----------------+        JSON tool result           |   Switch on `action`      |
                                                                                    +-------------+-------------+
                                                                                                  |
                                       +--------------------+---------------------+---------------+
                                       |                    |                     |
                                 Browserless          n8n AI node            Supabase
                                 (render form)     (extract + draft)    (sessions, fields, events)
```

- **Bolna** owns the conversation only. It never decides state; it calls tools and reads back what they return.
- **n8n** owns every rule: cursor, revisions, idempotency, approval binding.
- **One webhook, one `action` field** keeps the build small. Each Bolna tool posts to the same URL with a fixed `action`.

---

## 5. Data model (Supabase, `public` schema)

**sessions**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| code | text unique | 6 chars, easy to say aloud, used to resume |
| form_url | text | |
| form_title | text | |
| status | text | extracting, collecting, reviewing, previewing, approved, cancelled, failed |
| cursor_pos | int | position of the current field |
| revision | int | +1 on every answer change |
| approved_revision | int null | set only by `decide(approve, revision)` when revision matches |
| profile | jsonb | facts the user stated |
| error | text null | why it failed |
| created_at / updated_at | timestamptz | |

**fields**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| session_id | uuid fk | |
| field_id | text | stable id from the form (entry name / input name) |
| position | int | order on the form |
| label | text | question text as shown |
| type | text | short_text, long_text, email, phone, url, number, date, single_choice, multi_choice, unsupported |
| required | bool | |
| options | jsonb | choices, if any |
| draft | text null | LLM suggestion |
| evidence | text null | which profile fact the draft came from |
| missing_info | text null | what we still need to ask |
| answer | text null | the value the user confirmed |
| status | text | pending, drafted, confirmed, revised, skipped |
| unique (session_id, field_id) | | |

**events** (audit log: every tool call and decision, used to show "trust" in the demo)

`id, session_id, action, payload jsonb, created_at`

RLS is enabled on all three tables with no policies, and table grants are revoked, so nobody can read or write them directly.
All access goes through `iv_*` Postgres functions (security definer) that hold every rule: cursor, idempotency, validation, revision, approval.
n8n calls them over Supabase REST with the publishable key. Trade-off accepted for the hackathon: anyone with that public key and a
session code could call the API, which is the same exposure as the public n8n webhook. Fictional data only.

---

## 6. Tool contracts (Bolna custom functions -> n8n webhook)

All tools: `POST https://voiceai-kk.app.n8n.cloud/webhook/interviewer` with `{"action": "...", ...}`.
Every response includes `ok`, `status`, and a short `say` string the agent can read out.

| Tool | Input | Does | Returns |
|---|---|---|---|
| `start_session` | `form_url` | Browserless render, LLM extract fields, save session + fields | `code`, `form_title`, `field_count`, `profile_questions[]` |
| `save_profile` | `code`, `facts` (free text) | Merge facts into `profile` | `profile`, still-missing facts |
| `draft_answers` | `code` | LLM drafts each field from `profile` only; gaps set `missing_info` | `drafted`, `gaps`, first field |
| `get_current` | `code` | Return field at `cursor` (also the resume tool) | `field_id`, `label`, `type`, `options`, `draft`, `missing_info`, `position/total` |
| `save_decision` | `code`, `field_id`, `decision` (confirm/revise/skip), `answer?` | Validate by type, save, bump revision. Advance cursor **only if** `field_id` is the current field | updated field + next field |
| `get_preview` | `code` | All answers + current `revision` | `answers[]`, `revision`, `gaps` |
| `decide` | `code`, `decision` (approve/revise/cancel), `revision`, `field_id?` | approve locks `approved_revision` if it matches; revise moves cursor; cancel stops | final status |

**Rules the backend enforces**
- Same decision sent twice = no change, cursor does not skip (idempotent).
- A revise after approval clears `approved_revision`.
- Email, phone, URL and choice answers are validated before saving; a bad value returns `ok:false` + what to ask.
- Broken or private URL -> `status: failed`, `say` explains, nothing else happens.

---

## 7. Connection status (verified 18 Oct 2026, read-only)

| Service | Connected | Check | Result |
|---|---|---|---|
| n8n Cloud (MCP) | Yes | list workflows, credentials, data tables, preferences | Empty instance, no credentials yet. Gateway AI credits available for OpenAI / Gemini / Anthropic / Firecrawl nodes. |
| Supabase (MCP) | Yes | project URL, list tables | `https://pqkpwzsluzubzugpytrv.supabase.co`, no tables yet |
| Bolna | Account ready (no MCP) | - | Agent + tools configured by pasting JSON in the dashboard |
| Browserless | Key in local `.env` | - | Still needs to go into an n8n credential |
| Sarvam | Account ready | - | Backup only |

## 8. What you need to provide

Enter every secret in the **n8n credential screen** or provider dashboard, never in chat or this repo.

1. **Browserless API token** -> n8n: Credentials -> New -> "Query Auth" named `browserless` (param `token`).
   It is already in the local `.env`, but n8n Cloud runs remotely and cannot read that file, and the n8n MCP
   cannot create credentials. So it must also be entered once in the n8n credential screen.
2. **Supabase service role key** -> n8n: Credentials -> New -> "Supabase API" named `supabase-interviewer`
   (host `https://pqkpwzsluzubzugpytrv.supabase.co`, key from Supabase -> Project Settings -> API Keys).
3. **A public test form**: a fictional Google Form "Job Application - Test" with ~6 fields:
   full name, email, phone, LinkedIn URL, years of experience (multiple choice), why this role (paragraph).
4. **Bolna** (see "What we need from Bolna" below).
5. **n8n AI credits**: confirm the instance shows free AI credits. If not, add an OpenAI or Gemini credential.
6. **Go-ahead** for me to create the 3 Supabase tables and the inactive n8n workflow.

### What we need from Bolna

| Need | Why | Who |
|---|---|---|
| Account with visible credit ($5 signup) | Pays for chat and voice tests | You (done) |
| One new agent, created in the dashboard | Holds the prompt and tools | You click "create", Claude gives the content |
| System prompt | Tells the agent to follow tool results, never invent facts, never submit | Claude writes `bolna/prompt.md` |
| 7 custom function tools (JSON) | Each posts to the n8n webhook with a fixed `action` | Claude writes `bolna/tools/*.json`, you paste in the Tools tab |
| Pre-call message on each tool | "One moment, let me check" so slow calls stay clear | In the tool JSON |
| Model choices: LLM, voice (TTS), transcriber (STT), language | Defaults are fine; pick English or Hinglish voice | You pick in the dashboard |
| Chat / test mode | Run the whole path before spending voice minutes | You |
| Browser web-call test | The voice demo, no phone number needed | You |
| Optional: Bolna API key in `.env` as `BOLNA_API_KEY` | Lets Claude create and update the agent through the Bolna API instead of you pasting | You decide |

Not needed: a phone number, telephony, inbound/outbound call setup, post-call webhooks.

---

## 9. Test checklist (from the workbook)

- [ ] Working public form -> fields extracted correctly
- [ ] Broken / private link -> stops safely with a clear message
- [ ] Email, phone, URL, long answer, choice questions all handled
- [ ] Change an answer -> new version persists, revision bumps
- [ ] Pause and come back with the code -> same question
- [ ] Say "confirm" twice -> no question skipped
- [ ] Slow response -> agent says a pre-call message, call stays clear
- [ ] Disconnect and return -> saved work still there
- [ ] Final preview matches every saved answer
- [ ] Cancel -> nothing filled or submitted

## 10. Demo script (3-5 min)

1. **Frame (45s):** "Priya is applying for a role. Here is the public form." Show Supabase tables empty.
2. **Interview (2m):** speak the URL request, agent reads code, asks 3 facts, drafts. Show one gap
   ("I don't know your LinkedIn, what is it?") and one typed field (choice read as options).
3. **Trust (1.5m):** revise one answer, show revision bump in Supabase. Hang up, call back with the code,
   lands on the same question. Final preview, approve, show `approved_revision`. Say: "Nothing was submitted."
4. **Name one failure we fixed** (from the test run).

Submission form: https://forms.gle/UTvyQic2TRWCz5f67
