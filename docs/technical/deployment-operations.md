# Deployment & Operations

## Local Development Setup

### Prerequisites

- Python 3.11+ (engine)
- Node.js 18+ (dashboard)
- PostgreSQL 14+ (database)
- ngrok or similar (for public URL in local dev)

### Step 1: Clone & Install

**Engine:**
```bash
cd agent
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

**Dashboard:**
```bash
cd monaaivoiceagent-main
npm install
cp .env.example .env.local
```

### Step 2: Set Up PostgreSQL

**Local (Docker Compose):**
```bash
docker-compose up -d postgres
# Creates: postgresql://mona:mona_local_only@localhost:5434/mona
```

**Or Manual:**
```bash
psql -h localhost -U postgres -c "CREATE DATABASE mona OWNER mona;"
psql -h localhost -U postgres -c "CREATE USER mona WITH PASSWORD 'mona_local_only';"
```

**Verify Connection:**
```bash
psql postgresql://mona:mona_local_only@localhost:5434/mona -c "SELECT 1;"
```

### Step 3: Populate `.env` Files

**Engine (`.env`):**
```env
LOG_LEVEL=DEBUG
HOST=0.0.0.0
PORT=8000

APP_SECRET_KEY=dev-secret-key-change-in-production
PUBLIC_BASE_URL=http://localhost:8000

DATABASE_URL=postgresql://mona:mona_local_only@localhost:5434/mona

EXOTEL_ACCOUNT_SID=your_exotel_account
EXOTEL_API_KEY=your_exotel_key
EXOTEL_API_TOKEN=your_exotel_token
EXOTEL_CALLER_ID=+919513886363
EXOTEL_WEBHOOK_SECRET=dev-webhook-secret

ELEVENLABS_API_KEY=your_elevenlabs_key

LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-20b
OPENROUTER_API_KEY=your_openrouter_key

TTS_PROVIDER=bakbak
BAKBAK_API_KEY=your_bakbak_key
BAKBAK_VOICES={"en": {"voice_id": "en-001", "model": "standard"}}
```

**Dashboard (`.env.local`):**
```env
DATABASE_URL=postgresql://mona:mona_local_only@localhost:5434/mona

SESSION_COOKIE_SECRET=dev-cookie-secret-change-in-production

VOICE_ENGINE_BASE_URL=http://localhost:8000
VOICE_ENGINE_API_KEY=dev-secret-key-change-in-production
VOICE_ENGINE_WEBHOOK_SECRET=dev-webhook-secret
VOICE_ENGINE_WEBHOOK_URL=http://localhost:5173
```

### Step 4: Run Database Migrations

**Engine:** Migrations run automatically at startup

**Dashboard:**
```bash
npx prisma db push
```

### Step 5: Start Services

**Engine:**
```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# http://localhost:8000
```

**Dashboard:**
```bash
npm run dev
# http://localhost:5173
```

**Test Connection:**
```bash
curl -X GET http://localhost:8000/health
# {"status": "ok", "active_calls": 0}
```

### Step 6: Public URL for Local Testing (Optional)

If testing with real Exotel:
```bash
ngrok http 8000
# Copy the forwarding URL (e.g., https://abc123.ngrok.io)
# Set PUBLIC_BASE_URL=https://abc123.ngrok.io in engine .env
# Restart engine
```

---

## Docker Deployment

### Using Docker Compose

**File:** `docker-compose.yml` (create if needed)

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: mona
      POSTGRES_PASSWORD: mona_local_only
      POSTGRES_DB: mona
    ports:
      - "5434:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  engine:
    build:
      context: ./agent
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql://mona:mona_local_only@postgres:5432/mona
      APP_SECRET_KEY: ${APP_SECRET_KEY}
      PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}
      EXOTEL_ACCOUNT_SID: ${EXOTEL_ACCOUNT_SID}
      # ... other vars
    ports:
      - "8000:8000"
    depends_on:
      - postgres

  dashboard:
    build:
      context: ./monaaivoiceagent-main
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql://mona:mona_local_only@postgres:5432/mona
      VOICE_ENGINE_BASE_URL: http://engine:8000
      VOICE_ENGINE_API_KEY: ${APP_SECRET_KEY}
      # ... other vars
    ports:
      - "5173:5173"
    depends_on:
      - engine
      - postgres

volumes:
  postgres_data:
```

**Run:**
```bash
docker-compose up -d
# Services start in order: postgres → engine → dashboard
# Access dashboard at http://localhost:5173
```

**Logs:**
```bash
docker-compose logs -f engine
docker-compose logs -f dashboard
```

**Stop:**
```bash
docker-compose down
# Databases persist in postgres_data volume
```

---

## Production Deployment (Example: Railway)

### Prerequisites

- GitHub repo with both `agent/` and `monaaivoiceagent-main/` directories
- Railway.app account
- Managed PostgreSQL service (Railway, Supabase, RDS)

### Step 1: Create Services

**PostgreSQL Service:**
1. New Project → PostgreSQL
2. Get DATABASE_URL from service variables
3. Save to dashboard + engine environment

**Engine Service:**
1. New Service → GitHub repo
2. Root directory: `agent`
3. Buildpack: Python
4. Environment variables: All from `.env` (fill in secrets)
5. Port: 8000
6. Deploy

**Dashboard Service:**
1. New Service → GitHub repo
2. Root directory: `monaaivoiceagent-main`
3. Buildpack: Node
4. Build command: `npm run build`
5. Start command: `npm run start`
6. Environment variables: All from `.env.local`
7. Port: 5173 or 3000 (depending on server)
8. Deploy

### Step 2: Configure Environment Variables

**Engine:**
- DATABASE_URL (from PostgreSQL service)
- APP_SECRET_KEY (generate: `openssl rand -hex 32`)
- PUBLIC_BASE_URL (railway.app assigned domain)
- All Exotel, LLM, TTS credentials

**Dashboard:**
- DATABASE_URL (same as engine)
- VOICE_ENGINE_BASE_URL (engine's railway.app domain)
- VOICE_ENGINE_API_KEY (must match engine's APP_SECRET_KEY)
- VOICE_ENGINE_WEBHOOK_URL (dashboard's railway.app domain)
- SESSION_COOKIE_SECRET (generate: `openssl rand -hex 32`)

### Step 3: Run Migrations

**Engine:** Migrations run on first deploy (startup)

**Dashboard:**
```bash
# Via Railway shell or one-off job
npx prisma db push
```

### Step 4: Verify Deployment

```bash
# Engine health
curl https://engine-xxx.railway.app/health

# Dashboard up
curl https://dashboard-xxx.railway.app
```

### Step 5: Configure Exotel

1. In Exotel dashboard: Set app URL to `https://engine-xxx.railway.app/exotel/stream`
2. Whitelist Exotel IPs (if firewall enabled)
3. Update PUBLIC_BASE_URL in engine

---

## Database Migration Strategy

### Dashboard (Prisma)

**Creating a Migration:**
```bash
# Make schema change in prisma/schema.prisma
# Then:
npx prisma migrate dev --name <migration_name>
# Creates: prisma/migrations/TIMESTAMP_<migration_name>/migration.sql
```

**Applying in Production:**
```bash
npx prisma migrate deploy
# Runs pending migrations sequentially
```

### Engine (Hand-Written SQL)

**Creating a Migration:**
1. Create new file: `agent/app/migrations/NNN_name.sql` (NNN = next number)
2. Write SQL
3. Example:
   ```sql
   -- agent/app/migrations/011_add_outcome_fallback.sql
   ALTER TABLE agents ADD COLUMN outcome_fallback TEXT;
   ```

**Applying at Startup:**
```python
# app/db.py::migrate()
applied = await migrate(pool)
# Reads all files in migrations/ dir
# Tracks applied migrations in _schema_versions table
# Runs pending ones in order
```

**Safe Migration Practices:**
1. Always test in local/dev first
2. Take database backup before production deploy
3. Use separate transaction per logical change
4. Avoid locks on large tables (use CONCURRENTLY for indexes)
5. Rollback plan: Keep down-migration script ready

---

## Monitoring & Health Checks

### Engine Health Endpoint

**Endpoint:** `GET /health`  
**Response:**
```json
{
  "status": "ok",
  "active_calls": 2
}
```

**Used by:** Docker health checks, load balancers, uptime monitors

**Setup (Docker):**
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Dashboard Readiness

**Indicator:** Prisma client connects to database successfully

**Check:** Application responds to requests (manual polling)

### Database Connection Pool

**Engine (asyncpg):**
- Min pool size: 1
- Max pool size: 5
- Monitor: Check `SHOW max_connections` on PostgreSQL

**Dashboard (Prisma):**
- Auto-managed by Prisma Client
- Default: 10 connections per pool

**Too Many Connections Error:**
- Increase PostgreSQL `max_connections` (default 100)
- Or reduce pool sizes
- Or use connection pooler (PgBouncer)

### Logging

**Engine (Python):**
```python
# Enable DEBUG for detailed logs
LOG_LEVEL=DEBUG python -m uvicorn app.main:app
```

**Dashboard (Node.js):**
```bash
# Enable debug logging
DEBUG=* npm run dev
```

### Metrics & Monitoring (Not Yet Integrated)

**Would Monitor:**
- Active call count per process
- LLM response latencies (by provider)
- TTS latencies
- Webhook delivery success/fail rates
- Database query times
- Error rates (by endpoint)

**Tool:** Prometheus + Grafana, or provider-native (Railway metrics)

---

## Troubleshooting

### Engine Won't Start

**Check:**
1. Environment variables set: `echo $APP_SECRET_KEY`
2. Database reachable: `psql $DATABASE_URL -c "SELECT 1"`
3. Required dependencies installed: `pip list | grep fastapi`
4. Port not in use: `lsof -i :8000`
5. Logs: Set `LOG_LEVEL=DEBUG` and check output

### Dashboard Won't Start

**Check:**
1. Node modules installed: `npm ls | head -20`
2. Database reachable: `psql $DATABASE_URL -c "SELECT 1"`
3. Environment variables: `env | grep VOICE_ENGINE`
4. Port not in use: `lsof -i :5173`
5. Prisma schema valid: `npx prisma validate`

### Calls Not Placing

**Check:**
1. Engine `/health` returns `ok`
2. Exotel credentials valid (test in Exotel dashboard)
3. `ENABLE_OUTBOUND_CALLS=true` on engine
4. `MAX_CONCURRENT_CALLS > 0`
5. Campaign dispatched (check `voice_engine_jobs` status)
6. Check engine logs: `docker logs <engine-container>`

### Webhooks Not Received

**Check:**
1. Dashboard public URL reachable: `curl -X GET {VOICE_ENGINE_WEBHOOK_URL}/health` (404 ok)
2. Signature secret matches: `VOICE_ENGINE_WEBHOOK_SECRET` on dashboard = `EXOTEL_WEBHOOK_SECRET` on engine
3. Check webhook table: `SELECT * FROM voice_engine_webhook_events LIMIT 5`
4. Check call record: Did call get created? (calls.id filled?)
5. Dashboard logs for webhook endpoint (if available)

### Database Locked

**Symptom:** `LOCK timeout / could not obtain lock`

**Check:**
1. What queries are running: `SELECT * FROM pg_stat_activity`
2. Kill long-running query: `SELECT pg_terminate_backend(pid)`
3. Ensure only one migration running at a time
4. Avoid long transactions during peak load

---

## Scaling Considerations

### Vertical Scaling (Bigger Instance)

- Increase `MAX_CONCURRENT_CALLS` on engine (if resources allow)
- Increase database pool sizes
- Monitor CPU, memory, network usage

### Horizontal Scaling (Multiple Instances)

**Challenge:** State is in-process (call sessions live in memory)

**Workaround:**
1. Load balance HTTP requests (easy)
2. Sticky sessions for WebSocket (harder; Exotel expects same instance)
3. Move session state to Redis (not yet implemented)
4. Use queue + worker pattern (not yet implemented)

**Current:** Single instance only (no load balancing)

---

## Disaster Recovery

### Database Backup

**Automated:** Managed PostgreSQL service (Railway, RDS) backs up daily

**Manual Backup:**
```bash
pg_dump $DATABASE_URL > backup.sql
# Restore:
psql $DATABASE_URL < backup.sql
```

### Restore from Backup

1. Identify backup timestamp
2. Restore database to that point
3. Restart services (they will apply pending migrations)
4. Verify data integrity

---

## Deployment Checklist

- [ ] All `.env` variables set (no blanks)
- [ ] Secrets are strong (>32 chars, random)
- [ ] DATABASE_URL tested and reachable
- [ ] Public URLs use HTTPS (in production)
- [ ] Migrations applied successfully
- [ ] Health check passes
- [ ] Sample campaign dispatch tested end-to-end
- [ ] Webhook signature verified (test event sent)
- [ ] LLM/Exotel API calls working
- [ ] Database backups enabled
- [ ] Logs monitored
- [ ] Runbook/playbooks documented for operations team

---

**See also:**
- [configuration.md](configuration.md) — All environment variables
- [security.md](security.md) — Secrets management
