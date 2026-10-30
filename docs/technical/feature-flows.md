# Feature Flows & User Journeys

## Campaign Management

### Create Campaign (Outbound Calling)

**User Journey:**
1. Click "New Campaign" on dashboard
2. Fill in: Name, Persona (select from list), Voice (optional)
3. Set: Calling hours (09:00–18:00), Max retries (3), Retry gap (30 min), Callback window (3 days)
4. Click "Create"

**Backend Flow:**
```
POST /api [createCampaign]
  ↓
Dashboard validates via Zod schema
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Prisma: Create campaigns row
  - name, status='Scheduled', persona_key, voice, voice_id, voice_model_id
  - calling_start, calling_end, max_tries, retry_gap_minutes
  - client_id, created_by, timestamps
  ↓
Returns campaign object to React
```

**Data Persisted:**
- `campaigns` table: 1 row
- No leads yet; user will upload separately

---

### Upload Leads

**User Journey:**
1. In campaign, click "Upload Leads" (CSV or copy-paste)
2. CSV format: `name, phone`
3. Phone must be E.164 (e.g., `+919876543210`)
4. Click "Upload"

**Backend Flow:**
```
POST /api [importLeads]
  ↓
Validate phone format (regex)
  ↓
FOR EACH lead:
  - Check unique(campaign_id, phone)
  - Create leads row:
    {campaign_id, phone, name, outcome='Not called', queue_state='Queued'}
  ↓
Webhook to engine: (none; engine pulls from DB)
  ↓
Returns imported count to UI
```

**Data Persisted:**
- `leads` table: N rows (one per unique number)

---

### Start Campaign (Dispatch)

**User Journey:**
1. Campaign details page, click "Start Calling"
2. Dashboard shows: "Queuing leads..."
3. Within seconds: "Campaign started. Check the progress."

**Backend Flow:**
```
POST /api [startCampaignDispatch]
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Fetch campaign + leads + persona from DB
  ↓
Resolve prompt version + outcome rules
  ↓
Create voice_engine_jobs row:
  - idempotency_key = UUID
  - status = 'pending'
  - engine_job_id = null (not yet set by engine)
  ↓
POST {ENGINE_URL}/campaigns/dispatch
  {
    client_id, campaign_id, idempotency_key,
    persona: {...},
    outcome_rules: [...],
    leads: [{id, phone, name}, ...],
    calling_window: {start, end},
    max_tries, retry_gap_minutes
  }
  ↓
Engine returns: { job_id, status='pending' }
  ↓
Update voice_engine_jobs.engine_job_id = job_id
  ↓
Update campaigns.status = 'Calling'
  ↓
Return success to React
```

**Engine Parallel Process:**
```
Dispatcher loop (every 5 seconds):
  - Dequeue next lead (status='Queued')
  - POST /calls to Exotel
  - Wait for Exotel response (call placed or failed)
  - Update call record with exotel_call_sid
  - Wait for Exotel callback (StatusCallback)
  - On callback, close session and extract outcome
  - POST webhook to dashboard
```

---

### Monitor Campaign

**User Journey:**
1. Campaign details page shows:
   - Status: Calling / Paused / Completed
   - Leads: N total, M called, K queued
   - Calls: Outcome breakdown (Interested, Not interested, etc.)

**Data Source:**
- Fetch from `leads` + `calls` table (filtered by campaign_id)
- Real-time via React Query polling (5-10 sec interval)

**Pause Campaign:**
```
POST /api [updateCampaignStatus]
  nextStatus = 'Paused'
  ↓
Engine dispatcher stops picking up new leads
  ↓
In-progress calls complete naturally
  ↓
Can resume later (status = 'Calling')
```

---

## Inbound Call Routing

### Publish Inbound Number

**User Journey:**
1. Click "Inbound Calls"
2. Click "Claim Number" (shows available numbers or input custom)
3. Select persona to answer
4. Click "Publish"

**Backend Flow:**
```
POST /api [saveInboundNumber]
  {
    phone: "+919123456789",
    personaKey: "support-bot",
    workflow: "general",
    active: true
  }
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Fetch persona (must be active)
  ↓
Prisma: Create or update inbound_numbers row
  - phone (UNIQUE globally)
  - persona_key, workflow, active
  - client_id, created_at
  ↓
Create inbound_publications row (version 1):
  - snapshot = persona snapshot at this version
  - status = 'pending'
  ↓
POST /api [publishInboundNumber]
  ↓
POST {ENGINE_URL}/inbound/publish
  {
    phone, persona, workflow, active
  }
  ↓
Engine saves to inbound_route table
  ↓
Update inbound_publications.status = 'synced'
  ↓
Return success to React
```

**Data Persisted:**
- `inbound_numbers` table: 1 row
- `inbound_publications` table: 1 row (version 1)

---

### Receive Inbound Call

**Phone rings at +919123456789**

**Engine Flow:**
```
Exotel: Ring detected on number
  ↓
Exotel: Look up route (to any service)
  ↓
[Engine was configured as route for this number at onboarding]
  ↓
Exotel: POST (or HTTP request) to engine:/inbound/route?phone=...
  ↓
Engine lookup: SELECT * FROM inbound_route WHERE phone = '...'
  ↓
Found: agent_id = 102
  ↓
Engine returns: { agent_id, active }
  ↓
Exotel: Establish WebSocket
  wss://...@{PUBLIC_BASE_URL}/exotel/stream
  ↓
Engine: Create session, load agent 102
  ↓
Engine: TTS: agent.greeting → "Hello, how can I help?"
  ↓
Exotel: Play audio to caller
  ↓
[Loop: ASR → LLM → TTS] until hangup
  ↓
Exotel: Hangup (or timeout after 30 min)
  ↓
Engine: Extract outcome, summary
  ↓
Engine: POST webhook to dashboard
  {
    eventId, eventType='CallComplete',
    payload: {
      direction='inbound', outcome, summary, ...
    }
  }
  ↓
Dashboard: Create call record
```

---

## Persona Management

### Create Persona

**User Journey:**
1. Click "Prompts" (Personas)
2. Click "Create Persona"
3. Fill: Name, Persona Key (slug), Language, Purpose (workflow)
4. Enter: Instructions, Greeting, Knowledge (optional)
5. Click "Save"

**Backend Flow:**
```
POST /api [savePromptVersion]
  input.promptId = null (create new)
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Create prompts row:
  - personaKey (UNIQUE per clientId)
  - name, language, purpose, active=true
  - current_version = 1
  ↓
Create prompt_versions row (version 1):
  - content = { all fields from input }
  - created_by = userId
  ↓
Return prompt object to React
```

**Data Persisted:**
- `prompts` table: 1 row
- `prompt_versions` table: 1 row (version 1)

---

### Edit Persona (Save New Version)

**User Journey:**
1. Click "Prompts", select one
2. Edit instructions / knowledge / greeting
3. Click "Save"

**Backend Flow:**
```
POST /api [savePromptVersion]
  input.promptId = "prompt-uuid" (edit existing)
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Fetch prompts row
  ↓
current_version = 3 (e.g.)
  ↓
Create prompt_versions row (version 4):
  - content = {...updated...}
  - created_by = userId
  ↓
Update prompts row:
  - current_version = 4
  ↓
Return updated prompt to React
```

**Important:**
- Old versions immutable in `prompt_versions` table
- New campaigns use `current_version` at dispatch time
- Old campaigns keep their pinned version (via `persona_version` in `voice_engine_jobs`)

---

## Call Outcome Rules (Custom Outcomes)

### Setup Custom Rules

**User Journey:**
1. Click "Call Outcome Rules"
2. See default outcomes (workspace's built-in set)
3. Click "Add Custom Outcome"
4. Enter name ("Strongly Interested") and definition
5. Toggle "Enabled"
6. Click "Save"

**Backend Flow:**
```
POST /api [saveCallOutcomeSettings]
  {
    rules: [
      {id, name: "Interested", definition: "...", enabled: true, builtIn: true},
      {id, name: "Strongly Interested", definition: "...", enabled: true, builtIn: false}
    ],
    fallback: "No clear interest",
    shortHangupThresholdSeconds: 15
  }
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Validate:
  - All names unique
  - No rule named "Inconclusive" (reserved)
  - Fallback defined
  - Threshold in range [5, 300]
  ↓
Prisma: Upsert call_outcome_settings row (one per client):
  - rules = JSON array
  - fallback = text
  - short_hangup_threshold_seconds = int
  ↓
Return settings to React
```

**Data Persisted:**
- `call_outcome_settings` table: 1 row per workspace

### Use Custom Rules in Campaign

**When Dispatching:**
```
POST /api [startCampaignDispatch]
  ↓
Fetch engineOutcomeRulesForClient(db, clientId)
  ↓
Returns: { outcomeRules: [{name, definition}, ...], outcomeFallback: "..." }
  ↓
Include in engine request:
  {
    ...,
    outcome_rules: [{name: "Interested", ...}, ...],
    outcome_fallback: "No clear interest"
  }
  ↓
Engine: Build prompt with custom outcomes instead of defaults
  ↓
Engine: Extract outcome from LLM response
  ↓
Engine: Validate outcome is in list; fallback if not
  ↓
Webhook to dashboard: outcome = "Strongly Interested" (custom)
```

---

## Test Outbound Call

**User Journey:**
1. Campaign page, click "Test Call"
2. Enter: Persona (select), Phone number, Name (optional)
3. Click "Place Call"
4. Browser shows: "Placing call... CallID: #12345"
5. Call completes; results shown

**Backend Flow:**
```
POST /api [testOutboundCall]
  {
    personaKey: "sales-bot",
    to: "+919876543210",
    contactName: "John"
  }
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Fetch persona by key (must be active)
  ↓
Build persona snapshot
  ↓
Fetch outcome rules for workspace
  ↓
POST {ENGINE_URL}/calls/test
  {
    client_id,
    persona: {...},
    outcome_rules: [...],
    to, contact_name
  }
  ↓
Engine: Create temporary agent from persona snapshot
  ↓
Engine: Place call (same as campaign call)
  ↓
Engine: Return call ID immediately
  ↓
Dashboard: Poll /api/calls?callId=... for status
  ↓
Engine webhooks CallComplete
  ↓
Dashboard: Display outcome, transcript ref
```

**Important:**
- Test call still dials a REAL number (no mock)
- Still costs credits if CLIENT_ID set
- Useful for validating persona before starting campaign

---

## Call Analytics & Reporting

### Overview Page

**Components:**
1. **Balance Card:** Current credits, top-up button
2. **Stats Cards:** Active campaigns, Leads uploaded, Callback requests
3. **Funnel Chart:** Dialled → Interested (by count)
4. **Time Series Chart:** Calls per day (last 30 days)

**Data Source:**
```
GET /api [getWorkspaceOverview]
  range = "this-month" (default)
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Query calls table:
  SELECT COUNT(*) FROM calls WHERE client_id=? AND created_at > ?
  GROUP BY outcome
  ↓
Query campaigns + leads:
  Active campaigns, total leads, callback requests
  ↓
Return aggregated stats to React
```

---

### Call Journal (All Calls)

**User Journey:**
1. Click "Call Journal"
2. Filter by: Direction (Inbound/Outbound), Outcome, Campaign, Date range
3. See paginated list: Phone, Campaign, Outcome, Duration, Date
4. Click row to expand: Transcript, Summary, Collected fields

**Data Source:**
```
GET /api [listCalls]
  filter: {direction?, outcome?, campaignId?, limit?, offset?}
  ↓
currentWorkspaceClient(db, userId) → clientId
  ↓
Query calls table (with indexes):
  WHERE client_id=?
  AND direction=? (if provided)
  AND outcome=? (if provided)
  AND campaign_id=? (if provided)
  ORDER BY created_at DESC
  LIMIT, OFFSET
  ↓
Fetch related campaign, lead, outcome_raw
  ↓
Return to React for display
```

---

### Missed Callbacks

**User Journey:**
1. Click "Missed Callbacks"
2. See calls with `outcome='Callback'` and follow_up_at in the past
3. Click "Call Back" to queue for re-dial
4. Add note (optional)

**Data Source:**
```
SELECT * FROM calls
WHERE client_id=?
AND outcome='Callback'
AND created_at > NOW() - INTERVAL 3 DAYS  // Or callback_window_days
AND follow_up_at < NOW()
ORDER BY created_at DESC
```

---

## Voice Picker Feature

**User Journey:**
1. Campaign setup, click "Voice" dropdown
2. Dashboard fetches list from engine: GET /voices
3. Shows: "English 1 (Bakbak Standard)", "English 2 (ElevenLabs Flash)"
4. User selects one
5. On dispatch, selected voice_id + tts_model_id sent to engine

**Backend Flow:**
```
GET /api [getVoiceOptions]
  ↓
POST {ENGINE_URL}/voices
  ↓
Engine queries TTS provider:
  - Bakbak: GET /voices (filtered by language)
  - ElevenLabs: Hard-coded voice list
  ↓
Engine returns formatted list
  ↓
Dashboard caches (5-min stale time)
  ↓
React displays in dropdown
  ↓
User selects → campaign.voice_id, campaign.voice_model_id set
  ↓
On dispatch, sent to engine
  ↓
Engine applies voice to this campaign's calls
```

**Data Persisted:**
- `campaigns.voice_id` — Engine voice ID
- `campaigns.voice_model_id` — TTS model (e.g., "standard", "m1")

---

## Credit System (Conceptual)

**Current Status:** Integer `clients.credit_balance`; no integration with payment system.

**Flow (if payment were integrated):**
```
User topup $100
  ↓
Payment provider charges card
  ↓
Dashboard creates credit_transactions row:
  { client_id, amount=1000, note="Topup" }
  ↓
clients.credit_balance += 1000
  ↓
On each call:
  - Engine estimates cost (length, TTS provider, LLM calls)
  - Deducts from credit_balance
  - Creates credit_transactions row: { amount=-X, note="Call #123" }
```

**Not Implemented:**
- Payment provider integration
- Real cost calculation (currently static)
- Credit cap enforcement (campaign.credit_cap is set but not enforced)
- Low balance warnings

---

**See also:**
- [architecture.md](architecture.md) — Call flow diagrams
- [api-reference.md](api-reference.md) — Full API contract for each endpoint
