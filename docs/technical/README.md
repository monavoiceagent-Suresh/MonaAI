# Mona AI Voice Agent — Technical Documentation

## Overview

Mona is a production-ready AI voice agent platform that automates outbound and inbound phone calls. It combines a **TanStack Start dashboard** (TypeScript/React) with a **Python FastAPI voice engine** to deliver conversational AI over phone.

**Scope:** This documentation covers the production codebase as of October 2026, including:
- Dashboard: Campaign management, persona editor, inbound number routing, call analytics, webhook integration
- Engine: Voice I/O (Exotel), LLM integration (Groq/OpenRouter), TTS (Bakbak/ElevenLabs), ASR (ElevenLabs Scribe), call state management, outcome classification
- Database: PostgreSQL schemas for both dashboard and engine (engine uses separate hand-written SQL migrations)
- Integration: Dashboard↔engine webhooks, synchronous dispatch, test-call requests

## Key Repositories

| Repo | Purpose | Stack | Location |
|------|---------|-------|----------|
| **monaaivoiceagent-main** | Web dashboard, workspace management, campaign control | TanStack Start, Prisma, PostgreSQL, React | `C:\FreeLance\VoiceAgent\monaaivoiceagent-main` |
| **agent** | Voice call engine, ASR, LLM, TTS, Exotel integration | FastAPI, asyncpg, Pydantic v2 | `C:\FreeLance\VoiceAgent\agent` |

## Documentation Index

1. **[README.md](README.md)** — This file. System overview and navigation.
2. **[architecture.md](architecture.md)** — Component diagram, call flow sequences, deployment architecture.
3. **[database-schema.md](database-schema.md)** — Dashboard Prisma schema + engine SQL migrations, ER diagrams, constraints.
4. **[api-reference.md](api-reference.md)** — Engine REST API routes, dashboard server functions, request/response contracts.
5. **[integration-contracts.md](integration-contracts.md)** — Dashboard↔engine communication, webhook payloads, idempotency, Exotel webhooks.
6. **[voice-pipeline.md](voice-pipeline.md)** — ASR → LLM → TTS flow, rate limiting, retry/fallback, interruption, outcome extraction.
7. **[feature-flows.md](feature-flows.md)** — Campaign dispatch, inbound routing, persona management, call reporting, outcome rules.
8. **[configuration.md](configuration.md)** — Every environment variable, defaults, required vs. optional, usage context.
9. **[security.md](security.md)** — Authentication, authorization, tenant isolation, API keys, PII handling, logging.
10. **[deployment-operations.md](deployment-operations.md)** — Local dev setup, Docker, database, migrations, startup sequence, health checks, troubleshooting.
11. **[known-limitations.md](known-limitations.md)** — Incomplete features, assumptions, unverified behavior, technical debt, open questions.

## Quick Facts

- **Multi-tenant:** Workspace isolation via `client_id` in both DBs (application-layer enforced)
- **Stateful calls:** Long-lived WebSocket sessions during active calls; session.py manages state and transcripts
- **Async-first:** Engine uses asyncpg + asyncio; dashboard uses React Query + server functions
- **Provider agnostic:** LLM (Groq or OpenRouter, user-selectable), TTS (Bakbak or ElevenLabs), ASR (ElevenLabs Scribe)
- **Telephony:** Exotel integration for actual PSTN calls; expects IP callbacks on PUBLIC_BASE_URL
- **No mobile apps:** Web-only, responsive design

## Development Quick Start

### Engine (Python)
```bash
cd agent
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
# Fill in Exotel, LLM, TTS credentials in .env
python -m app.main  # uvicorn app.main:app --reload
# Listens on http://localhost:8000
```

### Dashboard (TypeScript/React)
```bash
cd monaaivoiceagent-main
npm install
cp .env.example .env.local
# Fill in DATABASE_URL, VOICE_ENGINE_BASE_URL, VOICE_ENGINE_API_KEY, and other vars
npm run db:push  # Apply Prisma migrations
npm run dev      # TanStack Start dev server
# Listens on http://localhost:5173
```

### Database (PostgreSQL)
- **Dashboard:** `postgresql://mona:mona_local_only@localhost:5434/mona[_test]` (Prisma-managed)
- **Engine:** Shares the same instance, uses hand-written migrations in `agent/app/migrations/*.sql` (applied at startup by `db.py::migrate()`)

## Key Concepts

### Multi-Tenancy
- Every user signs in locally (no SSO); one User can be a member of multiple Clients (workspaces)
- Data is always scoped by `client_id` in the application layer (no row-level security at DB level)
- Tenant validation: `currentWorkspaceClient(database, userId)` resolves the caller's workspace or returns null

### Call Lifecycle
1. **Outbound (Campaign):** Lead queued → dispatcher picks it up → POST `/calls` to engine → engine dials + streams → engine posts `CallUpdate` webhook → dashboard records call + outcome
2. **Inbound:** Phone rings → Exotel forwards to engine WebSocket → engine streams ASR → LLM replies → TTS spoken → Exotel plays → engine closes → engine posts `CallComplete` webhook

### Personas & Agents
- A **Persona** is a dashboard entity: name, instructions, knowledge, language, workflow type
- An **Agent** is an engine entity: the hydrated, versioned copy sent to the engine with prompts and models
- One persona can have one or many agent versions (one active version at a time on the engine)
- Inbound routes and campaigns reference personas; the engine stores agents

### Webhooks
- Engine calls back to dashboard via `POST /api/webhooks/voice-engine` with HMAC signature
- Dashboard calls engine synchronously for dispatch, voice list, test calls; async results via webhooks

## Authentication & Authorization

| Component | Auth Method | Protected | Notes |
|-----------|------------|-----------|-------|
| Dashboard | Local username/password + opaque session token (SHA-256 hashed) | All server functions except login/signup | `requireAuth` middleware on every createServerFn |
| Engine API | Bearer token (`APP_SECRET_KEY`) | Management routes (`/agents`, `/calls`, `/calls/test`) | Public routes: `/health`, `/exotel/stream` (WebSocket) |
| Webhook | HMAC-SHA256 signature over raw body | Required; no session | Engine proves identity; dashboard checks sig before processing |

## Common Debugging Points

1. **Call not completing:** Check `voice_engine_jobs` table status and `last_error`; engine logs; Exotel connectivity
2. **LLM not responding:** Check `llm_provider` setting; fallback enabled?; rate limits hit?
3. **Inbound calls not routing:** Check `InboundNumber` `active` flag, `workflow` type matches a known flow; engine has the route synced
4. **TTS failures:** Check `tts_provider` availability and API credentials; fallback enabled?
5. **Tenant leakage:** Search for unscoped queries in `.functions.ts` files (all should use `currentWorkspaceClient`)
6. **Webhook delivery:** Check `VOICE_ENGINE_WEBHOOK_SECRET` matches engine's `exotel_webhook_secret`; dashboard at `VOICE_ENGINE_WEBHOOK_URL`

## Performance Notes

- **Concurrent calls:** Limited by `MAX_CONCURRENT_CALLS` (engine setting); inbound calls reserve `INBOUND_RESERVED_CALLS` slots
- **LLM rate limiting:** Per-minute caps per provider (Groq: 60/min, OpenRouter free tier: 20/min); per-call max 40 requests
- **Database pool:** Engine uses asyncpg connection pool (min 1, max 5 by default); dashboard Prisma client auto-manages
- **Caching:** Voice list cached in dashboard; persona snapshots on engine; no backend cache layer (yet)

## Known Gaps & Assumptions

- **No payment integration:** Credit balance is integer; no Stripe/Razorpay linked
- **No analytics rollup:** Per-call data logged; no pre-computed dashboards or aggregation pipeline
- **No scheduling:** Campaigns start immediately; no cron or scheduled dispatch
- **Inbound dispatch:** Hardcoded to one engine-wide default agent if no inbound route exists; no per-number fallback
- **See also:** [known-limitations.md](known-limitations.md)

---

**Last updated:** October 2026  
**Status:** Production code review documentation  
**Audience:** Platform engineers, new team members, auditors
