# System Architecture

## High-Level Component Diagram

```mermaid
graph TB
    User["👤 User<br/>(Browser)"]
    Dashboard["📊 Dashboard<br/>TanStack Start<br/>Port 5173"]
    DashDB["🗄️ PostgreSQL<br/>Dashboard DB"]
    EngineApp["🎤 Voice Engine<br/>FastAPI<br/>Port 8000"]
    EngineDB["🗄️ PostgreSQL<br/>Shared with Dashboard"]
    Exotel["☎️ Exotel<br/>(PSTN Gateway)"]
    ElevenLabs["🔊 ElevenLabs<br/>(TTS + ASR)"]
    Bakbak["🎵 Bakbak<br/>(TTS Alternative)"]
    LLM["🧠 LLM<br/>(Groq or<br/>OpenRouter)"]
    
    User -->|HTTP| Dashboard
    Dashboard -->|Server Functions| DashDB
    Dashboard -->|REST API| EngineApp
    Dashboard -->|Webhook<br/>POST| EngineApp
    EngineApp -->|SQL| EngineDB
    EngineApp -->|WebSocket<br/>+<br/>Callbacks| Exotel
    EngineApp -->|REST| ElevenLabs
    EngineApp -->|REST| Bakbak
    EngineApp -->|REST| LLM
```

## Network Topology

```
Public Internet
  │
  ├─ Exotel PSTN Gateway (public IP)
  │  └─ Calls from/to real phone numbers
  │
  ├─ Dashboard (VOICE_ENGINE_WEBHOOK_URL must be reachable)
  │  └─ Receives engine webhooks
  │
  └─ Engine (PUBLIC_BASE_URL must be reachable by Exotel)
     └─ Exotel calls this URL for WebSocket stream + status callbacks

Local (or Docker network)
  │
  ├─ TanStack Start dev server (localhost:5173)
  ├─ FastAPI engine (localhost:8000)
  └─ PostgreSQL (localhost:5434)
```

## Deployment Tiers

### Local Development
- Single machine: Dashboard, engine, PostgreSQL all on localhost
- No external PSTN; uses Exotel test account
- All process state in memory (no distributed sessions)

### Docker Compose (Local or Single-Server)
- Each service in a container
- Shared `bridge` network
- PostgreSQL in a named volume (persists across restarts)
- Exotel credentials from `.env`

### Production (Example: Cloud)
- Dashboard: Cloud-hosted static files (React build) + server-side functions on cloud runtime
- Engine: Containerized FastAPI on compute instance (e.g., Railway, AWS Lambda+SQS, GCP Cloud Run)
- Database: Managed PostgreSQL (Supabase, RDS, Cloud SQL)
- Telephony: Exotel on public IP; webhooks point to dashboard public URL
- LLM: Groq/OpenRouter rate-limited by paid API key

## Call Flow Sequences

### Outbound Call (Campaign Dispatch)

```mermaid
sequenceDiagram
    participant User as User
    participant Dashboard as Dashboard<br/>Node.js
    participant Engine as Engine<br/>FastAPI
    participant Exotel as Exotel<br/>PSTN
    participant Recipient as Recipient<br/>(Phone)
    participant LLM as LLM<br/>(Groq/OpenRouter)
    
    User->>Dashboard: Start campaign<br/>POST startCampaignDispatch
    Dashboard->>Dashboard: Validate, fetch leads + persona
    Dashboard->>Engine: Dispatch campaign<br/>POST /campaigns/dispatch<br/>(leads, persona, voice)
    Engine->>Engine: Create job, dedupe by idempotency key
    Engine->>Engine: Return job ID
    Dashboard->>Dashboard: Save job ID to DB
    
    loop Engine background dispatcher
        Engine->>Engine: Dequeue next lead
        Engine->>Exotel: POST connect call<br/>From: inbound #, To: lead phone
        Exotel->>Exotel: Dial number
        Exotel->>Engine: 200 OK, CallSid
        Engine->>Engine: Save call_id + exotel_sid
    end
    
    Exotel->>Recipient: Ring
    Recipient->>Exotel: Answer
    Exotel->>Engine: Establish WebSocket<br/>wss://...?CallSid=...
    Engine->>Engine: Create session for CallSid
    
    loop Call active (until hangup or timeout)
        Recipient->>Exotel: Speech input
        Exotel->>Engine: Audio bytes over WebSocket
        Engine->>Engine: ASR (ElevenLabs Scribe)
        Engine->>LLM: LLM prompt<br/>(instructions + transcript)
        LLM->>Engine: Reply text
        Engine->>Engine: TTS (Bakbak or ElevenLabs)
        Engine->>Exotel: Audio bytes (play reply)
        Exotel->>Recipient: Play audio
    end
    
    Recipient->>Exotel: Hangup
    Exotel->>Engine: WebSocket close
    Engine->>Engine: Extract outcome, summary
    Engine->>Engine: Classify call end reason
    
    Engine->>Dashboard: POST /api/webhooks/voice-engine<br/>CallComplete event
    Dashboard->>Dashboard: Save call record + outcome
    Dashboard->>User: Display call in history
```

### Inbound Call (With Routing)

```mermaid
sequenceDiagram
    participant Caller as Caller<br/>(Phone)
    participant Exotel as Exotel<br/>Gateway
    participant Engine as Engine<br/>FastAPI
    participant Dashboard as Dashboard<br/>Node.js
    participant LLM as LLM
    
    Caller->>Exotel: Dial +91-number
    Exotel->>Engine: Check route (via webhook)
    Note over Engine: Look up InboundNumber<br/>by dialled phone
    Engine->>Dashboard: (or local lookup)
    Dashboard->>Engine: RouteResponse
    
    Exotel->>Engine: Establish WebSocket
    Engine->>Engine: Create session, load persona
    
    loop Call active
        Caller->>Exotel: Speak
        Exotel->>Engine: Audio + transcripts
        Engine->>LLM: Converse
        LLM->>Engine: Reply
        Engine->>Exotel: TTS audio
        Exotel->>Caller: Play
    end
    
    Caller->>Exotel: Hangup
    Engine->>Dashboard: POST CallComplete webhook
    Dashboard->>Dashboard: Record inbound call
```

### Webhook Delivery (With Retry & Idempotency)

```mermaid
sequenceDiagram
    participant Engine as Engine
    participant Dashboard as Dashboard
    participant DB as Dashboard DB
    
    Engine->>Engine: Call completed<br/>Generate eventId (UUID)
    Engine->>Dashboard: POST /api/webhooks/voice-engine<br/>Headers: x-voice-engine-signature (HMAC)
    
    alt Dashboard Accepts (2xx)
        Dashboard->>Dashboard: Verify signature
        Dashboard->>DB: Check eventId not already seen
        Dashboard->>DB: Insert webhook event
        Dashboard->>DB: Update call record (outcome, transcript_ref)
        Dashboard->>Engine: 200 OK
        Engine->>Engine: Mark delivered, stop retry
    else Dashboard Returns 4xx (400, 403, 404, 409)
        Dashboard->>Engine: 4xx with reason
        Engine->>Engine: Log, do not retry (unrecoverable)
    else Dashboard Returns 5xx or Timeout (408, 429, 5xx)
        Engine->>Engine: Backoff + retry later (exponential, ~6 attempts)
        Note over Engine: Webhook event kept in queue
    end
    
    Note over Dashboard: Duplicate delivery (same eventId):<br/>Dashboard idempotently returns 200
```

## Persona Versioning

```mermaid
graph LR
    subgraph Dashboard["Dashboard (Mona)"]
        Prompt["Prompt<br/>(Current Draft)"]
        PV1["PromptVersion 1"]
        PV2["PromptVersion 2"]
        PV3["PromptVersion 3<br/>(Current)"]
    end
    
    subgraph Engine["Engine"]
        A1["Agent ID 101<br/>v1"]
        A2["Agent ID 102<br/>v2"]
        A3["Agent ID 103<br/>v3"]
    end
    
    subgraph Calls["Active Calls"]
        C1["Campaign Call<br/>uses Agent 103"]
        C2["Inbound Call<br/>uses Agent 103"]
    end
    
    Prompt -->|Save| PV3
    PV3 -->|Post to Engine| A3
    A3 --> C1
    A3 --> C2
    
    style Prompt fill:#e1f5ff
    style A3 fill:#c8e6c9
    style C1 fill:#fff9c4
    style C2 fill:#fff9c4
```

## Call State Machine (Engine Side)

```mermaid
stateDiagram-v2
    [*] --> pending: Call initiated

    pending --> connecting: Dial Exotel
    
    pending --> failed: Dial failed immediately
    
    connecting --> active: Call answered
    
    connecting --> failed: Dial timeout<br/>or<br/>No answer
    
    active --> ended: Recipient hangup<br/>or<br/>Agent disconnect
    
    active --> failed: Network error<br/>during call
    
    failed --> [*]
    ended --> [*]
    
    note right of active
        WebSocket open
        ASR↔LLM↔TTS active
        State persisted to DB
    end
```

## Data Models Relationship Overview

### Dashboard Database (Prisma)

```
┌─────────────────┐
│      User       │
│   (Local Auth)  │
└────────┬────────┘
         │
         │ 1:N
         ↓
┌─────────────────────┐
│   ClientMember      │ ← Workspace membership
│ (User × Client)     │
└────────┬────────────┘
         │
         │ N:1
         ↓
┌─────────────────┐
│     Client      │ ← Multi-tenant workspace
│  (Workspace)    │
└────┬────┬──┬──┬─────────────────┐
     │    │  │  │                 │
     │    │  │  │ 1:N             │ 1:N
     │    │  │  └──→ Campaign     │ InboundNumber
     │    │  │       Lead ←─────┐ │
     │    │  │       Call       │ │
     │    │  │ 1:N              │ │
     │    │  └──→ Prompt        │ │
     │    │  │    PromptVersion │ │
     │    │  │                  │ │
     │    │  └──→ VoiceEngineJob│ │
     │    │                     │ │
     │    └─→ CreditTransaction │ │
     │                          │ │
     └──────→ CallOutcomeSettings
              (one per workspace)
```

### Engine Database (Hand-Written SQL)

```
agent
├── id (primary)
├── name, instructions, greeting, knowledge
├── language, workflow
├── outcome_rules[], outcome_fallback (JSON)
├── voice_id, tts_model_id
├── client_id (nullable; null = engine-wide default)
└── persona_key (unique per client; null = anonymous)

voice_engine_job
├── id (primary)
├── client_id, campaign_id (both from Dashboard)
├── engine_job_id (Exotel job reference)
├── status (pending, dispatched, running, completed, failed)
└── created_at, completed_at

inbound_route
├── phone (unique)
├── agent_id
└── active

call (shared with Dashboard)
├── id (primary)
├── engine_call_id (unique)
├── status, direction, duration_seconds
├── outcome (extracted by LLM)
└── outcome_raw (engine's raw classification)
```

## Request/Response Flow Example: Test Outbound Call

```
1. User clicks "Place test call" on dashboard
2. Browser: POST /api/test-outbound-call
   {
     personaKey: "my-persona",
     to: "+919876543210",
     contactName: "John Doe"
   }

3. Dashboard server fn (requireAuth + Zod validation):
   - Fetch persona by key + workspace
   - Resolve workspace client
   - Fetch outcome rules for workspace
   - POST to engine: /calls/test
   {
     client_id: "...",
     persona: { key, instructions, knowledge, ... },
     outcome_rules: [...],
     to: "+919876543210",
     contact_name: "John Doe"
   }

4. Engine:
   - POST /calls/test (no agent_id needed; uses persona snapshot)
   - Creates temporary agent from persona snapshot
   - Calls place_outbound_call (same as campaign dispatch)
   - Returns call ID immediately

5. Dashboard returns call ID to browser
6. Browser polls /api/calls/{callId} or subscribes to live updates
7. Engine dials, records call
8. Engine webhooks CallComplete back to dashboard
9. Dashboard displays call in "Recent Calls"
```

---

**See also:**
- [voice-pipeline.md](voice-pipeline.md) — Detailed voice processing flow
- [feature-flows.md](feature-flows.md) — Feature-specific sequences (campaigns, inbound routing, etc.)
- [integration-contracts.md](integration-contracts.md) — Message formats and contracts
