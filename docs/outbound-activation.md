# Outbound activation

## Existing flow and the changes

The dashboard's Start action already calls `/campaigns/dispatch`. The engine stores dispatch jobs and leads, then its existing single-process loop selects due leads within India calling hours, calls Exotel's Connect-to-flow REST API, and receives media through the existing `/exotel/stream` integration. Exotel terminal callbacks update the engine's calls; the dispatcher settles lead attempts and sends signed reports through its existing database outbox.

The campaign Test Call dialog was a placeholder. The separate Outbound Calls test form used `/calls/test` but its calls had no dispatch job, Mona report, or request deduplication. The campaign wizard also discarded its selected start timestamp.

This change connects the campaign dialog to the existing test form and endpoint. Mona resolves campaign ownership, saved persona/prompt and voice on the server. Reported tests become one-lead, one-attempt jobs in the existing engine dispatcher. They have no campaign job relationship, so tests neither advance campaign leads nor complete/pause their source campaign. Legacy engine management clients without a reporting request key retain their immediate-call response.

As requested, every tenant uses the engine's existing `EXOTEL_CALLER_ID`; no tenant-number picker or new number registry is added.

Campaign creation now submits its imported leads for execution. The saved `scheduled_at` is sent as `notBefore`; the engine persists it in the existing lead `next_attempt_at`, so closing the browser and engine restarts do not lose an accepted schedule. Date/time inputs and daily calling windows both use IST. No call is eligible before the scheduled instant; outside calling hours it waits for the next allowed window. Actual dialing also depends on available call capacity and the existing dispatcher polling interval.

`call.started` creates the existing Mona call row; completion/failure updates that same row using its engine call ID. Attribution comes from the persisted Mona job, not a webhook-supplied tenant. Signed webhook/event deduplication remains in place. Actual job usage is recorded once, including a negative balance if already-completed usage exceeds available credits; otherwise settlement would roll back job completion indefinitely. This uses the schema's existing negative-balance support and does not introduce a new rate or charging system.

Unconfirmed dispatch responses retain their existing request key. Engine-side concurrent insert conflicts return the existing job. Test UI retries retain a request key after an unconfirmed response; legacy, non-idempotent test requests are not automatically retried. Outbound capacity is reserved before calling Exotel. Paused retries preserve attempt counts and due times; exhausted leads are not restarted with a fresh attempt budget. Nonterminal Exotel callbacks do not prematurely close a call.

## Deployment order

The existing `/health` response advertises `outbound_dispatch_version: 1`. The dashboard checks this capability before posting a campaign or reported test request, so an old engine cannot silently ignore `notBefore` or dial an unreported test during a partial rollout.

These steps have not been executed against production. No live call was placed during implementation.

1. Deploy the Python engine changes first. An old engine ignores the new schedule field and cannot supply the reported test-call contract. Keep the existing single-process deployment and existing Exotel flow/WSS configuration. There is no new engine SQL migration for this change.
2. Apply the dashboard migration `20261103120000_outbound_schedule_and_tests` through the existing release migration process. It adds nullable `campaigns.scheduled_at` and permits nullable `voice_engine_jobs.campaign_id` for standalone tests. Use a direct Supabase database connection for migration tooling: this repository reads `DATABASE_URL`, and has no wired `DIRECT_URL` override. Do not point migration tooling at the transaction pooler.
3. Regenerate Prisma Client in the dashboard release (`npm run db:generate`, also performed by the existing postinstall), and deploy the dashboard. Runtime `DATABASE_URL` can continue using Supabase's transaction pooler with `pgbouncer=true`, preserving all other required URL parameters.
4. Check the existing environment values below. No new environment variable is required. Restart services after changing environment values.
5. Submit a test to a number you control. Verify the accepted request produces one initiated Mona record, then updates it to completed/failed in the same tenant. Repeat a request with its same key to verify no second dispatch. Create a short future campaign within its IST calling window and verify it remains waiting until due, then places its lead through Exotel. A saved campaign whose dispatch was not confirmed can be retried using Start; this reuses the pending key.

## Existing environment variables

Dashboard:

- `DATABASE_URL`: runtime database connection; use `pgbouncer=true` with the Supabase transaction pooler.
- `VOICE_ENGINE_BASE_URL`: reachable engine HTTP(S) base URL.
- `VOICE_ENGINE_API_KEY`: must match engine `APP_SECRET_KEY`.
- `VOICE_ENGINE_WEBHOOK_SECRET`: must match engine `DASHBOARD_WEBHOOK_SECRET`.
- `APP_BASE_URL`: publicly reachable dashboard base URL; the server appends `/api/webhooks/voice-engine`.
- `VOICE_ENGINE_CREDITS_PER_MINUTE`: existing usage conversion, unchanged by this work.

Engine:

- `ENABLE_OUTBOUND_CALLS=true`.
- `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`: existing account credentials.
- `EXOTEL_CALLER_ID`: the existing shared Exotel number used for all tenants.
- `EXOTEL_APP_ID`: existing Exotel call flow containing the configured voicebot/WSS applet.
- `PUBLIC_BASE_URL`: public engine base URL, used for `/exotel/status` callbacks.
- `EXOTEL_WEBHOOK_SECRET`: existing secret for Exotel status callbacks; separate from the Mona webhook secret.
- `APP_SECRET_KEY` and `DASHBOARD_WEBHOOK_SECRET`: match the dashboard names above.
- `MAX_CONCURRENT_CALLS` must exceed `INBOUND_RESERVED_CALLS` for outbound capacity to exist.
- Keep existing database, ASR, LLM, TTS, and inbound settings. `DASHBOARD_WEBHOOK_URL` remains the independent inbound-report setting; this outbound implementation does not change it. `VOICE_ENGINE_WEBHOOK_URL` is not an application setting.

## Validation and limits

Verified locally: 30 dashboard tests across the focused outbound execution, HTTP client, schedule and test-dialog files; 24 Python outbound/Exotel REST tests; `npm run typecheck`. Builds, production migrations, deployment and live calls were not run. Database integration expectations were updated for the new contracts but were not executed against a real database.

Exotel timeouts, server errors and unreadable placement responses are treated as uncertain, terminal attempts rather than automatically redialled. Stale claimed leads with no recorded call also produce a terminal `placement_unknown` report. Inspect Exotel's records before choosing to dial these numbers again; this trades automatic recovery for avoiding an accidental second call when placement cannot be proved.

Focused checks cover the test dialog, server-resolved campaign/tenant context, stable request keys, timezone conversion, saved lead due times, retry state, call-record updates, Exotel REST request shape, failure handling, and concurrent capacity reservations. Providers and database operations in the new contract tests are mocked. The migration and production Supabase connectivity still need release-environment verification; the focused local tests do not certify a live Exotel account or call quality.

Existing campaign credit caps and advanced retry-outcome/window controls are outside this activation patch. They are not newly implemented by saving the campaign start timestamp. This patch reuses the engine's existing retry policy and calling window.
