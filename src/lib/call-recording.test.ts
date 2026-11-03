import type { PrismaClient } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
import { getCallRecordingFor } from "./calls.functions";
import { getEngineRecording } from "./voice-engine/client";
import { currentWorkspaceClient } from "./workspace.functions";

vi.mock("./db.server", () => ({ db: {} }));
vi.mock("./auth.server", () => ({ requireAuth: {} }));
vi.mock("./workspace.functions", () => ({ currentWorkspaceClient: vi.fn() }));
vi.mock("./voice-engine/client", () => ({ getEngineRecording: vi.fn(), getEngineCall: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentWorkspaceClient).mockResolvedValue({
    id: "workspace", name: "Workspace", status: "active", creditBalance: 0,
  });
});

it("only proxies recordings for calls in the caller's workspace", async () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  const database = { call: { findFirst } } as unknown as PrismaClient;
  expect((await getCallRecordingFor(database, "user", "foreign")).status).toBe(404);
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign", clientId: "workspace" } }));
  expect(getEngineRecording).not.toHaveBeenCalled();

  findFirst.mockResolvedValue({ engineCallId: "42", direction: "outbound", dialledNumber: "+918000000001" });
  vi.mocked(getEngineRecording).mockResolvedValue(new Response("audio", { headers: { "content-type": "audio/mpeg" } }));
  const response = await getCallRecordingFor(database, "user", "owned");
  expect(await response.text()).toBe("audio");
  expect(getEngineRecording).toHaveBeenCalledWith("42", "workspace", "outbound", "+918000000001");
});
