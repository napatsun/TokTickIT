/**
 * AttachmentSection.test.tsx — UI tests for AttachmentSection
 *
 * Covers:
 *   UI-13 — AC-17: Mocked successful attachment add
 *   UI-14 — AC-19, AC-20: Removal confirmation flow
 *   UI-15 — BR-35: Removed attachment renders with Unavailable label
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AttachmentSection from "../../src/components/ticket-detail/AttachmentSection";

// ─── Mock apiClient ─────────────────────────────────────────────────────

const mockApiResponse = vi.fn();

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const result = mockApiResponse();
    const data = await result;
    return {
      ok: data._ok !== undefined ? data._ok : true,
      status: data.status ?? 200,
      json: async () => data,
      blob: async () => new Blob(["test content"]),
    };
  }),
}));

// ─── Mock data ──────────────────────────────────────────────────────────

const activeAttachments = [
  {
    id: 9001,
    originalFileName: "battery_report.pdf",
    fileSizeBytes: 204800,
    mimeType: "application/pdf",
    uploadedAt: "2026-08-22T09:14:00.500Z",
  },
  {
    id: 9003,
    originalFileName: "screenshot.png",
    fileSizeBytes: 102400,
    mimeType: "image/png",
    uploadedAt: "2026-08-22T11:00:00.000Z",
  },
];

const removedAttachments = [
  {
    id: 9002,
    originalFileName: "old_log.png",
    fileSizeBytes: 51200,
    removedAt: "2026-08-22T10:00:00.000Z",
    removedReason: "Uploaded wrong file",
  },
];

function renderSection(
  overrides: Partial<{
    activeAttachments: typeof activeAttachments;
    removedAttachments: typeof removedAttachments;
    activeCount: number;
  }> = {},
) {
  const active = overrides.activeAttachments ?? activeAttachments;
  const removed = overrides.removedAttachments ?? removedAttachments;

  return render(
    <AttachmentSection
      ticketNumber="TKT-2026-000501"
      activeAttachments={active}
      removedAttachments={removed}
      onAttachmentAdded={vi.fn()}
      onAttachmentRemoved={vi.fn()}
    />,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("UI-15 — Removed attachment renders correctly (BR-35)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows removed attachments with Unavailable label", () => {
    renderSection();

    expect(screen.getByText("old_log.png")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    // Removal reason is part of a larger text node, use textContent check
    expect(screen.getByText(/Uploaded wrong file/)).toBeInTheDocument();
  });

  it("does NOT show Download button for removed attachments", () => {
    renderSection();

    // Download buttons should only exist for active attachments
    const downloadButtons = screen.getAllByText("Download");
    expect(downloadButtons).toHaveLength(activeAttachments.length);
  });

  it("does NOT show Remove button for removed attachments", () => {
    renderSection();

    const removeButtons = screen.getAllByText("Remove");
    expect(removeButtons).toHaveLength(activeAttachments.length);
  });

  it("shows removed section heading with count", () => {
    renderSection();

    expect(screen.getByText("Removed (1)")).toBeInTheDocument();
  });
});

describe("UI-13 — Active attachments display and Add Attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders active attachments with filename, size, and date", () => {
    renderSection();

    expect(screen.getByText("battery_report.pdf")).toBeInTheDocument();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByText(/200\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/100\.0 KB/)).toBeInTheDocument();
  });

  it("shows attachment count in heading", () => {
    renderSection();

    expect(screen.getByText("Attachments (2 active)")).toBeInTheDocument();
  });

  it("shows Add Attachment picker when under 5 active", () => {
    renderSection();

    // AttachmentPicker should be present (has browse/drop zone) — text is lowercase
    expect(screen.getByText(/browse files/)).toBeInTheDocument();
  });

  it("shows limit message when 5 active attachments exist", () => {
    const fiveAttachments = Array.from({ length: 5 }, (_, i) => ({
      id: 9000 + i,
      originalFileName: `file${i}.png`,
      fileSizeBytes: 10240,
      mimeType: "image/png",
      uploadedAt: "2026-08-22T09:00:00.000Z",
    }));

    renderSection({ activeAttachments: fiveAttachments, removedAttachments: [] });

    expect(
      screen.getByText(/Maximum of 5 active attachments reached/),
    ).toBeInTheDocument();
    // No AttachmentPicker should be present
    expect(screen.queryByText(/Browse files/)).not.toBeInTheDocument();
  });

  it("shows empty message when no active attachments", () => {
    renderSection({ activeAttachments: [], removedAttachments: [] });

    expect(screen.getByText("No active attachments.")).toBeInTheDocument();
  });
});

describe("UI-14 — Remove confirmation flow (AC-19, AC-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens confirm dialog when Remove is clicked", async () => {
    const user = userEvent.setup();
    renderSection();

    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);

    expect(screen.getByText("Remove Attachment")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Enter reason for removal/),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirm Removal")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("Confirm Removal is disabled when reason is too short", async () => {
    const user = userEvent.setup();
    renderSection();

    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);

    const textarea = screen.getByPlaceholderText(/Enter reason for removal/);
    await user.type(textarea, "ab");

    const confirmButton = screen.getByText("Confirm Removal");
    expect(confirmButton).toBeDisabled();
  });

  it("Confirm Removal is enabled when reason is valid (3+ chars)", async () => {
    const user = userEvent.setup();
    renderSection();

    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);

    const textarea = screen.getByPlaceholderText(/Enter reason for removal/);
    await user.type(textarea, "Wrong file uploaded");

    const confirmButton = screen.getByText("Confirm Removal");
    expect(confirmButton).toBeEnabled();
  });

  it("Cancel closes the dialog without removing", async () => {
    const user = userEvent.setup();
    renderSection();

    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);

    expect(screen.getByText("Remove Attachment")).toBeInTheDocument();

    await user.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Remove Attachment")).not.toBeInTheDocument();
  });
});

describe("UI-39 — Attachment add error display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error message when upload fails with server error", async () => {
    const user = userEvent.setup();

    // First call: upload fails
    mockApiResponse.mockReturnValue({ _ok: false, error: { message: "Attachment limit reached" } });

    renderSection({ activeAttachments: [], removedAttachments: [] });

    // Add a file via the file input
    const file = new File(["test"], "test.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Wait for the upload button to appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /upload attachment/i })).toBeInTheDocument();
    });

    // Click upload
    const uploadButton = screen.getByRole("button", { name: /upload attachment/i });
    await user.click(uploadButton);

    await waitFor(() => {
      expect(screen.getByText("Attachment limit reached")).toBeInTheDocument();
    });
  });

  it("shows generic error message on network failure during upload", async () => {
    const user = userEvent.setup();

    // First call: network error
    mockApiResponse.mockRejectedValue(new Error("Network error"));

    renderSection({ activeAttachments: [], removedAttachments: [] });

    // Add a file via the file input
    const file = new File(["test"], "test.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Wait for the upload button to appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /upload attachment/i })).toBeInTheDocument();
    });

    // Click upload
    const uploadButton = screen.getByRole("button", { name: /upload attachment/i });
    await user.click(uploadButton);

    await waitFor(() => {
      expect(screen.getByText("Failed to upload attachment.")).toBeInTheDocument();
    });
  });

  it("shows 'Uploading…' busyLabel while upload is in flight", async () => {
    const user = userEvent.setup();

    // Delay the response by 500ms so the busy state is observable
    mockApiResponse.mockReturnValue(
      new Promise((resolve) =>
        setTimeout(() => resolve({ _ok: true, status: 201, id: "a1" }), 500)
      )
    );

    renderSection({ activeAttachments: [], removedAttachments: [] });

    // Add a file via the file input
    const file = new File(["test"], "test.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Wait for the upload button to appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /upload attachment/i })).toBeInTheDocument();
    });

    // Click upload
    const uploadButton = screen.getByRole("button", { name: /upload attachment/i });
    await user.click(uploadButton);

    // Button should now show busy label "Uploading…" (not the original children text)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Uploading/i })).toBeInTheDocument();
    });

    // Button should be disabled during upload
    expect(screen.getByRole("button", { name: /Uploading/i })).toBeDisabled();
  });
});

describe("UI-40 — Attachment remove error display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error in dialog when DELETE fails", async () => {
    const user = userEvent.setup();

    // Mock: DELETE returns error
    mockApiResponse.mockReturnValue({ _ok: false, error: { message: "Failed to remove attachment" } });

    renderSection();

    // Open remove dialog
    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);

    // Enter valid reason
    const textarea = screen.getByPlaceholderText(/Enter reason for removal/);
    await user.type(textarea, "Wrong file uploaded");

    // Confirm removal
    const confirmButton = screen.getByText("Confirm Removal");
    await user.click(confirmButton);

    // Error should appear in the dialog
    await waitFor(() => {
      expect(screen.getByText("Failed to remove attachment")).toBeInTheDocument();
    });

    // Dialog should still be open
    expect(screen.getByText("Remove Attachment")).toBeInTheDocument();
  });

  it("shows generic error on network failure during remove", async () => {
    const user = userEvent.setup();

    // Mock: network error
    mockApiResponse.mockRejectedValue(new Error("Network error"));

    renderSection();

    // Open remove dialog
    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);

    // Enter valid reason
    const textarea = screen.getByPlaceholderText(/Enter reason for removal/);
    await user.type(textarea, "Wrong file uploaded");

    // Confirm removal
    const confirmButton = screen.getByText("Confirm Removal");
    await user.click(confirmButton);

    // Error should appear
    await waitFor(() => {
      expect(screen.getByText(/Failed to remove attachment/)).toBeInTheDocument();
    });

    // Dialog should still be open for retry
    expect(screen.getByText("Remove Attachment")).toBeInTheDocument();
  });

  it("Cancel closes dialog and clears error", async () => {
    const user = userEvent.setup();

    // Mock: DELETE returns error
    mockApiResponse.mockReturnValue({ _ok: false, error: { message: "Server error" } });

    renderSection();

    // Open remove dialog
    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);

    // Enter valid reason and confirm
    const textarea = screen.getByPlaceholderText(/Enter reason for removal/);
    await user.type(textarea, "Wrong file");
    await user.click(screen.getByText("Confirm Removal"));

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });

    // Cancel should close dialog
    await user.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Remove Attachment")).not.toBeInTheDocument();
  });
});

describe("UI-41 — Attachment download error feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error message when download fails with non-ok response", async () => {
    const user = userEvent.setup();

    // Mock: download returns 404
    mockApiResponse.mockReturnValue({ _ok: false, status: 404 });

    renderSection();

    // Click download
    const downloadButtons = screen.getAllByText("Download");
    await user.click(downloadButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Download failed/)).toBeInTheDocument();
    });
  });

  it("shows error message when download throws network error", async () => {
    const user = userEvent.setup();

    // Mock: network error
    mockApiResponse.mockRejectedValue(new Error("Network error"));

    renderSection();

    // Click download
    const downloadButtons = screen.getAllByText("Download");
    await user.click(downloadButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Download failed/)).toBeInTheDocument();
    });
  });
});
