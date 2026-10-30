// Server-only typed HTTP client for the external Python voice engine.
// Never import this from a route file or component — it reads
// VOICE_ENGINE_API_KEY, which must stay off the client bundle.
import type {
  DispatchCampaignRequest,
  DispatchCampaignResponse,
  EngineCallDetail,
  EngineJobStatus,
  InboundPublishResult,
  EngineVoicesResult,
  InboundRoutePublishRequest,
  InboundRouteState,
  JobStatusResponse,
  TestCallOutcome,
  TestCallRequest,
  TestCallResult,
  UnroutedNumber,
  VoiceEngineHealth,
} from "./types";

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

export class VoiceEngineNotConfiguredError extends Error {}
export class VoiceEngineUnavailableError extends Error {}

function config() {
  const baseUrl = process.env["VOICE_ENGINE_BASE_URL"];
  const apiKey = process.env["VOICE_ENGINE_API_KEY"];
  if (!baseUrl || !apiKey) {
    throw new VoiceEngineNotConfiguredError(
      "Voice engine is not configured: set VOICE_ENGINE_BASE_URL and VOICE_ENGINE_API_KEY.",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

// The engine's management API authenticates with a standard `Authorization: Bearer <key>` header,
// where the key is the engine's APP_SECRET_KEY (set it here as VOICE_ENGINE_API_KEY). The
// `idempotency-key` header is informational: the engine deduplicates on the body's `idempotencyKey`,
// which makes the retries below safe.
interface EngineReply {
  status: number;
  ok: boolean;
  body: string;
}

/**
 * One engine call with a timeout. A 5xx or a network failure is retried, then reported as unavailable.
 * Any other answer, including a 4xx the caller wants to read, is returned as is.
 */
async function send(
  path: string,
  init: RequestInit,
  idempotencyKey?: string,
  attempt = 0,
): Promise<EngineReply> {
  const { baseUrl, apiKey } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...init.headers,
      },
    });
    if (response.status >= 500) {
      if (attempt < MAX_RETRIES) return send(path, init, idempotencyKey, attempt + 1);
      throw new VoiceEngineUnavailableError(`Voice engine returned ${response.status} for ${path}`);
    }
    return { status: response.status, ok: response.ok, body: await response.text() };
  } catch (error) {
    if (
      error instanceof VoiceEngineUnavailableError ||
      error instanceof VoiceEngineNotConfiguredError
    ) {
      throw error;
    }
    if (attempt < MAX_RETRIES) {
      return send(path, init, idempotencyKey, attempt + 1);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new VoiceEngineUnavailableError(`Voice engine unreachable: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(reply: EngineReply, path: string): unknown {
  try {
    return JSON.parse(reply.body);
  } catch {
    throw new VoiceEngineUnavailableError(`Voice engine sent an unreadable answer for ${path}`);
  }
}

async function request<T>(path: string, init: RequestInit, idempotencyKey?: string): Promise<T> {
  const reply = await send(path, init, idempotencyKey);
  if (!reply.ok) {
    throw new VoiceEngineUnavailableError(`Voice engine returned ${reply.status} for ${path}`);
  }
  return parseJson(reply, path) as T;
}

export function checkVoiceEngineHealth(): Promise<VoiceEngineHealth> {
  return request<VoiceEngineHealth>("/health", { method: "GET" });
}

/** How a thrown (not returned-as-a-value) engine error is shown to the person using the dashboard. Pulled
 * out so callers can test it directly, without going through an actually-thrown/rejected error — asserting
 * that through a vi.fn() mock proved unreliable here (an "unhandled rejection" even when the catching code
 * ran correctly) once a test file had more than one test. */
export function engineErrorReason(error: unknown): string {
  if (error instanceof VoiceEngineNotConfiguredError) return "Voice engine is not configured yet.";
  if (error instanceof VoiceEngineUnavailableError) return error.message;
  return "Unexpected error reaching the voice engine.";
}

/** The real voices the configured TTS provider has right now, for the campaign wizard's voice picker. */
export function listEngineVoices(): Promise<EngineVoicesResult> {
  return request<EngineVoicesResult>("/voices", { method: "GET" });
}

export function dispatchCampaignToEngine(
  body: DispatchCampaignRequest,
): Promise<DispatchCampaignResponse> {
  return request<DispatchCampaignResponse>(
    "/campaigns/dispatch",
    { method: "POST", body: JSON.stringify(body) },
    body.idempotencyKey,
  );
}

export function getEngineJobStatus(engineJobId: string): Promise<JobStatusResponse> {
  return request<JobStatusResponse>(`/jobs/${encodeURIComponent(engineJobId)}`, { method: "GET" });
}

/**
 * Publishes one inbound route. The engine accepts a version only if it is newer than the one it holds,
 * so a retry of the same publish is harmless. Refusals the caller must act on come back as values;
 * an unreachable or failing engine throws VoiceEngineUnavailableError.
 */
export async function publishInboundRoute(
  body: InboundRoutePublishRequest,
): Promise<InboundPublishResult> {
  const reply = await send("/inbound/routes", { method: "PUT", body: JSON.stringify(body) });
  const parsed = parseJson(reply, "/inbound/routes") as {
    status?: "applied" | "unchanged";
    detail?: { code?: string; currentVersion?: number; message?: string } | string;
  };
  if (reply.ok && parsed.status === "applied") return { kind: "applied" };
  if (reply.ok && parsed.status === "unchanged") return { kind: "unchanged" };
  const detail = typeof parsed.detail === "object" ? parsed.detail : undefined;
  if (reply.status === 409 && detail?.code === "stale_version" && detail.currentVersion) {
    return { kind: "stale", currentVersion: detail.currentVersion };
  }
  const reasons: Record<string, string> = {
    version_conflict: "The engine already has this version with different content.",
    number_taken: "This number is already routed for another workspace on the engine.",
  };
  const code = detail?.code ?? "rejected";
  return {
    kind: "rejected",
    code,
    message:
      detail?.message ?? reasons[code] ?? `The voice engine refused the route (${reply.status}).`,
  };
}

/** One call with its turns. Needs the engine's key, so only server code can read a transcript. */
export function getEngineCall(callId: string): Promise<EngineCallDetail> {
  return request<EngineCallDetail>(`/calls/${encodeURIComponent(callId)}`, { method: "GET" });
}

/** Numbers calls reached on that have no published route: the usual sign of a route keyed to the wrong number. */
export function getUnroutedInbound(): Promise<UnroutedNumber[]> {
  return request<UnroutedNumber[]>("/inbound/unrouted", { method: "GET" });
}

/** The route the engine is serving for a number, or null if none is published. */
export async function getInboundRoute(phone: string): Promise<InboundRouteState | null> {
  const path = `/inbound/routes/${encodeURIComponent(phone)}`;
  const reply = await send(path, { method: "GET" });
  if (reply.status === 404) return null;
  if (!reply.ok)
    throw new VoiceEngineUnavailableError(`Voice engine returned ${reply.status} for ${path}`);
  return parseJson(reply, path) as InboundRouteState;
}

/** Idempotent: a job that already finished answers with its final status instead of an error. */
export function cancelEngineJob(engineJobId: string): Promise<{ status: EngineJobStatus }> {
  return request<{ status: EngineJobStatus }>(`/jobs/${encodeURIComponent(engineJobId)}/cancel`, {
    method: "POST",
  });
}

/**
 * Places one real call right away (no campaign, no job, no webhook report). The engine creates or reuses the
 * agent for this persona itself. Refusals (outbound disabled, persona unspeakable, capacity, Exotel failure)
 * come back as a value with the engine's own message; an unreachable or failing engine throws as usual.
 */
export async function placeTestCall(body: TestCallRequest): Promise<TestCallOutcome> {
  const path = "/calls/test";
  const reply = await send(path, { method: "POST", body: JSON.stringify(body) });
  if (reply.ok) return { kind: "placed", call: parseJson(reply, path) as TestCallResult };
  const parsed = parseJson(reply, path) as { detail?: string };
  return {
    kind: "rejected",
    message: parsed.detail ?? `The voice engine refused the call (${reply.status}).`,
  };
}
