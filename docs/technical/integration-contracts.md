# Integration Contracts

## Dashboard ↔ Engine Communication

The dashboard and engine communicate via:
1. **Synchronous REST API** — Dashboard calls engine directly for dispatch, voice list, test calls
2. **Asynchronous Webhooks** — Engine calls dashboard back with call results
3. **Shared Database** — Both read/write to the same PostgreSQL instance

---

## Synchronous API Calls (Dashboard → Engine)

### Dispatch Campaign

**Initiated by:** `dispatchCampaign()` in `src/lib/campaigns.functions.ts`

**Request:**
```http
POST {VOICE_ENGINE_BASE_URL}/campaigns/dispatch
Authorization: Bearer {VOICE_ENGINE_API_KEY}
Content-Type: application/json
Idempotency-Key: {idempotencyKey}

{
  "client_id": "workspace-uuid",
  "campaign_id": "campaign-uuid",
  "idempotency_key": "uuid",
  "persona": {
    "key": "sales-bot",
    "name": "Sales Bot",
    "language": "en",
    "workflow": "lead_qualification",
    "instructions": "You are...",
    "greeting": "Hello!",
    "knowledge": "...",
    "collect_fields": ["budget"],
    "outcome_rules": [
      { "name": "Interested", "definition": "..." }
    ],
    "outcome_fallback": "No clear interest",
    "voice_id": "bakbak-en-001",
    "tts_model_id": "standard"
  },
  "outcome_rules": [
    { "name": "Interested", "definition": "..." }
  ],
  "outcome_fallback": "No clear interest",
  "leads": [
    {
      "id": "lead-uuid-1",
      "phone": "+919876543210",
      "name": "John Doe"
    }
  ],
  "calling_window": {
    "start": "09:00",
    "end": "18:00"
  },
  "max_tries": 3,
  "retry_gap_minutes": 30,
  "callback_window_days": 3
}
```

**Response (202 Accepted):**
```json
{
  "job_id": "engine-job-uuid",
  "status": "pending"
}
```

**Idempotency:**
- Same `idempotency_key` within 24 hours returns same response
- Prevents duplicate campaign dispatches if dashboard retries

**Error Handling:**
- `400` — Validation failed (dashboard pre-validates anyway)
- `409` — Duplicate dispatch (retry with exponential backoff; may be genuine or may succeed on retry)
- `502` — Engine unreachable (caller should retry)

---

### Get Voices

**Initiated by:** `listVoiceOptions()` in `src/lib/voices.functions.ts`

**Request:**
```http
GET {VOICE_ENGINE_BASE_URL}/voices
Authorization: Bearer {VOICE_ENGINE_API_KEY}
```

**Response (200 OK):**
```json
{
  "provider": "bakbak",
  "voices": [
    {
      "voice_id": "bakbak-en-001",
      "tts_model_id": "standard",
      "language": "en",
      "name": "English 1",
      "gender": "neutral"
    },
    {
      "voice_id": "bakbak-en-002",
      "tts_model_id": "m1",
      "language": "en",
      "name": "English 2",
      "gender": "female"
    }
  ]
}
```

**Caching:**
- Result cached in React Query with 5-minute stale-time
- Refetch on component mount or manual retry

**Error Handling:**
- `502` — TTS provider unreachable (dashboard displays error; user can retry)

---

### Place Test Call

**Initiated by:** `testOutboundCall()` in `src/lib/outbound-test-call.functions.ts`

**Request:**
```http
POST {VOICE_ENGINE_BASE_URL}/calls/test
Authorization: Bearer {VOICE_ENGINE_API_KEY}
Content-Type: application/json

{
  "client_id": "workspace-uuid",
  "persona": {
    "key": "my-persona",
    "name": "My Persona",
    "language": "en",
    "workflow": "general",
    "instructions": "...",
    "greeting": "...",
    "knowledge": "",
    "collect_fields": [],
    "outcome_rules": [],
    "outcome_fallback": null,
    "voice_id": "bakbak-en-001",
    "tts_model_id": "standard"
  },
  "to": "+919876543210",
  "contact_name": "John"
}
```

**Response (201 Created):**
```json
{
  "id": "call-uuid",
  "status": "completed",
  "direction": "outbound",
  "dialled_number": "+919876543210",
  "duration_seconds": 45,
  "outcome": "Interested",
  "summary": "Prospect asked for pricing",
  "engine_call_id": "call-uuid"
}
```

**Important:**
- The persona snapshot is sent whole; no stored agent required
- Outcome rules are applied by the engine (workspace's custom rules if sent, else engine defaults)
- Test calls still incur credits if `CLIENT_ID` is set

**Error Handling:**
- `422` — Persona validation failed (bad language, missing greeting, etc.)
- `409` — Exotel rejected (number not in correct format, account blocked, etc.)
- `502` — Exotel unreachable

---

## Asynchronous Webhooks (Engine → Dashboard)

### Webhook Endpoint

**URL:** `{VOICE_ENGINE_WEBHOOK_URL}/api/webhooks/voice-engine` (set by user; must be HTTPS in production)

**Method:** `POST`

**Headers:**
- `x-voice-engine-signature: {HMAC-SHA256(body, secret)}`
- `Content-Type: application/json`

**Signature Verification (Dashboard side):**
```typescript
// Pseudo-code
const signature = headers['x-voice-engine-signature'];
const secret = process.env.VOICE_ENGINE_WEBHOOK_SECRET;  // Must match engine's exotel_webhook_secret
const hash = crypto
  .createHmac('sha256', secret)
  .update(rawBody)  // Raw bytes, not parsed JSON
  .digest('hex');
if (signature !== hash) {
  return 401 Unauthorized;
}
```

---

### CallComplete Event (Primary Event)

**Body:**
```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "CallComplete",
  "engineJobId": "job-uuid-from-campaign-dispatch",
  "payload": {
    "callId": 12345,
    "engineCallId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "direction": "outbound",
    "status": "completed",
    "outcome": "Interested",
    "outcome_raw": "outcome_interested",
    "duration_seconds": 127,
    "summary": "Caller expressed strong interest in the product and requested a demo.",
    "collected_fields": {
      "budget": "50-100k",
      "timeline": "Q1"
    },
    "transcriptRef": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  }
}
```

**Processing (Dashboard side):**
1. Verify signature (see above)
2. Parse JSON
3. Check `eventId` not already processed (query `voice_engine_webhook_events` table by `event_id`)
4. If already processed: return `200 OK` (idempotency)
5. Otherwise:
   - Insert `voice_engine_webhook_events` record (keyed by `eventId`)
   - Update `calls` record by `engine_call_id`:
     - Set `outcome`, `duration_seconds`, `summary`, `collected_fields`, `transcript_ref`
   - Update `leads` record by campaign + phone:
     - Set `outcome`, `follow_up_at` (if callback requested)
   - Return `200 OK` with `{ processed: true }`

**Response:**
```json
{
  "processed": true,
  "callId": "call-uuid",
  "outcome": "Interested"
}
```

**Errors:**
- `400 Bad Request` — Missing eventId/eventType/engineJobId
- `401 Unauthorized` — Invalid signature
- `404 Not Found` — Engine job not found (engine should retry; may be a timing issue)
- `409 Conflict` — Business logic error (unrecoverable; engine should not retry)
- `500 Internal Server Error` — Processing error (engine should retry)

---

### Inbound Call Completed (Inbound Event)

**Payload** (when an inbound call finishes):
```json
{
  "eventId": "...",
  "eventType": "CallComplete",
  "engineJobId": null,
  "payload": {
    "callId": 5678,
    "engineCallId": "abc-123",
    "direction": "inbound",
    "caller_number": "+919876543210",
    "dialled_number": "+919123456789",
    "outcome": "Callback",
    "duration_seconds": 45,
    "summary": "...",
    "transcriptRef": "..."
  }
}
```

**Key Differences:**
- `direction: "inbound"`
- `engineJobId: null` (inbound calls have no campaign job)
- `caller_number` is who called; `dialled_number` is our number

---

### Webhook Retry Policy (Engine Side)

**Retry Conditions:**
- HTTP status 408, 429, or 5xx → Retry
- HTTP status 400, 401, 403, 404, 409 → Do not retry (unrecoverable)
- Network timeout → Retry

**Backoff Strategy:**
- Initial: Immediate
- Retry 1: 10 seconds
- Retry 2: 30 seconds
- Retry 3: 90 seconds
- Retry 4: 5 minutes
- Retry 5: 15 minutes
- Retry 6: 1 hour
- After 6 failures: Log and give up

**Total Retry Window:** ~1.5 hours

**Dashboard Idempotency:**
- Dashboard must accept retries without side effects
- Keyed by `eventId` (UUID, globally unique per engine)
- Dashboard checks if `eventId` already in `voice_engine_webhook_events` before processing

---

## Exotel Webhook Integration

### Exotel Status Callbacks

The engine subscribes to Exotel call status updates via the StatusCallback URL parameter on each outbound call:

```
StatusCallback: {PUBLIC_BASE_URL}/exotel/status?secret={EXOTEL_WEBHOOK_SECRET}
```

**Exotel sends (via HTTP POST):**
```
CallSid=xxx&Status=completed&Direction=outbound&Duration=127&...
```

**Engine processes:**
- Parses form data
- Updates internal call state
- Stores call details
- Generates CallComplete webhook for dashboard

### Exotel WebSocket Stream

Inbound and outbound calls are handled by WebSocket connection:

```
wss://{API_KEY}:{API_TOKEN}@{PUBLIC_BASE_URL}/exotel/stream?sample_rate=16000&CallSid={CALL_SID}
```

**Stream payload:**
- Initial: metadata (CallSid, From, To, Direction)
- Ongoing: audio frames (16-bit PCM, 16 kHz)
- Terminal: hangup signal

---

## Idempotency & Deduplication

### Campaign Dispatch Idempotency

**Problem:** Dashboard retries POST /campaigns/dispatch on network error.  
**Solution:** `idempotency_key` (UUID) deduplicates.

**Flow:**
1. Dashboard generates UUID for campaign dispatch
2. Saves to `voice_engine_jobs.idempotency_key`
3. POSTs to engine with `"idempotency_key": "..."`
4. Engine creates job only if `idempotency_key` not already seen
5. Subsequent requests with same key return the existing `job_id`

**Validity:** 24 hours (old keys can be retired)

### Webhook Event Idempotency

**Problem:** Engine retries webhook delivery; dashboard might receive same event twice.  
**Solution:** `eventId` deduplication.

**Flow:**
1. Engine generates `eventId` (UUID) when call completes
2. Includes in webhook: `"eventId": "..."`
3. Dashboard checks `voice_engine_webhook_events.event_id` for uniqueness
4. If found: return `200 OK` (idempotent; do not reprocess)
5. If not found: process and insert record

**Validity:** ~1.5 hours (lifetime of webhook retry window; can clean up older events)

---

## Cross-Tenant Data Isolation

### Problem
Dashboard handles multi-tenant data; engine can also receive data for multiple clients.

### Solution

**For Campaign Dispatch:**
- Dashboard sends `client_id` in request
- Engine stores it on the job
- Engine generates webhook events with `engineJobId` (which has `client_id`)
- Dashboard resolves `engineJobId` → `client_id` → tenant context
- Dashboard validates caller's workspace matches job's `client_id` before accepting webhook

**For Inbound Calls:**
- Engine looks up inbound route by phone number
- Calls engine-wide default agent if no route found
- Dashboard receives webhook with call details
- Dashboard infers `client_id` from `inboundNumberId` (if present) or inbound route details

### Not Yet Implemented (Known Gap)
- Inbound routes are currently global (not scoped to workspace)
- Workaround: Each workspace publishes unique phone numbers; phone uniqueness at DB level prevents conflicts

---

## Error Handling & Recovery

### Dispatch Error Scenarios

| Scenario | HTTP | Action | Retry? |
|----------|------|--------|--------|
| Bad campaign ID | 400 | Dashboard to re-validate | No |
| Bad persona | 422 | Dashboard re-checks persona exists | No |
| Duplicate dispatch (same idempotency_key) | 409 | Return existing job_id | Yes (but succeeds immediately) |
| Engine down | 502 | Display error; user can retry | Yes (exponential backoff) |
| Exotel credentials invalid | 502 | Engine logs; user must fix ENV | No (needs config change) |

### Webhook Error Scenarios

| Scenario | HTTP | Action | Retry? |
|----------|------|--------|--------|
| Missing signature | 401 | Engine logs security event; does not retry | No |
| Invalid JSON | 400 | Engine logs; does not retry | No |
| Job not found (timing race) | 404 | Engine retries | Yes |
| DB constraint violation (call exists) | 409 | Dashboard has already processed it; return 200 | No |
| DB connection down | 500 | Engine retries | Yes |
| Network timeout | — | Engine retries | Yes |

---

## Testing & Local Development

### Without Exotel (Local Dev)

**Setup:**
1. Engine starts on `localhost:8000` (no Exotel integration)
2. Dashboard calls `POST /campaigns/dispatch` directly
3. Engine's dispatcher loop dials (but fails, no real Exotel)
4. Engine still generates webhook events
5. Dashboard still receives webhooks (localhost only; use `http://localhost:5173/api/webhooks/voice-engine`)

**Limitations:**
- No actual PSTN calls
- No Exotel status callbacks
- No WebSocket stream from Exotel

### With Exotel Test Account

**Setup:**
1. Set `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN` to test account
2. Set `PUBLIC_BASE_URL` to a public URL (use ngrok or similar)
3. Dashboard POSTs to `http://localhost:8000/campaigns/dispatch` (or public URL)
4. Engine dials real Exotel numbers (must be in test account allowlist)
5. Exotel calls back to `PUBLIC_BASE_URL/exotel/stream` (WebSocket) and `PUBLIC_BASE_URL/exotel/status` (HTTP)

**Testing Checklist:**
- [ ] Dispatch campaign
- [ ] Engine dials (check Exotel dashboard)
- [ ] Call completes
- [ ] Engine sends webhook
- [ ] Dashboard receives webhook (check webhook event table)
- [ ] Call record created in DB
- [ ] Outcome extracted correctly

---

**See also:**
- [api-reference.md](api-reference.md) — Full request/response formats
- [feature-flows.md](feature-flows.md) — Real-world dispatch flow example
