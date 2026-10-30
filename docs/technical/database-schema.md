# Database Schema

## Overview

**Dashboard Database:** PostgreSQL managed by Prisma ORM  
**Engine Database:** Shares the same PostgreSQL instance; engine applies hand-written migrations at startup  
**Location:** Both use same `DATABASE_URL` (default: `postgresql://mona:mona_local_only@localhost:5434/mona[_test]`)

---

## Dashboard Schema (Prisma)

### users
Local user accounts with salted scrypt password hashes.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) UNIQUE NOT NULL,
  full_name varchar(100) DEFAULT '',
  password_hash text NOT NULL,
  created_at timestamptz(6) DEFAULT now()
);
```

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK | Generated UUID |
| `email` | VARCHAR(255) | UNIQUE | User's email; used for login |
| `full_name` | VARCHAR(100) | Optional | Display name |
| `password_hash` | TEXT | NOT NULL | Scrypt hash, never plaintext |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | Account creation time |

---

### sessions
Opaque session tokens for authenticated requests. Tokens are never stored plaintext; only SHA-256 hash is persisted.

```sql
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) DEFAULT now()
);

CREATE INDEX sessions_user_id ON sessions(user_id);
CREATE INDEX sessions_expires_at ON sessions(expires_at);
```

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK | Session record ID |
| `user_id` | UUID | FK → users | Owner of session |
| `token_hash` | TEXT | UNIQUE | SHA-256(token); token never stored |
| `expires_at` | TIMESTAMPTZ | | When session becomes invalid |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | When session was created |

---

### clients
Multi-tenant workspaces. Every user is a member of zero or more clients.

```sql
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status varchar(20) DEFAULT 'active',
  credit_balance integer DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz(6) DEFAULT now()
);
```

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK | Workspace ID |
| `name` | TEXT | NOT NULL | Workspace name |
| `status` | VARCHAR(20) | CHECK (status IN ('active', 'suspended', ...)) | Operational status |
| `credit_balance` | INTEGER | DEFAULT 0 | Prepaid credits for calls |
| `created_by` | UUID | FK → users | Admin who created |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | When workspace created |

---

### client_members
User × Client association (many-to-many with role).

```sql
CREATE TABLE client_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) DEFAULT 'member',
  invited_email varchar(255) DEFAULT '',
  created_at timestamptz(6) DEFAULT now(),
  UNIQUE (client_id, user_id)
);

CREATE INDEX client_members_user_id ON client_members(user_id);
```

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK | Membership record ID |
| `client_id` | UUID | FK → clients | Workspace |
| `user_id` | UUID | FK → users | Team member |
| `role` | VARCHAR(20) | CHECK IN ('owner', 'member') | Permission level |
| `invited_email` | VARCHAR(255) | | Email invited (for pending invites) |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | When joined |

---

### campaigns
Outbound call campaigns: lead lists, persona, schedule, retry settings.

```sql
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  purpose text DEFAULT '',
  status varchar(20) DEFAULT 'Scheduled',
  persona_key text DEFAULT '',
  voice text DEFAULT '',
  voice_id text DEFAULT '',
  voice_model_id text DEFAULT '',
  ambience boolean DEFAULT false,
  calling_start varchar(5) DEFAULT '09:00',
  calling_end varchar(5) DEFAULT '18:00',
  max_tries integer DEFAULT 3,
  retry_gap_minutes integer DEFAULT 30,
  callback_window_days integer DEFAULT 3,
  credit_cap integer,
  created_by uuid REFERENCES users(id),
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now()
);

CREATE INDEX campaigns_client_created ON campaigns(client_id, created_at);
```

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK | Campaign ID |
| `client_id` | UUID | FK | Workspace owner |
| `name` | VARCHAR(100) | NOT NULL | Campaign name |
| `status` | VARCHAR(20) | CHECK IN ('Scheduled', 'Calling', 'Paused', 'Completed', 'Cancelled') | Current state |
| `persona_key` | TEXT | | Which persona to use (must exist in prompts) |
| `voice` | TEXT | | Voice display name (from UI) |
| `voice_id` | TEXT | | Engine voice ID (from GET /voices) |
| `voice_model_id` | TEXT | | Engine TTS model ID |
| `ambience` | BOOLEAN | DEFAULT false | Ambient background noise in TTS |
| `calling_start` / `calling_end` | VARCHAR(5) | | HH:MM calling hours (24-hour) |
| `max_tries` | INTEGER | | How many times to dial each lead |
| `retry_gap_minutes` | INTEGER | | Minutes between retries |
| `callback_window_days` | INTEGER | | Days to honor callback requests |
| `credit_cap` | INTEGER | Optional | Max credits to spend (NULL = no limit) |
| `created_by` | UUID | FK | User who created |
| `created_at`, `updated_at` | TIMESTAMPTZ | | Timestamps |

---

### leads
Phone numbers to call in a campaign.

```sql
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name text DEFAULT '—',
  phone varchar(16) NOT NULL,
  outcome text DEFAULT 'Not called',
  queue_state text DEFAULT 'Queued',
  attempts integer DEFAULT 0,
  follow_up_at timestamptz(6),
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now(),
  UNIQUE (campaign_id, phone)
);

CREATE INDEX leads_client_id ON leads(client_id);
```

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK | Lead ID |
| `campaign_id` | UUID | FK | Parent campaign |
| `name` | TEXT | | Contact name (optional; default "—") |
| `phone` | VARCHAR(16) | | E.164 phone number |
| `outcome` | TEXT | | Call result (Not called, Interested, Not interested, etc.) |
| `queue_state` | TEXT | CHECK IN ('Queued', 'Calling', 'Completed', 'Failed', ...) | Internal state |
| `attempts` | INTEGER | | Number of dial attempts |
| `follow_up_at` | TIMESTAMPTZ | | When to retry (if scheduled) |

---

### prompts
Persona definitions: instructions, knowledge, greeting.

```sql
CREATE TABLE prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  persona_key varchar(40) NOT NULL,
  name varchar(100) NOT NULL,
  purpose text DEFAULT '',
  active boolean DEFAULT true,
  language varchar(20) DEFAULT 'English',
  instructions text DEFAULT '',
  knowledge text DEFAULT '',
  greeting text DEFAULT '',
  current_version integer DEFAULT 1,
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now(),
  UNIQUE (client_id, persona_key)
);
```

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK | Prompt ID |
| `persona_key` | VARCHAR(40) | UNIQUE per client | Slug used in campaigns/routes |
| `name` | VARCHAR(100) | | Display name |
| `purpose` | TEXT | | Workflow type for this persona |
| `active` | BOOLEAN | | Whether this persona is available |
| `language` | VARCHAR(20) | | Call language (en, hi, ta, te) |
| `instructions` | TEXT | | System prompt for LLM |
| `knowledge` | TEXT | | Facts/FAQ for LLM context |
| `greeting` | TEXT | | Opening sentence TTS will say |
| `current_version` | INTEGER | | Latest version number |

---

### prompt_versions
Immutable snapshots of prompt content (insert-only, never updated).

```sql
CREATE TABLE prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz(6) DEFAULT now(),
  UNIQUE (prompt_id, version)
);
```

| Field | Type | Notes |
|-------|------|-------|
| `content` | JSONB | Full prompt snapshot at this version |

---

### calls
Completed call records (inbound + outbound).

```sql
CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  job_id uuid REFERENCES voice_engine_jobs(id) ON DELETE SET NULL,
  inbound_number_id uuid REFERENCES inbound_numbers(id) ON DELETE SET NULL,
  direction text DEFAULT 'outbound',
  caller_number varchar(20),
  dialled_number varchar(20),
  status varchar(40) DEFAULT 'completed',
  outcome text DEFAULT 'completed',
  outcome_raw varchar(200),
  summary text,
  collected_fields jsonb,
  duration_seconds integer DEFAULT 0,
  transcript_url text,
  transcript_ref varchar(40),
  engine_call_id text UNIQUE,
  reported_at timestamptz(6),
  created_at timestamptz(6) DEFAULT now()
);

CREATE INDEX calls_client_created ON calls(client_id, created_at);
CREATE INDEX calls_client_direction_created ON calls(client_id, direction, created_at DESC);
CREATE INDEX calls_client_outcome ON calls(client_id, outcome);
CREATE INDEX calls_campaign_id ON calls(campaign_id);
```

| Field | Type | Notes |
|-------|------|-------|
| `direction` | TEXT | 'inbound' or 'outbound' |
| `caller_number` | VARCHAR(20) | Inbound: who called; outbound: null |
| `dialled_number` | VARCHAR(20) | Outbound: who was called; inbound: our number |
| `status` | VARCHAR(40) | Technical status (connected, completed, failed, ...) |
| `outcome` | TEXT | Business outcome (Interested, Not interested, Callback, ...) |
| `outcome_raw` | VARCHAR(200) | Engine's raw classification before normalization |
| `summary` | TEXT | AI-generated call summary |
| `collected_fields` | JSONB | Structured data collected during call |
| `transcript_ref` | VARCHAR(40) | Engine call ID (opaque reference to transcript) |
| `engine_call_id` | TEXT | UNIQUE reference to engine's call record |
| `reported_at` | TIMESTAMPTZ | When engine reported this call |

---

### voice_engine_jobs
Campaign dispatch jobs sent to the engine.

```sql
CREATE TABLE voice_engine_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  idempotency_key uuid UNIQUE DEFAULT gen_random_uuid(),
  status text DEFAULT 'pending',
  persona_version integer,
  engine_job_id text UNIQUE,
  last_error text,
  dispatched_at timestamptz(6),
  completed_at timestamptz(6),
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now()
);

CREATE INDEX voice_engine_jobs_campaign ON voice_engine_jobs(campaign_id);
```

| Field | Type | Notes |
|-------|------|-------|
| `status` | TEXT | 'pending', 'dispatched', 'running', 'completed', 'failed' |
| `idempotency_key` | UUID | Idempotent dispatch retry (unique per job) |
| `engine_job_id` | TEXT | UNIQUE ID returned by engine |
| `last_error` | TEXT | If failed, error message from engine |
| `persona_version` | INTEGER | Prompt version used |

---

### voice_engine_webhook_events
Deduplicated webhook deliveries from engine (keyed by engine's eventId).

```sql
CREATE TABLE voice_engine_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text UNIQUE NOT NULL,
  job_id uuid REFERENCES voice_engine_jobs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz(6) DEFAULT now()
);

CREATE INDEX voice_engine_webhook_events_job ON voice_engine_webhook_events(job_id);
```

| Field | Type | Notes |
|-------|------|-------|
| `event_id` | TEXT | UNIQUE engine-generated event ID (UUID format) |
| `event_type` | TEXT | 'CallUpdate', 'CallComplete', etc. |
| `payload` | JSONB | Full webhook body from engine |

---

### inbound_numbers
Phone numbers that route inbound calls to a persona.

```sql
CREATE TABLE inbound_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone varchar(16) UNIQUE NOT NULL,
  persona_key varchar(40) NOT NULL,
  workflow text DEFAULT 'general',
  active boolean DEFAULT true,
  known_engine_version integer DEFAULT 0,
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now()
);

CREATE INDEX inbound_numbers_client ON inbound_numbers(client_id);
```

| Field | Type | Notes |
|-------|------|-------|
| `phone` | VARCHAR(16) | UNIQUE globally (one workspace per number) |
| `persona_key` | VARCHAR(40) | Which persona answers this number |
| `workflow` | TEXT | Persona's workflow type (general, faq, lead_qual, ...) |
| `active` | BOOLEAN | Whether this route is published to engine |
| `known_engine_version` | INTEGER | Latest version engine acknowledged |

---

### inbound_publications
Publishing history for inbound numbers (immutable snapshots).

```sql
CREATE TABLE inbound_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number_id uuid NOT NULL REFERENCES inbound_numbers(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text DEFAULT 'pending',
  snapshot jsonb NOT NULL,
  persona_version integer NOT NULL,
  error text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz(6) DEFAULT now(),
  synced_at timestamptz(6),
  UNIQUE (number_id, version)
);
```

| Field | Type | Notes |
|-------|------|-------|
| `snapshot` | JSONB | Exact persona state sent to engine |
| `status` | TEXT | 'pending', 'synced', 'failed' |

---

### call_outcome_settings
Workspace's custom Call Outcome Rules (one row per workspace).

```sql
CREATE TABLE call_outcome_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid UNIQUE NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rules jsonb DEFAULT '[]',
  fallback text DEFAULT '',
  short_hangup_threshold_seconds integer DEFAULT 15,
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now()
);
```

| Field | Type | Notes |
|-------|------|-------|
| `rules` | JSONB | Array of `{id, name, definition, enabled, builtIn}` |
| `fallback` | TEXT | Definition for 'Inconclusive' outcome |
| `short_hangup_threshold_seconds` | INTEGER | Calls shorter than this are marked "Short Hangup" |

---

### credit_transactions
Audit log for credit balance changes.

```sql
CREATE TABLE credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  note text DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz(6) DEFAULT now()
);

CREATE INDEX credit_transactions_client_created ON credit_transactions(client_id, created_at);
```

---

### demo_requests
Public form submissions (no tenant scoping).

```sql
CREATE TABLE demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  email varchar(255) NOT NULL,
  phone varchar(20) NOT NULL,
  company varchar(120) DEFAULT '',
  message varchar(600) DEFAULT '',
  created_at timestamptz(6) DEFAULT now()
);

CREATE INDEX demo_requests_created ON demo_requests(created_at DESC);
```

---

## Engine Schema (Hand-Written SQL Migrations)

Located in `agent/app/migrations/*.sql`, applied at startup by `app/db.py::migrate()`.

### agents
Versioned persona/agent configurations.

```sql
CREATE TABLE agents (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  language VARCHAR(20) NOT NULL,
  workflow VARCHAR(20) DEFAULT 'general',
  instructions TEXT NOT NULL,
  greeting TEXT NOT NULL,
  knowledge TEXT DEFAULT '',
  collect_fields TEXT[] DEFAULT '{}',
  outcome_rules JSONB DEFAULT '[]',
  outcome_fallback TEXT,
  voice_id VARCHAR(100),
  tts_model_id VARCHAR(100),
  llm_model VARCHAR(100),
  is_inbound_default BOOLEAN DEFAULT false,
  client_id VARCHAR(64),
  persona_key VARCHAR(40),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, persona_key)
);
```

### inbound_route
Routes incoming phone calls to agents.

```sql
CREATE TABLE inbound_route (
  phone VARCHAR(16) PRIMARY KEY,
  agent_id INTEGER UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  active BOOLEAN DEFAULT true
);
```

### call
Shared with dashboard (engine's perspective).

```sql
CREATE TABLE call (
  id SERIAL PRIMARY KEY,
  engine_call_id UUID UNIQUE NOT NULL,
  agent_id INTEGER REFERENCES agents(id),
  direction VARCHAR(20) NOT NULL,
  status VARCHAR(40) NOT NULL,
  outcome VARCHAR(100),
  outcome_raw VARCHAR(200),
  duration_seconds INTEGER DEFAULT 0,
  summary TEXT,
  collected_fields JSONB,
  transcript_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### voice_engine_job
Mirrors dashboard's `voice_engine_jobs` table.

```sql
CREATE TABLE voice_engine_job (
  id UUID PRIMARY KEY,
  engine_job_id UUID UNIQUE,
  client_id VARCHAR(64),
  campaign_id VARCHAR(64),
  status VARCHAR(40) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : "creates"
    USERS ||--o{ CLIENT_MEMBERS : "joins"
    USERS ||--o{ CREDIT_TRANSACTIONS : "initiates"
    
    CLIENTS ||--o{ CLIENT_MEMBERS : "has"
    CLIENTS ||--o{ CAMPAIGNS : "owns"
    CLIENTS ||--o{ LEADS : "owns"
    CLIENTS ||--o{ PROMPTS : "owns"
    CLIENTS ||--o{ CALLS : "records"
    CLIENTS ||--o{ VOICE_ENGINE_JOBS : "owns"
    CLIENTS ||--o{ INBOUND_NUMBERS : "owns"
    CLIENTS ||--o{ CREDIT_TRANSACTIONS : "tracks"
    CLIENTS ||--|| CALL_OUTCOME_SETTINGS : "has"
    
    CAMPAIGNS ||--o{ LEADS : "contains"
    CAMPAIGNS ||--o{ CALLS : "generates"
    CAMPAIGNS ||--o{ VOICE_ENGINE_JOBS : "dispatches"
    
    LEADS ||--o{ CALLS : "results in"
    
    PROMPTS ||--o{ PROMPT_VERSIONS : "versions"
    
    INBOUND_NUMBERS ||--o{ CALLS : "receives"
    INBOUND_NUMBERS ||--o{ INBOUND_PUBLICATIONS : "publishes"
    
    VOICE_ENGINE_JOBS ||--o{ CALLS : "produces"
    VOICE_ENGINE_JOBS ||--o{ VOICE_ENGINE_WEBHOOK_EVENTS : "triggers"
    
    CALL_OUTCOME_SETTINGS ||--o{ CALLS : "classifies"
```

---

## Key Constraints & Indexes

| Name | Table | Constraint | Purpose |
|------|-------|-----------|---------|
| `voice_engine_jobs_one_active_per_campaign` | voice_engine_jobs | UNIQUE (campaign_id) WHERE status NOT IN ('completed', 'cancelled') | Prevents duplicate active jobs |
| `leads_unique_phone_per_campaign` | leads | UNIQUE (campaign_id, phone) | One entry per number per campaign |
| `prompts_unique_persona_per_client` | prompts | UNIQUE (client_id, persona_key) | Persona names unique per workspace |
| `inbound_numbers_unique_phone` | inbound_numbers | UNIQUE (phone) | Phone number globally unique |
| `calls_idx_client_created` | calls | INDEX (client_id, created_at) | Query recent calls |
| `calls_idx_outcome` | calls | INDEX (client_id, outcome) | Filter by result |
| `sessions_idx_expires` | sessions | INDEX (expires_at) | Clean up expired sessions |

---

## Migration History

Dashboard migrations stored in `prisma/migrations/TIMESTAMP_*/migration.sql`. Engine migrations in `agent/app/migrations/NNN_*.sql`.

Recent migrations:
- `20261029120000_dispatch_recovery` — Orphaned job prevention with widened unique constraint
- `20261029130000_campaign_voice_choice` — Added `voice_id`, `voice_model_id` to campaigns
- `20261029140000_call_outcome_settings` — New table for workspace outcome rules

---

## Migration Best Practices

1. **Dashboard:** Use Prisma's `prisma migrate dev` to generate migrations automatically
2. **Engine:** Write SQL by hand in `agent/app/migrations/NNN_name.sql`; applied sequentially at startup
3. **Rollback:** Always test down-migration before deploying
4. **Deadlock avoidance:** Acquire locks in the same order across all migrations
5. **Long transactions:** Use separate transactions for schema changes + data backfill

---

**See also:**
- [configuration.md](configuration.md) — Environment variables for DATABASE_URL
- [deployment-operations.md](deployment-operations.md) — Running migrations locally and in production
