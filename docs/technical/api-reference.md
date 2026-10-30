# API Reference

## Overview

The system uses two distinct API layers:
1. **Engine Management API** — FastAPI on port 8000 (`VOICE_ENGINE_BASE_URL`)
2. **Dashboard Server Functions** — TanStack Server functions (called from browser via HTTP)

The engine also exposes:
- **Public routes:** `/health`, `/exotel/stream` (WebSocket)
- **Admin routes:** `/agents`, `/calls`, `/voices`, `/campaigns/dispatch` (Bearer token required)

The dashboard exposes:
- **Public routes:** `/login`, `/signup`
- **Protected server functions:** All via `createServerFn` + `requireAuth` middleware

---

## Engine API (FastAPI)

Base URL: `VOICE_ENGINE_BASE_URL` (default: `http://localhost:8000`)  
Authentication: `Authorization: Bearer {APP_SECRET_KEY}` (admin routes only)

### Health Check

**Endpoint:** `GET /health`  
**Auth:** Public  
**Response:**
```json
{
  "status": "ok",
  "active_calls": 2
}
```

---

### Agent Management

#### Create Agent

**Endpoint:** `POST /agents`  
**Auth:** Bearer token required  
**Request:**
```json
{
  "name": "Sales Bot",
  "language": "en",
  "workflow": "lead_qualification",
  "instructions": "You are a B2B sales representative...",
  "greeting": "Hello! How can I help you today?",
  "knowledge": "Our product costs $99/month...",
  "collect_fields": ["budget", "use_case"],
  "outcome_rules": [
    {
      "name": "Interested",
      "definition": "Prospect asked for pricing or demo"
    }
  ],
  "outcome_fallback": "Did not clearly express interest",
  "voice_id": "bakbak-en-voice-001",
  "tts_model_id": "standard",
  "client_id": "workspace-uuid-here",
  "persona_key": "sales-bot"
}
```

**Response (201 Created):**
```json
{
  "id": 123,
  "name": "Sales Bot",
  "language": "en",
  "created_at": "2026-10-29T12:34:56Z",
  "updated_at": "2026-10-29T12:34:56Z"
}
```

**Errors:**
- `422 Unprocessable Entity` — Validation failed (e.g., missing greeting)
- `409 Conflict` — Agent with this persona_key + client_id already exists

#### List Agents

**Endpoint:** `GET /agents`  
**Auth:** Bearer token required  
**Response:**
```json
[
  { "id": 123, "name": "Sales Bot", ... },
  { "id": 124, "name": "Support Bot", ... }
]
```

#### Get Agent by ID

**Endpoint:** `GET /agents/{agent_id}`  
**Auth:** Bearer token required  
**Response:** Single agent object

---

### Voice List

**Endpoint:** `GET /voices`  
**Auth:** Bearer token required  
**Purpose:** Fetch available voices from configured TTS provider  
**Response:**
```json
{
  "provider": "bakbak",
  "voices": [
    {
      "voice_id": "bakbak-en-voice-001",
      "tts_model_id": "standard",
      "language": "en",
      "name": "En-US-1",
      "gender": "neutral"
    },
    {
      "voice_id": "bakbak-hi-voice-001",
      "tts_model_id": "standard",
      "language": "hi",
      "name": "Hi-001",
      "gender": "female"
    }
  ]
}
```

**Errors:**
- `502 Bad Gateway` — TTS provider unreachable

---

### Outbound Call (Manual)

**Endpoint:** `POST /calls`  
**Auth:** Bearer token required  
**Request:**
```json
{
  "agent_id": 123,
  "to": "+919876543210",
  "contact_name": "John Doe"
}
```

**Response (201 Created):**
```json
{
  "id": "call-uuid-1",
  "status": "completed",
  "direction": "outbound",
  "dialled_number": "+919876543210",
  "duration_seconds": 120,
  "outcome": "Interested",
  "summary": "Prospect interested in demo"
}
```

**Errors:**
- `404 Not Found` — Agent does not exist
- `409 Conflict` — Call could not be placed (e.g., Exotel rejected)
- `502 Bad Gateway` — Exotel unreachable

---

### Test Outbound Call (From Persona Snapshot)

**Endpoint:** `POST /calls/test`  
**Auth:** Bearer token required  
**Purpose:** Place a call using a persona object directly (no stored agent required)  
**Request:**
```json
{
  "client_id": "workspace-uuid",
  "persona": {
    "key": "my-persona",
    "name": "Test Bot",
    "language": "en",
    "workflow": "general",
    "instructions": "You are helpful...",
    "greeting": "Hi there!",
    "knowledge": "",
    "collect_fields": [],
    "outcome_rules": [],
    "voice_id": "bakbak-en-voice-001",
    "tts_model_id": "standard"
  },
  "to": "+919876543210",
  "contact_name": "Test"
}
```

**Response (201 Created):** Same as POST /calls

---

### Campaign Dispatch

**Endpoint:** `POST /campaigns/dispatch`  
**Auth:** Bearer token required  
**Purpose:** Queue a campaign's leads for dialling  
**Request:**
```json
{
  "client_id": "workspace-uuid",
  "campaign_id": "campaign-uuid",
  "idempotency_key": "uuid-for-dedup",
  "persona": { /* persona object */ },
  "outcome_rules": [
    { "name": "Interested", "definition": "..." }
  ],
  "outcome_fallback": "Inconclusive",
  "leads": [
    {
      "id": "lead-1",
      "phone": "+919876543210",
      "name": "John"
    }
  ],
  "calling_window": {
    "start": "09:00",
    "end": "18:00"
  },
  "max_tries": 3,
  "retry_gap_minutes": 30
}
```

**Response (202 Accepted):**
```json
{
  "job_id": "job-uuid",
  "status": "pending"
}
```

**Errors:**
- `400 Bad Request` — Invalid lead format or calling window
- `409 Conflict` — Duplicate call with same idempotency_key
- `422 Unprocessable Entity` — Persona validation failed

---

## Dashboard Server Functions

Base URL: Browser location (e.g., `http://localhost:5173`)  
Auth: `requireAuth` middleware + `currentWorkspaceClient` scoping  
Client: Called from React via TanStack Server

### Authentication

#### Get Session

**Function:** `getSession()`  
**Auth:** Public  
**Returns:**
```typescript
{ user: SessionUser | null }
```

#### Sign In

**Function:** `signIn(email: string, password: string)`  
**Auth:** Public  
**Returns:**
```typescript
{
  ok: true,
  user: { id, email, fullName }
} | {
  ok: false,
  reason: "Invalid email or password"
}
```

#### Sign Out

**Function:** `signOut()`  
**Auth:** Authenticated  
**Returns:** void

---

### Campaign Management

#### List Campaigns

**Function:** `listCampaigns()`  
**Auth:** `requireAuth`  
**Returns:**
```typescript
[
  {
    id: "uuid",
    name: "Q4 Outreach",
    status: "Active",
    personaKey: "sales-bot",
    createdAt: Date
  }
]
```

#### Create Campaign

**Function:** `createCampaign(input: CreateCampaignInput)`  
**Input:**
```typescript
{
  name: string,           // Required
  purpose?: string,
  personaKey: string,     // Required
  voice?: string,
  voiceId?: string,
  voiceModelId?: string,
  ambience?: boolean,
  callingStart?: "HH:MM",
  callingEnd?: "HH:MM",
  maxTries?: number,
  retryGapMinutes?: number,
  callbackWindowDays?: number,
  creditCap?: number
}
```

#### Update Campaign Status

**Function:** `updateCampaignStatus(campaignId: string, nextStatus: "Active" | "Paused" | "Completed" | "Cancelled")`  
**Returns:** Updated campaign

#### Start Campaign Dispatch

**Function:** `startCampaignDispatch(campaignId: string)`  
**Purpose:** Queue the campaign's leads to the engine  
**Returns:**
```typescript
{
  ok: true,
  jobId: string
} | {
  ok: false,
  reason: string
}
```

---

### Prompt/Persona Management

#### List Prompts

**Function:** `listPrompts()`  
**Auth:** `requireAuth`  
**Returns:** Array of prompts

#### Save Prompt Version

**Function:** `savePromptVersion(input: SavePromptInput)`  
**Input:**
```typescript
{
  promptId: string | null,  // null = create new
  content: {
    name: string,
    personaKey: string,
    instructions: string,
    greeting: string,
    knowledge?: string,
    collectFields?: string[],
    active: boolean,
    language: "en" | "hi" | "ta" | "te",
    purpose?: string
  }
}
```

#### Delete Prompt

**Function:** `deletePrompt(promptId: string)`

---

### Call Management

#### List Calls

**Function:** `listCalls(filter: CallFilter)`  
**Filter:**
```typescript
{
  direction?: "inbound" | "outbound",
  outcome?: string,
  campaignId?: string,
  limit?: number,
  offset?: number
}
```

#### Export Calls

**Function:** `exportCalls(filter: CallFilter)`  
**Returns:** CSV blob

#### Get Call Transcript

**Function:** `getCallTranscript(callId: string)`  
**Returns:**
```typescript
{
  text: string,
  segments: [
    { speaker: "bot" | "human", text: string, timestamp: number }
  ]
}
```

---

### Inbound Numbers

#### List Inbound Numbers

**Function:** `listInboundNumbers()`  
**Returns:** Array of routing rules

#### Save Inbound Number

**Function:** `saveInboundNumber(input: InboundNumberInput)`  
**Input:**
```typescript
{
  phone: string,           // E.164 format, must be unique
  personaKey: string,      // Must match an active prompt
  workflow: string,
  active: boolean
}
```

#### Publish Inbound Number

**Function:** `publishInboundNumber(numberId: string)`  
**Purpose:** Send route to engine

#### Refresh Inbound Number

**Function:** `refreshInboundNumber(numberId: string)`  
**Purpose:** Re-sync with engine (if engine route is stale)

---

### Test Outbound Call

#### Place Test Call

**Function:** `testOutboundCall(input: TestOutboundCallInput)`  
**Input:**
```typescript
{
  personaKey: string,
  to: string,              // E.164 phone number
  contactName?: string
}
```

**Returns:**
```typescript
{
  ok: true,
  callId: number,
  status: string,
  exotelCallSid: string | null
} | {
  ok: false,
  reason: string
}
```

---

### Call Outcome Settings

#### Get Call Outcome Settings

**Function:** `getCallOutcomeSettings()`  
**Auth:** `requireAuth`  
**Returns:**
```typescript
{
  rules: [
    {
      id: string,
      name: string,
      definition: string,
      enabled: boolean,
      builtIn: boolean
    }
  ],
  fallback: string,
  shortHangupThresholdSeconds: number
}
```

#### Save Call Outcome Settings

**Function:** `saveCallOutcomeSettings(input: SaveCallOutcomeSettingsInput)`  
**Input:**
```typescript
{
  rules: [{ id, name, definition, enabled, builtIn }],
  fallback: string,
  shortHangupThresholdSeconds: number
}
```

**Returns:**
```typescript
{
  ok: true,
  settings: { ... }
} | {
  ok: false,
  reason: string
}
```

---

### Workspace

#### Get Workspace Overview

**Function:** `getWorkspaceOverview(range: string)`  
**Range:** "today", "this-week", "this-month", "all-time"  
**Returns:**
```typescript
{
  client: { id, name },
  period: { start, end },
  calls: {
    total: number,
    inbound: number,
    outbound: number,
    byOutcome: { Interested: number, ... }
  },
  campaigns: {
    active: number,
    total: number
  },
  leads: {
    total: number,
    queued: number,
    completed: number
  }
}
```

#### Get Workspace Credits

**Function:** `getWorkspaceCredits()`  
**Returns:**
```typescript
{
  balance: number,
  ledger: [
    { amount: number, note: string, createdAt: Date }
  ]
}
```

---

## Webhook Integration

### Incoming: Dashboard Receives from Engine

**Endpoint:** `POST /api/webhooks/voice-engine`  
**Headers:** `x-voice-engine-signature: {HMAC-SHA256}`  
**Body (CallComplete event):**
```json
{
  "eventId": "event-uuid",
  "eventType": "CallComplete",
  "engineJobId": "job-uuid",
  "payload": {
    "callId": "call-number",
    "engineCallId": "call-uuid",
    "status": "completed",
    "direction": "outbound",
    "outcome": "Interested",
    "durationSeconds": 120,
    "summary": "Prospect interested in demo",
    "collectedFields": { "budget": "$50k-100k" },
    "transcriptRef": "call-uuid"
  }
}
```

**Processing:**
1. Verify HMAC signature
2. Parse JSON
3. Check eventId not already processed (idempotent)
4. Extract callId and call details
5. Update Call and Lead records in DB
6. Return 200 OK

**Status Codes:**
- `200 OK` — Event accepted and processed
- `400 Bad Request` — Invalid JSON or missing fields
- `401 Unauthorized` — Signature mismatch
- `404 Not Found` — Engine job not found (retry later)
- `409 Conflict` — Business logic error (don't retry)
- `500 Internal Server Error` — Processing error (retry later)

---

## Request/Response Examples

### Full Campaign Dispatch Flow

**1. Dashboard fetches outcome rules:**
```bash
curl -X POST http://localhost:5173/api \
  -H "Content-Type: application/json" \
  -d '{ "rpc": "getCallOutcomeSettings" }'
```

**2. Dashboard POSTs to engine:**
```bash
curl -X POST http://localhost:8000/campaigns/dispatch \
  -H "Authorization: Bearer {APP_SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "workspace-uuid",
    "campaign_id": "campaign-uuid",
    "idempotency_key": "unique-key",
    "persona": { ... },
    "outcome_rules": [ ... ],
    "leads": [ ... ],
    "calling_window": { "start": "09:00", "end": "18:00" }
  }'
```

**3. Engine returns job ID:**
```json
{
  "job_id": "job-uuid",
  "status": "pending"
}
```

**4. Engine dials leads, generates events**

**5. Engine POSTs webhook to dashboard:**
```bash
curl -X POST https://dashboard.example.com/api/webhooks/voice-engine \
  -H "x-voice-engine-signature: hmac-sha256-hash" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "event-uuid",
    "eventType": "CallComplete",
    "engineJobId": "job-uuid",
    "payload": { ... }
  }'
```

**6. Dashboard returns:**
```json
{
  "processed": true,
  "callId": "call-uuid",
  "outcome": "Interested"
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "detail": "Human-readable error message"
}
```

Or (webhook-specific):

```json
{
  "processed": false,
  "reason": "Why the event was not processed"
}
```

### Common Status Codes

| Code | Meaning | Retry? |
|------|---------|--------|
| 200 | Success | N/A |
| 201 | Created | N/A |
| 202 | Accepted (async) | N/A |
| 400 | Bad request (client error) | No |
| 401 | Unauthorized (bad token/signature) | No* |
| 404 | Not found | Yes (but may be genuinely not found) |
| 409 | Conflict (unrecoverable business error) | No |
| 422 | Unprocessable entity (validation error) | No |
| 429 | Rate limited | Yes (exponential backoff) |
| 500 | Server error | Yes (exponential backoff) |
| 502 | Bad gateway (external service down) | Yes |
| 503 | Service unavailable | Yes |

*401 webhook might retry if credentials temporarily invalid; engine logs and doesn't retry after X failures.

---

**See also:**
- [integration-contracts.md](integration-contracts.md) — Webhook payload details and retry logic
- [feature-flows.md](feature-flows.md) — Real-world examples of feature usage
