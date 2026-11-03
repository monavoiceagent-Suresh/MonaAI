import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestOutboundCallCard } from "./TestOutboundCallCard";
import { testOutboundCall } from "@/lib/outbound-test-call.functions";

vi.mock("@/lib/outbound-test-call.functions", () => ({ testOutboundCall: vi.fn() }));
vi.mock("./CampaignControls", () => ({ PersonaPicker: () => <div>Persona picker</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function confirmCall() {
  fireEvent.click(screen.getByRole("button", { name: "Call now" }));
  fireEvent.click(await screen.findByRole("button", { name: "Call +919876543210" }));
}

it("queues a campaign test only after entering a destination and confirming", async () => {
  vi.mocked(testOutboundCall).mockResolvedValue({ ok: true, jobId: "job", status: "queued" });
  render(<TestOutboundCallCard campaignId="campaign" />);
  expect(screen.getByRole("button", { name: "Call now" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Phone number to call"), { target: { value: "+919876543210" } });
  expect(testOutboundCall).not.toHaveBeenCalled();
  await confirmCall();
  await screen.findByText("Test call queued. Its status will appear in Outbound Calls.");
  expect(testOutboundCall).toHaveBeenCalledWith({ data: expect.objectContaining({
    campaignId: "campaign", to: "+919876543210", idempotencyKey: expect.any(String),
  }) });
  expect(screen.queryByText("Persona picker")).toBeNull();
});

it("shows a failure honestly and retains the same key after unconfirmed acceptance", async () => {
  vi.mocked(testOutboundCall).mockResolvedValue({ ok: false, reason: "Acceptance unconfirmed", retrySameKey: true });
  render(<TestOutboundCallCard campaignId="campaign" />);
  fireEvent.change(screen.getByLabelText("Phone number to call"), { target: { value: "+919876543210" } });
  await confirmCall();
  await screen.findByRole("alert");
  await waitFor(() => expect(screen.getByRole("button", { name: "Call now" })).toBeEnabled());
  await confirmCall();
  await waitFor(() => expect(testOutboundCall).toHaveBeenCalledTimes(2));
  expect(vi.mocked(testOutboundCall).mock.calls[0]?.[0]?.data?.idempotencyKey)
    .toBe(vi.mocked(testOutboundCall).mock.calls[1]?.[0]?.data?.idempotencyKey);
  expect(screen.queryByText("Test call queued. Its status will appear in Outbound Calls.")).toBeNull();
});
