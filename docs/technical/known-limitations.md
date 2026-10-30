# Known Limitations & Technical Debt

## Incomplete Features

### 1. Payment & Billing Integration

**Status:** Credit balance is an integer; no actual payment processing.

**What's Missing:**
- No Stripe/Razorpay integration
- No top-up purchase flow
- No invoice generation
- No usage-based billing (per-minute call charges hardcoded, not calculated)
- No credit debit at call completion (balance never decreases)

**Impact:** Credits are advisory only; no actual spending limit enforced.

**Workaround:** Manual top-ups via admin panel (not implemented; would require code change).

**Plan:** Integrate payment provider in future; for now, feature is skeleton only.

---

### 2. Analytics & Reporting

**Status:** Raw call data in database; no pre-aggregated analytics.

**What's Missing:**
- No dashboard for metrics (call volume trends, outcome distribution over time)
- No export to BI tools (Tableau, Looker, etc.)
- No custom reports builder
- No per-persona performance stats
- No per-campaign ROI calculations

**Impact:** Users must query raw `calls` table manually; no nice UI.

**Workaround:** SQL queries on `calls`, `leads` tables; or export to spreadsheet for analysis.

---

### 3. Inbound Call Scheduling & Availability

**Status:** Inbound routes are either on or off; no time-based routing.

**What's Missing:**
- No business hours configuration (always-on)
- No weekend vs. weekday routing
- No fallback routing if primary persona unavailable
- No "on call" scheduling for team members

**Impact:** Calls ring all hours; may wake sleeping team members.

**Workaround:** Disable inbound numbers outside business hours manually.

---

### 4. Call Scheduling & Campaigns Timing

**Status:** Campaigns start immediately; no future scheduling.

**What's Missing:**
- No cron-based or future scheduling
- No campaign pause/resume with state preservation
- No "skip weekend" logic in retry scheduling
- No timezone handling (all times UTC)

**Impact:** Must manually trigger campaigns; no way to schedule in advance.

**Workaround:** Cron external service calling campaign dispatch API.

---

### 5. Role-Based Access Control (RBAC)

**Status:** All workspace members have equal permissions.

**What's Missing:**
- No "Admin" vs. "Member" roles
- No "Read-only" viewer access
- No feature-specific permissions (e.g., can edit prompts but not see calls)
- No audit log of who changed what

**Impact:** All users can delete campaigns, edit personas, access all calls.

**Risk:** Low if team trust is high; high if users malicious.

**Mitigation:** Keep small, trusted teams; no sensitive data in prompts.

---

## Technical Debt

### 1. Inbound Routes Not Scoped to Workspace

**Issue:** `inbound_route` table on engine has no `client_id`; phone numbers are globally unique.

**Consequence:** One workspace's inbound number cannot have same phone as another workspace's (correct), but if route lookup fails, falls back to engine-wide default agent (may leak between workspaces).

**Current Safeguard:** Phone numbers are UNIQUE at DB level; no two routes for same number.

**Risk:** Low if phone assignment is careful; high if automation broken.

**Fix:** Add `client_id` to `inbound_route`, index on (client_id, phone), check workspace before returning route.

---

### 2. Hardcoded Outcomes Per Workflow

**Issue:** Outcome vocabulary is baked into engine code (`prompts.py::OUTCOMES_BY_WORKFLOW`).

**Consequence:** Can't change outcomes without code deploy.

**Status:** Mitigated by Call Outcome Rules feature (dashboard can override per-workspace), but still couples LLM prompt to code.

**Fix:** Move outcome definitions to database; fetch at agent startup.

---

### 3. No Rate Limiting on Dashboard API

**Issue:** Any authenticated user can call campaign dispatch API unlimited times.

**Consequence:** User could spam 1000 campaign dispatches/second, overwhelming engine.

**Current Safeguard:** Engine has `MAX_CONCURRENT_CALLS` limit; requests queue beyond that.

**Risk:** DoS via resource exhaustion (database, memory).

**Fix:** Add per-user or per-workspace rate limiting (e.g., max 10 dispatches/hour).

---

### 4. Session Cleanup Not Automated

**Issue:** `sessions` table rows expire (`expires_at < now()`) but are not deleted.

**Consequence:** Table grows unbounded; disk usage increases forever.

**Current Safeguard:** Indexes on `expires_at` make lookups fast even with dead rows.

**Risk:** Very low; table eventually becomes very large.

**Fix:** Add cron job: `DELETE FROM sessions WHERE expires_at < now() AND created_at < now() - INTERVAL 30 days` (keep old rows for audit briefly).

---

### 5. Transcript Storage Incomplete

**Issue:** Transcripts are optionally stored by engine; reference to external system (transcript_ref), but full text never persisted in local DB.

**Consequence:** Dashboard has `calls.summary` (AI-generated) but not `calls.transcript_text`.

**Current:** Transcript stored on engine side only; dashboard fetches via opaque reference.

**Risk:** If engine loses transcript, no recovery path.

**Fix:** Stream full transcript from engine to dashboard webhook; store in calls table.

---

### 6. LLM Prompt Assembly Hardcoded

**Issue:** System prompt is built in Python code (`app/prompts.py::system_prompt()`).

**Consequence:** Prompt engineering requires code changes + deploy.

**Status:** Not a blocker (framework is reasonable), but inflexible for non-engineers.

**Fix:** Move prompt templates to database or YAML config; fetch at agent startup.

---

### 7. No Transaction Consistency for Concurrent Dispatch Retries

**Issue:** If dispatch request times out, dashboard retries. Engine may have already started dialling.

**Current Safeguard:** `idempotency_key` prevents duplicate job creation.

**Gap:** If both requests succeed before DB update completes, two jobs created with same key → second INSERT fails → exception → user sees error (correct, but confusing).

**Severity:** Low; rare timing window.

**Fix:** Implement transactional semantics for dispatch atomicity (already done via Prisma transaction, but could be more defensive).

---

### 8. No Graceful Degradation on Exotel Outage

**Issue:** If Exotel API down, all outbound calls fail immediately.

**Current:** Engine returns 502; dashboard shows error to user.

**Gap:** No async queue to retry later; call lost.

**Fix:** Persist failed dispatch to queue; retry on Exotel recovery (requires job queue like Celery/RabbitMQ).

---

## Unverified Behavior

### 1. Barge-In (Caller Interrupting Agent)

**Expected:** If caller speaks while agent is playing TTS, ASR should pick up the new input.

**Status:** Not tested in real Exotel calls.

**Test Plan:** Place live call, try to interrupt agent mid-sentence; check if agent hears and responds.

**Outcome:** Unknown; may work, may not.

---

### 2. Long Calls (>30 minutes)

**Expected:** Engine's WebSocket stays open for full call; call can last hours.

**Tested:** Up to ~5 minutes only (local testing).

**Risk:** Network timeouts, memory leaks, or connection pool exhaustion after hours-long calls.

**Test Plan:** Place test call, stay on line for 1+ hour, monitor engine memory/connections.

---

### 3. Concurrent Campaign Dispatches

**Expected:** Two campaigns can dispatch simultaneously; calls from both proceed in parallel.

**Tested:** Single campaign at a time only.

**Risk:** Database lock contention, rate limit interactions between campaigns.

**Test Plan:** Start two campaigns with 100 leads each; monitor dispatcher queue; check call success rate.

---

### 4. Webhook Delivery at Scale

**Expected:** Engine can retry webhooks to dashboard while also handling new calls.

**Tested:** Small payloads; no high load.

**Risk:** Backlog of webhook retries could starve new call processing.

**Test Plan:** Force a webhook failure (e.g., dashboard down); start new campaign; measure delay in processing new calls.

---

## Known Issues

### 1. Dashboard Voice Picker Caching

**Issue:** Voice list cached for 5 minutes; if TTS provider adds new voices, won't show until cache expires.

**Workaround:** Refresh browser or wait 5 minutes.

**Severity:** Very low; voices rarely change.

---

### 2. Persona Version Pinning in Campaigns

**Issue:** When campaign starts, it captures persona version at that moment. If persona edited later, campaign still uses old version.

**Expected:** Correct (don't change prompt mid-campaign).

**Edge Case:** If user wants to revert a bad edit, can't; campaign already running with new version.

**Workaround:** Manual version management (save a "good" version, then revert when needed).

---

### 3. Callback Window Not Enforced

**Issue:** `campaigns.callback_window_days` is stored but not used anywhere (engine doesn't check it).

**Consequence:** Calls marked `outcome='Callback'` are never automatically re-dialled after N days.

**Workaround:** Manual follow-up (dashboard shows "Missed Callbacks" page).

**Fix:** Implement automatic retry scheduling in dispatcher (requires job queue).

---

## Assumptions

### 1. Single Exotel Account

**Assumption:** Engine is configured for one Exotel account only.

**Consequence:** Can't route between multiple Exotel accounts; all calls use same account.

**Workaround:** Use one Exotel account for all customers; partition customers by phone numbers.

---

### 2. PostgreSQL 14+ Available

**Assumption:** No support for older PostgreSQL versions.

**Tested:** 14, 15 (locally).

**Consequence:** Deployment on older systems may fail.

---

### 3. IPv4 Connectivity

**Assumption:** All services (engine, dashboard, database) can reach each other via IPv4 + DNS.

**Consequence:** IPv6-only networks not supported.

**Workaround:** Ensure IPv4 is available; use DNS names for all connections.

---

### 4. Single-Process Engine

**Assumption:** Engine runs as single FastAPI process (not load-balanced).

**Consequence:** Scaling requires vertical (bigger instance) or manual sharding by phone number.

**Workaround:** Run multiple engine instances on different subsets of phone numbers (not automated).

---

## Missing Observability

### 1. No Metrics Export

**Missing:**
- Prometheus metrics endpoint
- CloudWatch / Datadog instrumentation
- Custom event logging (e.g., "call started", "outcome extracted")

**Workaround:** Parse application logs manually; query database for aggregate stats.

---

### 2. No Distributed Tracing

**Missing:**
- OpenTelemetry instrumentation
- Trace ID propagation (browser → dashboard → engine → LLM)
- Latency breakdown per component

**Workaround:** Correlate events via call ID; measure end-to-end latency manually.

---

### 3. No Real-Time Alerting

**Missing:**
- Threshold alerts (e.g., >50% calls failing)
- Anomaly detection (sudden drop in call volume)
- Webhook delivery tracking (failed webhook notifications)

**Workaround:** Manual dashboards + manual monitoring.

---

## Documentation Gaps

### 1. No LLM Prompt Tuning Guide

**Missing:** How to write effective instructions/knowledge for different use cases.

**Workaround:** Read LLM provider docs (Groq, OpenRouter) and experiment.

---

### 2. No Exotel Setup Guide

**Missing:** Step-by-step for onboarding Exotel (create account, fund, configure webhooks).

**Workaround:** Exotel docs + manual trial.

---

### 3. No Troubleshooting Runbook

**Missing:** Detailed decision tree for common failures.

**Workaround:** This documentation + trial & error.

---

## Future Work (Not Roadmap)

These are not commitments; just areas that could be improved:

1. Add payment integration (Stripe, Razorpay, or billing provider)
2. Build analytics dashboards (calls/day trends, outcome distribution, per-persona stats)
3. Implement RBAC (owner/member/viewer roles)
4. Add job queue (Redis + Celery) for resilient async tasks
5. Move prompt templates to database for non-engineer prompt engineering
6. Support multiple Exotel accounts per workspace
7. Implement horizontal scaling (sticky sessions, shared state store)
8. Add distributed tracing (OpenTelemetry)
9. Automated rate limiting (per-user, per-workspace)
10. Call scheduling (cron-based campaigns, time-based routing)

---

**Last updated:** October 2026  
**Accuracy:** Based on source code inspection; not all features tested in production  
**Audience:** Developers, operators, product managers planning enhancements
