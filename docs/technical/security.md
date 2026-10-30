# Security

## Authentication

### Dashboard (Browser → Node.js Server Functions)

**Mechanism:** Local username + password + opaque session token

**Flow:**
1. User enters email + password on login form
2. Dashboard calls `signIn(email, password)` server function
3. Server looks up user by email
4. Compares password hash (scrypt) against stored hash
5. If match: Creates session record with:
   - `token = crypto.randomUUID()` (opaque random token)
   - `token_hash = SHA-256(token)` (only hash stored in DB, never plaintext token)
   - `expires_at = now + 7 days`
6. Returns token to browser (via Set-Cookie)
7. Browser sends token in requests (Cookie header auto-added)
8. Server validates token hash on each request via `requireAuth` middleware

**Security Assumptions:**
- HTTPS only (production)
- Cookie SameSite flag set (prevents CSRF)
- Token never logged or exposed in error messages

**Session Expiry:**
```sql
CREATE INDEX sessions_expires_at ON sessions(expires_at);
-- Cleanup: DELETE FROM sessions WHERE expires_at < now()
-- Not yet automated; manual cleanup or cron job needed
```

---

### Engine (Dashboard → FastAPI)

**Mechanism:** Bearer token (`APP_SECRET_KEY`)

**Flow:**
1. Dashboard calls engine API (e.g., POST /campaigns/dispatch)
2. Includes header: `Authorization: Bearer {APP_SECRET_KEY}`
3. Engine validates token against configured `APP_SECRET_KEY`
4. If mismatch: Return 401 Unauthorized
5. If match: Continue request

**Protected Routes:**
- `POST /agents` — Create/update agent
- `GET /agents` — List agents
- `POST /calls` — Place call
- `POST /calls/test` — Test call
- `POST /campaigns/dispatch` — Dispatch campaign
- `GET /voices` — List voices

**Public Routes:**
- `GET /health` — Health check (no auth)
- `GET /exotel/stream` — WebSocket (Exotel handles auth via URL signature)
- `POST /exotel/status` — Status callback (Exotel signed; handled via `exotel_webhook_secret`)

**Secret Management:**
- Never log `APP_SECRET_KEY`
- Rotate periodically (requires all clients to update)
- Different key per environment (dev, staging, prod)

---

### Webhooks (Engine → Dashboard)

**Mechanism:** HMAC-SHA256 signature over raw body

**Generation (Engine side):**
```python
signature = hmac.new(
    secret=settings.exotel_webhook_secret.encode(),
    msg=raw_body_bytes,  # Before parsing JSON
    digestmod=hashlib.sha256
).hexdigest()
# Include in header: x-voice-engine-signature: {signature}
```

**Verification (Dashboard side):**
```typescript
const signature = request.headers.get('x-voice-engine-signature');
const computed = crypto
    .createHmac('sha256', process.env.VOICE_ENGINE_WEBHOOK_SECRET)
    .update(rawBody)  // Raw bytes, not parsed JSON
    .digest('hex');
if (signature !== computed) {
    return 401 Unauthorized;
}
```

**Why HMAC?**
- Engine has no session/login; proves identity via shared secret
- Ensures webhook body not tampered in transit
- Prevents replay/forgery from other services

**Secret Rotation:**
- Requires coordinating engine + dashboard deployment
- Old events may be rejected during transition
- Workaround: Run both old + new secret check briefly

---

## Authorization

### Tenant Isolation (Multi-Tenancy)

**Model:** Database-level scoping via `client_id` in application code (no row-level security)

**Enforcement (Dashboard):**
Every server function follows this pattern:
```typescript
export const listCalls = createServerFn({ method: "GET" })
  .middleware([requireAuth])  // Caller must be authenticated
  .handler(({ context }) => {
    const client = await currentWorkspaceClient(db, context.userId);
    // ^ Returns caller's workspace or null
    if (!client) return error("Not in a workspace");
    // ^ All queries scoped by client.id
    return listCallsFor(db, context.userId);
  });

async function listCallsFor(db, userId, filter) {
  const client = await currentWorkspaceClient(db, userId);
  const calls = await db.call.findMany({
    where: {
      clientId: client.id,  // ← Scoped
      direction: filter.direction,
      outcome: filter.outcome,
    },
  });
  return calls;
}
```

**Enforcement (Engine):**
- Engine receives `client_id` in dispatch request
- Stores on job record
- Includes in webhook event
- Dashboard verifies job's `client_id` matches caller's workspace

**Trust Model:**
- All callers are authenticated (verified by bearer token or session)
- All queries automatically scoped (bug in scoping = security breach)
- No dynamic permission levels (all users in workspace are equal)

**Gap:** 
- Inbound routes (phone numbers) are currently global, not scoped to workspace
- Workaround: Phone uniqueness at DB level prevents cross-workspace routing

---

### Role-Based Access Control (RBAC)

**Current State:** Not implemented. All users in a workspace have equal permissions.

**Model (if RBAC were needed):**
```sql
client_members.role IN ('owner', 'member', 'viewer')
-- owner: full access
-- member: read/write campaigns, prompts, calls
-- viewer: read-only access
```

**Gap:** Role check not on any server function

---

## API Protection

### Rate Limiting

**LLM Rate Limits:**
- Groq: 60 requests/minute (shared across all calls in process)
- OpenRouter: 20 requests/minute (free tier)
- Per-call: 40 requests max

**Implementation:** Token bucket (`app/providers/rate_limit.py`)

**Enforcement:**
```python
if not limiter.acquire():
    # Rate limit hit
    backoff_ms = min(max_backoff, base_backoff * (2 ** attempt))
    await asyncio.sleep(backoff_ms / 1000)
    retry()
```

**Dashboard Rate Limiting:**
- Not yet implemented
- Could add: Limit campaign dispatches per hour per workspace
- Could add: Limit API calls per second per workspace

### Input Validation

**Engine (Pydantic v2):**
- All POST bodies validated against models (AgentIn, DispatchCampaignRequest, etc.)
- Regex patterns for phone numbers, persona keys, etc.
- Invalid input → 422 Unprocessable Entity

**Dashboard (Zod):**
- All server function inputs validated via Zod schema
- Invalid input → error returned to client

**Example:**
```typescript
const inputSchema = z.object({
  to: z.string().regex(/^\+?[0-9]{10,15}$/, "Invalid phone"),
  contactName: z.string().max(100),
});
// Invalid input rejected before reaching handler
```

---

## Data Protection

### PII Handling

**Phone Numbers:**
- Stored in plaintext in DB (necessary for dialling)
- Logged carefully (never in error responses)
- Not exposed to external APIs without need

**Transcript:**
- Stored by engine (full text of call)
- Accessed by dashboard only via authenticated requests
- Never returned in list endpoints; only via explicit transcript fetch

**Collected Fields:**
- Stored as JSONB in `calls.collected_fields`
- May contain PII (e.g., name, email, budget)
- Same protection as transcript

**Passwords:**
- Hashed via scrypt (memory-hard, slow-by-design)
- Never logged
- Never transmitted plaintext (HTTPS only)

**Session Tokens:**
- Stored only as SHA-256 hash
- Plaintext token only in browser (cookie)
- Never logged; not visible in server logs

### Logging & Secrecy

**Engine logging:**
- `LOG_LEVEL=INFO` (default) logs events, not details
- `LOG_LEVEL=DEBUG` may expose secrets (only in dev)
- Secrets (API keys, passwords) logged as `***` (via Pydantic SecretStr)

**Dashboard logging:**
- Server function errors logged (should not include secrets)
- Browser console logs visible to user (don't log tokens here)

**Webhook Security:**
- Engine never logs webhook request body (may contain PII)
- Dashboard verifies signature before processing (fail fast if invalid)

---

## Infrastructure Security

### Database Access

**Dashboard (Prisma Client):**
- Single connection pool (min 1, max 10 connections)
- All queries go through Prisma ORM (parameterized, no SQL injection)
- Uses user/password auth to PostgreSQL

**Engine (asyncpg):**
- Async connection pool (min 1, max 5)
- Parameterized queries; same SQL injection protection
- Uses user/password auth to PostgreSQL

**Threat:** If DATABASE_URL exposed, attacker can read all tenant data.  
**Mitigation:** Never commit DATABASE_URL; use environment variables only.

### Exotel Integration

**Outbound Credentials:**
- `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN` needed to dial
- Stored in engine `.env` (secret, not logged)
- Used only for outbound calls (dials real phone numbers)

**Inbound Callback:**
- Exotel calls engine's WebSocket at PUBLIC_BASE_URL
- URL includes credentials: `wss://API_KEY:API_TOKEN@host/exotel/stream`
- Must be HTTPS in production (credentials encrypted in transit)
- Status callback signed with `EXOTEL_WEBHOOK_SECRET` (appended to URL)

**Threat:** If PUBLIC_BASE_URL leaked, attacker can intercept calls (man-in-the-middle with TLS mitigation).  
**Mitigation:** Use ngrok/tunnel over HTTPS; never expose unencrypted endpoint.

### LLM API Keys

**Storage:**
- `GROQ_API_KEY`, `OPENROUTER_API_KEY` in engine `.env`
- Stored as Pydantic SecretStr (not logged)
- Never sent to client

**Usage:**
- Engine calls LLM providers directly
- Credentials never exposed to dashboard or browser

**Threat:** If .env leaked, attacker can call LLM API on your quota.  
**Mitigation:** Rotate keys regularly; monitor API usage for anomalies.

---

## Compliance & Audit

### Audit Trail

**Immutable Records:**
- `prompt_versions` table: Every save is a new row (insert-only)
- `credit_transactions` table: Every credit change is logged with timestamp + user
- `login_attempts` table: Every login attempt (success/fail) logged

**Gap:** No audit log for campaign dispatch, call updates, or data exports.

### Data Residency

**Current:** All data in single PostgreSQL instance (no replication to other regions)  
**Deployment:** Can use managed PostgreSQL (Supabase, RDS, Cloud SQL) in any region

### Backup & Recovery

**Backup Strategy:**
- PostgreSQL automated daily backups (if using managed DB)
- Point-in-time recovery if offered by provider
- No backup of running application state (stateless)

### Regulatory (GDPR, CCPA)

**Not Currently Addressed:**
- No data export feature (user can request download)
- No right-to-be-forgotten deletion endpoint
- No consent management for call recording
- No data retention policies

---

## Known Security Gaps

1. **No RBAC:** All workspace users have equal permissions
2. **Phone number scoping:** Inbound routes not per-workspace
3. **No API rate limiting:** Potential DoS via high-frequency calls
4. **Webhook replay protection:** Idempotency based on eventId; no nonce/timestamp
5. **No WAF:** No Web Application Firewall in front of dashboard
6. **Session timeout cleanup:** Old sessions not automatically cleaned up
7. **Credential rotation:** No automation for key rotation (manual process)
8. **Audit log gaps:** No log of who changed campaigns, prompts, etc.

---

## Security Checklist (Deployment)

- [ ] DATABASE_URL uses strong password (not default mona/mona_local_only)
- [ ] APP_SECRET_KEY is unguessable (>32 random chars, no common words)
- [ ] VOICE_ENGINE_WEBHOOK_SECRET is unguessable and matches both engine + dashboard
- [ ] All .env files are .gitignore'd (never committed)
- [ ] HTTPS enforced on dashboard (no HTTP)
- [ ] PUBLIC_BASE_URL uses HTTPS
- [ ] SESSION_COOKIE_SECRET is unguessable
- [ ] LLM/Exotel API keys rotated regularly (quarterly)
- [ ] Database backups enabled
- [ ] Access logs monitored for anomalies
- [ ] Rate limits on LLM configured per actual quotas
- [ ] Firewall rules restrict DATABASE_URL access to known IPs

---

**See also:**
- [configuration.md](configuration.md) — Sensitive environment variables
- [deployment-operations.md](deployment-operations.md) — Secrets management in each tier
