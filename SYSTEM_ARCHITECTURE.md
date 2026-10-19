# VoiceAI System Architecture

## Overview

VoiceAI helps an applicant prepare answers for a public job application without
submitting the application automatically.

The system has two user interfaces:

- The browser page, which supports text chat, application forms, profiles, and
  browser-based voice calls.
- The Bolna voice agent, named Maya, which supports the same interview through
  speech.

Supabase is the source of truth for application state. AI agents can suggest
answers, but only validated backend actions save answers or change the
application state.

## Agents and services

| Component            | Type                                   | Responsibility                                                                                                                                    |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maya                 | Bolna voice agent                      | Converses with the applicant, calls tools, asks one question at a time, and explains the current application state naturally.                     |
| Browser chat agent   | Local Groq agent in `web/agents.mjs` | Extracts answers from the latest text message, chooses the next useful question, and prevents unsupported answers from being saved.               |
| Drafting agent       | Local Groq agent in `web/agents.mjs` | Drafts application fields from the saved resume profile and applicant notes. It checks that drafts are grounded in the source before saving them. |
| n8n extraction agent | n8n OpenAI node                        | Extracts fields from rendered non-Google forms or job postings when the deterministic parser cannot identify the fields.                          |
| n8n drafting agent   | n8n OpenAI node                        | Fallback drafter used when the local Groq drafter is unavailable or disabled. It receives both `applicant_notes` and `resume_profile`.        |
| Profile builder      | n8n `build_profile` workflow         | Converts resume text and supplied links into a reusable profile stored in Supabase.                                                               |
| Form parser          | Browserless plus local/n8n parsers     | Renders a public page and extracts real labels, field types, required flags, and choices.                                                         |
| Supabase RPC layer   | Database functions                     | Enforces cursor rules, validation, revisions, draft saving, approval binding, and event logging.                                                  |

### Agent boundaries

- Maya does not own application state. It calls tools and speaks the result.
- Groq and n8n agents suggest or extract data. They do not bypass Supabase
  validation.
- Supabase RPC functions are the only state mutation boundary.
- The applicant must explicitly confirm, revise, skip, or approve answers.
- The system never submits the external application.

## Complete system diagram

```mermaid
flowchart LR
    User["Applicant"]
    Browser["Browser UI<br/>web/index.html"]
    Bolna["Maya voice agent<br/>Bolna<br/>STT + conversation + TTS"]
    Server["Local server<br/>web/server.mjs"]
    Chat["Text chat coordinator<br/>web/chat.mjs"]
    Groq["Local AI agents<br/>web/agents.mjs"]
    Extract["Answer extractor<br/>latest message"]
    Coach["Interview coordinator<br/>next question"]
    Draft["Resume/profile drafter<br/>grounded drafts"]
    Webhook["n8n Interviewer API<br/>single action webhook"]
    Profile["n8n Profile Builder<br/>resume + links"]
    N8nExtract["n8n Form Extraction Agent"]
    N8nDraft["n8n Drafting Agent"]
    Browserless["Browserless<br/>render public page"]
    Supabase["Supabase RPC layer"]
    DB[("Supabase database<br/>sessions, fields, profiles, events")]
    Form["External job form<br/>read-only"]
    Resume["Resume text + links"]

    User --> Browser
    User --> Bolna
    Browser --> Server
    Bolna --> Webhook
    Server --> Chat
    Chat --> Groq
    Server --> Groq

    Browser -->|start_session| Webhook
    Browser -->|build_profile| Profile
    Browser -->|attach profile + draft| Server

    Webhook -->|start_session| Browserless
    Browserless --> Form
    Browserless --> N8nExtract
    N8nExtract --> Webhook
    Webhook --> Supabase

    Profile --> Resume
    Profile --> Supabase
    Server -->|iv_get_view / iv_get_session| Supabase
    Server -->|iv_save_drafts| Supabase

    Groq --> Extract
    Groq --> Coach
    Groq --> Draft
    Draft -. fallback .-> Webhook
    Webhook --> N8nDraft
    N8nDraft --> Supabase

    Supabase --> DB
    Supabase --> Webhook
    Supabase --> Server
    Webhook --> Bolna
    Server --> Browser
```

## Main flows

### 1. Open an application

```mermaid
sequenceDiagram
    participant U as Applicant
    participant B as Browser
    participant N as n8n webhook
    participant BL as Browserless
    participant S as Supabase

    U->>B: Paste public form or job URL
    B->>N: start_session(form_url, profile_key)
    N->>BL: Render public page
    BL-->>N: HTML and page text
    N->>N: Parse Google Forms or call extraction agent
    N->>S: iv_create_session(fields, profile)
    S-->>N: Session code and initial state
    N-->>B: Application state
    B-->>U: Show form and session code
```

### 2. Build or attach a resume profile

```mermaid
sequenceDiagram
    participant U as Applicant
    participant B as Browser
    participant P as Profile builder
    participant S as Supabase
    participant D as Drafting agent

    U->>B: Upload resume and add links
    B->>P: build_profile(resume_text, links)
    P->>S: Save reusable profile
    S-->>P: profile_key
    P-->>B: Profile data and profile_key
    B->>S: iv_attach_profile(application, profile_key)
    B->>D: Draft fields for the open application
    D->>S: iv_get_view and iv_get_session
    D->>S: iv_save_drafts
    S-->>B: Fields grouped as resume drafts and missing fields
    B-->>U: Update the application form
```

Resume-supported fields such as name, contact information, skills, tools, and
past experience can be drafted from `resume_profile`. Motivation and logistics
fields such as why this role, availability, salary, notice period, and
relocation remain gaps unless the applicant provides them.

### 3. Text or voice interview turn

```mermaid
sequenceDiagram
    participant U as Applicant
    participant I as Browser chat or Maya
    participant A as Groq agents
    participant N as n8n webhook
    participant S as Supabase RPC

    U->>I: Answer or request a change
    I->>S: get_current
    I->>S: Load saved conversation
    I->>A: Latest message, form state, and conversation
    par Extract answer
        A->>A: Answer extractor
    and Choose next question
        A->>A: Interview coordinator
    end
    A-->>I: Grounded answer candidates and next question
    I->>I: Verify answer is present in the applicant's words
    I->>S: save_decision only for validated answers
    S-->>I: Updated form and cursor
    I-->>U: One concise next question
```

When Groq is disabled or rate-limited, the local agents use the n8n interview
webhook as a fallback. The n8n path can use its managed OpenAI node.

### 4. Preview and approval

```mermaid
flowchart TD
    Start["All required fields reviewed"] --> Preview["get_preview"]
    Preview --> Revision["Show every answer and exact revision number"]
    Revision --> Choice{"Applicant decision"}
    Choice -->|Revise| Reopen["decide(revise, field_id)"]
    Reopen --> Review["Return to review loop"]
    Choice -->|Cancel| Cancel["decide(cancel)"]
    Choice -->|Approve exact revision| Approve["decide(approve, revision)"]
    Approve --> Locked["Supabase locks approved revision"]
    Locked --> Output["Open pre-filled form or copy answers"]
    Output --> Submit["Applicant submits externally"]
```

Approval is only accepted for the exact revision shown in the latest preview.
Any answer change invalidates the previous approval. The system never presses
the external Submit button.

## Request routing

The local server exposes the following important routes:

| Route                   | Purpose                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `POST /chat`          | Text interview messages through `web/chat.mjs`.                                    |
| `POST /profile`       | Sends resume text and links to the n8n profile builder.                              |
| `POST /draft`         | Drafts fields from the attached profile, using local Groq first and n8n as fallback. |
| `POST /start`         | Starts an application from a pasted public URL through n8n.                          |
| `POST /bolna-session` | Mints a short-lived Bolna web-call session without exposing the Bolna API key.       |
| `POST /voice-turn`    | Processes a voice turn through the local answer extractor and interview coordinator. |
| `POST /form-state`    | Returns the current application state used by the browser form view.                 |

Voice tool calls and browser operations use the n8n webhook:

```json
{
  "action": "get_current | save_profile | draft_answers | save_decision | get_preview | decide",
  "code": "ABC123"
}
```

The n8n workflow routes the action to the corresponding Supabase RPC function.
For `start_session`, it additionally calls Browserless and the extraction
agent. For `draft_answers`, it loads the application view, sends both the
resume profile and applicant notes to the drafting agent, and saves validated
drafts.

## State and trust model

```mermaid
stateDiagram-v2
    [*] --> extracting
    extracting --> collecting: Form saved
    extracting --> failed: Page unreadable
    collecting --> reviewing: Profile or applicant facts available
    reviewing --> previewing: All reviewable answers handled
    previewing --> approved: Exact revision approved
    previewing --> reviewing: Applicant requests revision
    reviewing --> cancelled: Applicant cancels
    collecting --> cancelled: Applicant cancels
    approved --> reviewing: Approved field is reopened
```

Supabase stores:

- `profiles`: reusable resume-derived profiles.
- `sessions`: application metadata, status, cursor, revision, and profile link.
- `fields`: extracted questions, drafts, evidence, answers, and field status.
- `events`: audit history for profile attachment, drafting, decisions, and
  state changes.
