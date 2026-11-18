import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PersonaBuilder } from "./PersonaBuilder";
import { AddPersonaDialog } from "./AddPersonaDialog";
import { PERSONA_BUILDER_PROMPT } from "@/lib/persona-builder";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./CampaignControls", () => ({
  Picker: ({ label }: { label: string }) => <div>{label}</div>,
}));

const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(cleanup);

it("explains the three-step workflow and where each output goes", () => {
  render(<PersonaBuilder />);
  for (const step of ["Copy prompt", "Complete AI interview", "Paste generated outputs"])
    expect(screen.getByText(step)).toBeInTheDocument();
  for (const field of ["Knowledge base", "System instructions", "Opening greeting"])
    expect(screen.getByText(field)).toBeInTheDocument();
});

it("copies the full master prompt and confirms it", async () => {
  render(<PersonaBuilder />);
  fireEvent.click(screen.getByRole("button", { name: "Copy master prompt" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(writeText).toHaveBeenCalledWith(PERSONA_BUILDER_PROMPT);
  expect(toast.success).toHaveBeenCalled();
});

it("falls back to the preview when the clipboard refuses", async () => {
  writeText.mockRejectedValue(new Error("denied"));
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
  render(<PersonaBuilder />);
  fireEvent.click(screen.getByRole("button", { name: "Copy master prompt" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Master prompt")).toHaveValue(PERSONA_BUILDER_PROMPT);
});

it("toggles a read-only preview of the prompt", () => {
  render(<PersonaBuilder />);
  expect(screen.queryByLabelText("Master prompt")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview prompt" }));
  expect(screen.getByLabelText("Master prompt")).toHaveAttribute("readonly");
});

it("lets all three generated outputs be pasted when creating a persona", async () => {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(<AddPersonaDialog existingKeys={[]} onClose={() => {}} onCreate={onCreate} />);
  expect(screen.getByRole("heading", { name: "AI Persona Builder" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Clinic front desk" },
  });
  fireEvent.change(screen.getByLabelText("System instructions"), {
    target: { value: "You are Asha. [[KNOWLEDGE]]" },
  });
  fireEvent.change(screen.getByLabelText(/Knowledge base/), {
    target: { value: "Open nine to six." },
  });
  fireEvent.change(screen.getByLabelText(/Opening greeting/), {
    target: { value: "Hello, this is Asha." },
  });
  fireEvent.click(screen.getByRole("button", { name: /Create persona/ }));
  await waitFor(() =>
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        personaKey: "clinic-front-desk",
        instructions: "You are Asha. [[KNOWLEDGE]]",
        knowledge: "Open nine to six.",
        greeting: "Hello, this is Asha.",
      }),
    ),
  );
});
