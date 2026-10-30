# Configuration Reference

## Engine Configuration (`agent/app/config.py`)

All settings via environment variables or `.env` file (Pydantic BaseSettings).

### Startup & Server

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `LOG_LEVEL` | str | No | INFO | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `HOST` | str | No | 0.0.0.0 | Bind address for FastAPI server |
| `PORT` | int | No | 8000 | Port for FastAPI server |
| `APP_SECRET_KEY` | str | **YES** | — | Bearer token for `/agents`, `/calls`, `/campaigns/dispatch` routes. Any unguessable string. |
| `PUBLIC_BASE_URL` | str | **YES** | — | Public HTTPS URL of engine (used by Exotel for callbacks). Example: `https://voice-engine.example.com` or `https://engine-public.ngrok.io` for local dev. |

---

### Database

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `DATABASE_URL` | str | **YES** | — | PostgreSQL connection string. Format: `postgresql://user:pass@host:port/dbname`. Both dashboard and engine connect to same DB. |
| `DATABASE_POOL_MIN_SIZE` | int | No | 1 | Minimum asyncpg connection pool size |
| `DATABASE_POOL_MAX_SIZE` | int | No | 5 | Maximum asyncpg connection pool size |

---

### Exotel (PSTN Gateway)

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `EXOTEL_ACCOUNT_SID` | str | **YES** | — | Exotel account ID (from dashboard) |
| `EXOTEL_API_KEY` | str | **YES** | — | Exotel API key |
| `EXOTEL_API_TOKEN` | str | **YES** | — | Exotel API token |
| `EXOTEL_API_BASE_URL` | str | No | https://api.exotel.com | Exotel API endpoint |
| `EXOTEL_CALLER_ID` | str | **YES** | — | Outbound caller ID number (E.164 format, e.g., `+919513886363`) |
| `EXOTEL_APP_ID` | str | No | "" | Exotel App Bazaar flow ID (required for outbound calls) |
| `EXOTEL_WEBHOOK_SECRET` | str | **YES** | — | Shared secret for Exotel status callbacks (appended to StatusCallback URL as `?secret=...`) |

---

### Call Limits

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `ENABLE_INBOUND_CALLS` | bool | No | true | Whether to accept inbound calls |
| `ENABLE_OUTBOUND_CALLS` | bool | No | false | Whether to place outbound calls |
| `MAX_CONCURRENT_CALLS` | int | No | 1 | Max number of simultaneous calls engine can handle |
| `INBOUND_RESERVED_CALLS` | int | No | 0 | How many of MAX_CONCURRENT_CALLS to reserve for inbound (rest go to outbound) |
| `MAX_CALL_DURATION_SECONDS` | int | No | 1800 | Force-close calls exceeding this (e.g., 1800 = 30 mins) |

---

### Whisper (ASR - Speech Recognition)

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `ELEVENLABS_API_KEY` | str | **YES** | — | ElevenLabs API key (used for ASR + TTS) |
| `ELEVENLABS_ASR_MODEL_ID` | str | No | scribe_v2_realtime | ElevenLabs Scribe model |
| `ENDPOINTING_MIN_SILENCE_MS` | int | No | 500 | Milliseconds of silence to consider end-of-turn |
| `ASR_TIMEOUT_MS` | int | No | 10000 | ASR WebSocket connection timeout (ms) |

---

### TTS (Text-to-Speech) - Provider Selection

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `TTS_PROVIDER` | "bakbak" \| "elevenlabs" | No | bakbak | Primary TTS provider |
| `TTS_FALLBACK_ENABLED` | bool | No | false | If primary TTS fails, try secondary provider |
| `TTS_TIMEOUT_MS` | int | No | 10000 | Timeout for TTS requests (ms) |

---

### Bakbak TTS (If TTS_PROVIDER="bakbak")

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `BAKBAK_API_KEY` | str | Conditional | — | Bakbak API key (required if TTS_PROVIDER=bakbak) |
| `BAKBAK_BASE_URL` | str | No | https://hub.getraya.app/v1 | Bakbak API endpoint |
| `BAKBAK_VOICES` | JSON | No | {} | Mapping: `{language: {voice_id, model}}`. Example: `{"en": {"voice_id": "en-001", "model": "standard"}}` |

---

### ElevenLabs TTS (If TTS_PROVIDER="elevenlabs" or fallback)

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `ELEVENLABS_TTS_MODEL_ID` | str | No | eleven_flash_v2_5 | ElevenLabs TTS model |
| `ELEVENLABS_TTS_VOICE_ID` | str | Conditional | "" | ElevenLabs voice ID (required if TTS_PROVIDER=elevenlabs) |
| `ELEVENLABS_TTS_STABILITY` | float | No | 0.5 | Voice stability (0–1) |
| `ELEVENLABS_TTS_SIMILARITY_BOOST` | float | No | 0.75 | Similarity boost (0–1) |

---

### LLM (Language Model) Provider Selection

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `LLM_PROVIDER` | "groq" \| "openrouter" | No | openrouter | Primary LLM provider |
| `LLM_MAX_REQUESTS_PER_CALL` | int | No | 40 | Max LLM requests per single call (safety limit) |
| `LLM_RETRY_BACKOFF_BASE_MS` | int | No | 300 | Initial retry delay (ms) |
| `LLM_RETRY_BACKOFF_MAX_MS` | int | No | 2000 | Max retry delay (ms) |
| `MAX_CONSECUTIVE_LLM_FAILURES` | int | No | 3 | Consecutive LLM failures → end call |
| `LLM_DEDUP_WINDOW_MS` | int | No | 700 | Identical transcript within this window = retransmit, not new input |

---

### Groq LLM (If LLM_PROVIDER="groq")

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `GROQ_API_KEY` | str | Conditional | — | Groq API key (required if LLM_PROVIDER=groq) |
| `GROQ_BASE_URL` | str | No | https://api.groq.com/openai/v1 | Groq API endpoint |
| `GROQ_MODEL` | str | No | openai/gpt-oss-20b | Groq model name |
| `GROQ_MAX_OUTPUT_TOKENS` | int | No | 1024 | Max tokens per LLM response |
| `GROQ_TEMPERATURE` | float | No | 0.4 | Temperature (0–2; lower = deterministic) |
| `GROQ_MAX_REQUESTS_PER_MINUTE` | int | No | 60 | Rate limit (per-minute, per-process) |
| `GROQ_TIMEOUT_MS` | int | — | Uses primary timeout (4s) | Override primary timeout |
| `GROQ_MAX_RETRIES` | int | — | Uses primary retries (0) | Override primary retry count |

---

### OpenRouter LLM (If LLM_PROVIDER="openrouter" or fallback)

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `OPENROUTER_API_KEY` | str | Conditional | — | OpenRouter API key (required if LLM_PROVIDER=openrouter) |
| `OPENROUTER_BASE_URL` | str | No | https://openrouter.ai/api/v1 | OpenRouter API endpoint |
| `OPENROUTER_MODEL` | str | No | None | Model name (e.g., `gpt-4-turbo`, `claude-3-opus`). Required if used as primary. |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | int | No | 250 | Max tokens per LLM response |
| `OPENROUTER_TEMPERATURE` | float | No | 0.4 | Temperature |
| `OPENROUTER_MAX_REQUESTS_PER_MINUTE` | int | No | 18 | Rate limit (free tier capped at ~20/min) |
| `OPENROUTER_TIMEOUT_MS` | int | — | Uses fallback timeout (8s) | Override timeout |
| `OPENROUTER_MAX_RETRIES` | int | — | Uses fallback retries (1) | Override retry count |

---

## Dashboard Configuration (`monaaivoiceagent-main/.env.local`)

TanStack Start + Prisma + Node.js environment.

### Server Runtime (Node.js)

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `DATABASE_URL` | str | **YES** | — | PostgreSQL connection string (shared with engine) |
| `SESSION_COOKIE_SECRET` | str | **YES** | — | Secret for signing session cookies (any unguessable string) |

---

### Voice Engine Integration

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `VOICE_ENGINE_BASE_URL` | str | **YES** | — | Engine's public URL (e.g., `http://localhost:8000` for local dev). Used by dashboard to call engine API. |
| `VOICE_ENGINE_API_KEY` | str | **YES** | — | Bearer token for engine API (must match `APP_SECRET_KEY` on engine) |
| `VOICE_ENGINE_WEBHOOK_SECRET` | str | **YES** | — | HMAC secret for verifying engine webhooks (must match engine's `EXOTEL_WEBHOOK_SECRET`) |
| `VOICE_ENGINE_WEBHOOK_URL` | str | **YES** | — | Public URL of dashboard where engine sends webhooks. Example: `https://dashboard.example.com` or `https://dashboard-public.ngrok.io` for local dev. |

---

### Authentication

| Var | Type | Required? | Default | Usage |
|-----|------|-----------|---------|-------|
| `AUTH_ENABLED` | bool | No | true | If false, bypass login (dev only) |

---

## Runtime Validation & Startup Checks

### Engine Startup (`app/main.py::lifespan`)

On startup, engine:
1. Loads settings from `.env` via Pydantic
2. Validates all required vars are set (else FastAPI fails to start)
3. Logs configuration warnings:
   - `EXOTEL_WEBHOOK_SECRET` not set
   - `ENABLE_OUTBOUND_CALLS` = false (outbound disabled)
   - `ENABLE_INBOUND_CALLS` = false (inbound disabled)
   - `MAX_CONCURRENT_CALLS` too low
4. Initializes connections:
   - Database pool
   - HTTP client (for external APIs)
   - Exotel client
   - ASR, LLM, TTS providers
5. Applies pending migrations
6. Starts background dispatcher task
7. Logs ready: `INFO app: Listening on {HOST}:{PORT}`

### Dashboard Startup (`src/start.ts::logVoiceEngineWebhookWarnings`)

On startup, dashboard:
1. Checks env vars via `startup-checks.ts::VoiceEngineEnv`
2. Logs warnings if:
   - `VOICE_ENGINE_WEBHOOK_SECRET` not set (webhooks will fail verification)
   - `VOICE_ENGINE_WEBHOOK_URL` not set (engine can't reach dashboard)
3. No hard failure; app still starts (local dev can bypass)

---

## Environment File Examples

### Engine (`.env`)

```env
LOG_LEVEL=INFO
HOST=0.0.0.0
PORT=8000

# Mandatory
APP_SECRET_KEY=your-secret-key-here
PUBLIC_BASE_URL=https://engine.example.com
DATABASE_URL=postgresql://mona:mona_local_only@localhost:5434/mona

# Exotel
EXOTEL_ACCOUNT_SID=xxx
EXOTEL_API_KEY=xxx
EXOTEL_API_TOKEN=xxx
EXOTEL_CALLER_ID=+919513886363
EXOTEL_WEBHOOK_SECRET=xxx

# ASR
ELEVENLABS_API_KEY=xxx

# LLM (Primary: Groq, Fallback: OpenRouter)
LLM_PROVIDER=groq
GROQ_API_KEY=xxx
GROQ_MODEL=openai/gpt-oss-20b
OPENROUTER_API_KEY=xxx
OPENROUTER_MODEL=gpt-4-turbo

# TTS (Primary: Bakbak, Fallback: ElevenLabs)
TTS_PROVIDER=bakbak
BAKBAK_API_KEY=xxx
BAKBAK_VOICES={"en": {"voice_id": "en-001", "model": "standard"}}
ELEVENLABS_TTS_VOICE_ID=xxx
TTS_FALLBACK_ENABLED=true

# Call Limits
MAX_CONCURRENT_CALLS=5
ENABLE_OUTBOUND_CALLS=true
ENABLE_INBOUND_CALLS=true
```

### Dashboard (`.env.local`)

```env
# Database (shared with engine)
DATABASE_URL=postgresql://mona:mona_local_only@localhost:5434/mona

# Auth
SESSION_COOKIE_SECRET=your-cookie-secret-here

# Voice Engine Integration
VOICE_ENGINE_BASE_URL=http://localhost:8000
VOICE_ENGINE_API_KEY=your-secret-key-here
VOICE_ENGINE_WEBHOOK_SECRET=xxx
VOICE_ENGINE_WEBHOOK_URL=http://localhost:5173
```

---

## Configuration Best Practices

1. **Never commit `.env`** — Use `.env.example` with placeholders instead
2. **Secrets via environment only** — No hardcoding in code
3. **Validate on startup** — Pydantic + middleware checks
4. **Different credentials per tier** — Dev, staging, prod each have separate keys
5. **Rate limits tuned to actual quotas** — Match LLM provider's tier (free vs. paid)
6. **Timeouts > network RTT** — 4s for primary, 8s for fallback
7. **Log level: INFO in production** — DEBUG only in development

---

**See also:**
- [deployment-operations.md](deployment-operations.md) — Setting up `.env` files in local/Docker/production
- [voice-pipeline.md](voice-pipeline.md) — How each config var is used
