import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prompts } from "./Prompts";
import { RecognitionHintsField } from "./RecognitionHintsField";
import { listPrompts, savePromptVersion } from "@/lib/prompts.functions";
import { newPromptContent } from "@/lib/prompts";

vi.mock("@/lib/prompts.functions", () => ({
  listPrompts: vi.fn(),
  savePromptVersion: vi.fn(),
  deletePrompt: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./CampaignControls", () => ({
  Picker: ({ label }: { label: string }) => <div>{label}</div>,
}));

const existing = { ...newPromptContent("Clinic desk"), recognitionHints: "Apollo Clinic" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPrompts).mockResolvedValue({
    client: { id: "c" },
    prompts: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        content: existing,
        versions: [{ version: 1, at: new Date().toISOString(), content: existing }],
      },
    ],
  } as never);
  vi.mocked(savePromptVersion).mockResolvedValue({
    promptId: "11111111-1111-1111-1111-111111111111",
    version: 2,
  });
});
afterEach(cleanup);
// The Prompts page loads through react-query; under a full parallel test run that can take over a second.
const slow = { timeout: 10_000 };

function renderPrompts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Prompts />
    </QueryClientProvider>,
  );
}
const savedContent = () => vi.mocked(savePromptVersion).mock.calls.at(-1)?.[0]?.data.content;

it(
  "explains the field, uses the suggested placeholder and previews the terms",
  { timeout: 30_000 },
  () => {
    const onChange = vi.fn();
    const { rerender } = render(<RecognitionHintsField value="" onChange={onChange} />);
    const box = screen.getByLabelText(/Speech recognition prompting/);
    expect(box).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Example: RFID, UHF, EPC Gen2, GreenFuturz."),
    );
    expect(screen.getByText("No terms: standard recognition")).toBeInTheDocument();
    expect(screen.getByText("Examples by industry")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "RFID, UHF" } });
    expect(onChange).toHaveBeenCalledWith("RFID, UHF");
    rerender(<RecognitionHintsField value={`RFID, UHF, ${"x".repeat(60)}`} onChange={onChange} />);
    expect(screen.getByText("2 of up to 50 terms will be used")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Skipped 1 entry longer than 20 characters",
    );
    rerender(<RecognitionHintsField value="RFID, <b>tag</b>" onChange={onChange} />);
    expect(screen.getByRole("status")).toHaveTextContent("Skipped 1 entry containing");
  },
);

it("saves recognition hints when a persona is created", { timeout: 30_000 }, async () => {
  renderPrompts();
  fireEvent.click((await screen.findAllByRole("button", { name: "Add persona" }, slow))[0]!);
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Display name"), { target: { value: "RFID desk" } });
  fireEvent.change(dialog.getByLabelText("System instructions"), {
    target: { value: "Help callers." },
  });
  fireEvent.change(dialog.getByLabelText(/Speech recognition prompting/), {
    target: { value: " RFID, EPC Gen2 " },
  });
  fireEvent.click(dialog.getByRole("button", { name: /Create persona/ }));
  await waitFor(() => expect(savePromptVersion).toHaveBeenCalled(), slow);
  expect(vi.mocked(savePromptVersion).mock.calls[0]?.[0]?.data.promptId).toBeNull();
  expect(savedContent()?.recognitionHints).toBe("RFID, EPC Gen2");
});

it(
  "edits and saves an existing persona's recognition hints, and can clear them",
  { timeout: 30_000 },
  async () => {
    renderPrompts();
    const box = await screen.findByLabelText(/Speech recognition prompting/, {}, slow);
    expect(box).toHaveValue("Apollo Clinic");
    fireEvent.change(box, { target: { value: "Apollo Clinic, ECG" } });
    fireEvent.click(screen.getByRole("button", { name: /Save prompt/ }));
    await waitFor(() => expect(savedContent()?.recognitionHints).toBe("Apollo Clinic, ECG"), slow);

    fireEvent.change(screen.getByLabelText(/Speech recognition prompting/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save prompt/ }));
    await waitFor(() => expect(savedContent()?.recognitionHints).toBe(""), slow);
  },
);
