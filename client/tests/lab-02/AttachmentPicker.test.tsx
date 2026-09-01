/**
 * AttachmentPicker — Automated tests (jsdom-compatible)
 *
 * Covers what jsdom CAN verify (no drag-drop / DataTransfer):
 * - File size display format (formatFileSize)
 * - Error message per rejected file
 * - Counter display (n/5)
 * - Remove button calls onFilesChange with file removed
 * - Remove button has accessible name (aria-label)
 * - Counter shows "5/5" and drop zone is disabled at max (BR-30)
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import AttachmentPicker, {
  type PendingFile,
} from "../../src/components/shared/AttachmentPicker";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeFile(
  name: string,
  sizeBytes: number,
  type = "image/jpeg",
): File {
  // Create a File with specific size by padding content
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

function makePendingFile(
  name: string,
  sizeBytes: number,
  error?: string,
  type = "image/jpeg",
): PendingFile {
  return { file: makeFile(name, sizeBytes, type), error };
}

function renderPicker(
  files: PendingFile[] = [],
  opts: { maxFiles?: number; onChange?: ReturnType<typeof vi.fn> } = {},
) {
  const onChange = opts.onChange ?? vi.fn();
  return {
    onChange,
    ...render(
      <AttachmentPicker
        files={files}
        onFilesChange={onChange}
        maxFiles={opts.maxFiles}
      />,
    ),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("AttachmentPicker", () => {
  // ─── formatFileSize display ─────────────────────────────────────

  describe("file size display", () => {
    it("shows bytes for files under 1 KB", () => {
      renderPicker([makePendingFile("tiny.txt", 512)]);
      expect(screen.getByText("512 B")).toBeInTheDocument();
    });

    it("shows KB with one decimal for files under 1 MB", () => {
      // 2.5 KB = 2560 bytes
      renderPicker([makePendingFile("small.jpg", 2560)]);
      expect(screen.getByText("2.5 KB")).toBeInTheDocument();
    });

    it("shows MB with one decimal for files over 1 MB", () => {
      // 2.3 MB = 2.3 * 1024 * 1024 = 2411724.8 → rounded
      const sizeBytes = Math.round(2.3 * 1024 * 1024);
      renderPicker([makePendingFile("large.jpg", sizeBytes)]);
      expect(screen.getByText("2.3 MB")).toBeInTheDocument();
    });

    it("shows exactly 5.0 MB for the max size threshold", () => {
      const sizeBytes = 5 * 1024 * 1024;
      renderPicker([makePendingFile("max.pdf", sizeBytes)]);
      expect(screen.getByText("5.0 MB")).toBeInTheDocument();
    });

    it("does NOT show raw bytes for large files", () => {
      const sizeBytes = 3 * 1024 * 1024;
      renderPicker([makePendingFile("big.png", sizeBytes)]);
      // Should show formatted, not raw bytes
      expect(screen.queryByText(sizeBytes.toString())).not.toBeInTheDocument();
    });
  });

  // ─── Inline error per file ──────────────────────────────────────

  describe("inline error messages", () => {
    it("shows error message for a file with wrong type", () => {
      renderPicker([
        makePendingFile("photo.jpg", 5000, "image/jpeg"),
        { file: makeFile("bad.docx", 1000, "application/msword"), error: "Unsupported file type" },
      ]);
      expect(screen.getByText("Unsupported file type")).toBeInTheDocument();
    });

    it("shows correct error for oversized file", () => {
      renderPicker([
        { file: makeFile("huge.jpg", 6 * 1024 * 1024, "image/jpeg"), error: "Exceeds 5.0 MB limit" },
      ]);
      expect(screen.getByText("Exceeds 5.0 MB limit")).toBeInTheDocument();
    });

    it("shows correct error for unsupported file type", () => {
      renderPicker([
        { file: makeFile("doc.docx", 1000, "application/msword"), error: "Unsupported file type" },
      ]);
      expect(screen.getByText("Unsupported file type")).toBeInTheDocument();
    });

    it("does NOT show size for rejected files (error shown instead)", () => {
      renderPicker([
        { file: makeFile("bad.jpg", 5000, "image/jpeg"), error: "Unsupported file type" },
      ]);
      // Size should not be displayed for errored files
      expect(screen.queryByText("4.9 KB")).not.toBeInTheDocument();
    });

    it("shows valid file size alongside errored file", () => {
      renderPicker([
        { file: makeFile("good.jpg", 5000, "image/jpeg") },
        { file: makeFile("bad.docx", 1000, "application/msword"), error: "Unsupported file type" },
      ]);
      // Valid file shows size
      expect(screen.getByText("4.9 KB")).toBeInTheDocument();
      // Error file shows error
      expect(screen.getByText("Unsupported file type")).toBeInTheDocument();
    });

    it("error message has role=alert for accessibility", () => {
      renderPicker([
        { file: makeFile("bad.docx", 1000, "application/msword"), error: "Unsupported file type" },
      ]);
      expect(screen.getByRole("alert")).toHaveTextContent("Unsupported file type");
    });
  });

  // ─── Counter display ────────────────────────────────────────────

  describe("counter", () => {
    it("shows 0/5 when no files", () => {
      renderPicker([]);
      expect(screen.getByText("0/5")).toBeInTheDocument();
    });

    it("shows 1/5 for one valid file", () => {
      renderPicker([makePendingFile("a.jpg", 1000)]);
      expect(screen.getByText("1/5")).toBeInTheDocument();
    });

    it("counts only valid files (no error) in counter", () => {
      renderPicker([
        makePendingFile("good.jpg", 1000),
        { file: makeFile("bad.docx", 500, "application/msword"), error: "Unsupported file type" },
      ]);
      // Only 1 valid file
      expect(screen.getByText("1/5")).toBeInTheDocument();
    });

    it("counts 3 valid files out of 5 total (2 errored)", () => {
      renderPicker([
        makePendingFile("a.jpg", 1000),
        makePendingFile("b.png", 2000),
        makePendingFile("c.pdf", 3000),
        { file: makeFile("d.docx", 400, "application/msword"), error: "Unsupported file type" },
        { file: makeFile("e.exe", 500, "application/octet-stream"), error: "Unsupported file type" },
      ]);
      expect(screen.getByText("3/5")).toBeInTheDocument();
    });

    it("uses custom maxFiles when provided", () => {
      renderPicker([makePendingFile("a.jpg", 1000)], { maxFiles: 3 });
      expect(screen.getByText("1/3")).toBeInTheDocument();
    });
  });

  // ─── Remove button ─────────────────────────────────────────────

  describe("remove button", () => {
    it("calls onFilesChange without the removed file", async () => {
      const user = userEvent.setup();
      const files = [
        makePendingFile("a.jpg", 1000),
        makePendingFile("b.png", 2000),
      ];
      const { onChange } = renderPicker(files);

      const removeBtn = screen.getByRole("button", { name: "Remove a.jpg" });
      await user.click(removeBtn);

      expect(onChange).toHaveBeenCalledTimes(1);
      const newFiles = onChange.mock.calls[0][0] as PendingFile[];
      expect(newFiles).toHaveLength(1);
      expect(newFiles[0].file.name).toBe("b.png");
    });

    it("remove button has accessible name (aria-label)", () => {
      renderPicker([makePendingFile("screenshot.png", 5000)]);
      const btn = screen.getByRole("button", { name: "Remove screenshot.png" });
      expect(btn).toHaveAttribute("aria-label", "Remove screenshot.png");
    });

    it("remove button has title tooltip", () => {
      renderPicker([makePendingFile("photo.jpg", 3000)]);
      const btn = screen.getByRole("button", { name: "Remove photo.jpg" });
      expect(btn).toHaveAttribute("title", "Remove photo.jpg");
    });

    it("removing first file preserves others", async () => {
      const user = userEvent.setup();
      const files = [
        makePendingFile("a.jpg", 1000),
        makePendingFile("b.png", 2000),
        makePendingFile("c.pdf", 3000),
      ];
      const { onChange } = renderPicker(files);

      await user.click(screen.getByRole("button", { name: "Remove a.jpg" }));

      const newFiles = onChange.mock.calls[0][0] as PendingFile[];
      expect(newFiles).toHaveLength(2);
      expect(newFiles.map((f) => f.file.name)).toEqual(["b.png", "c.pdf"]);
    });

    it("removing last file results in empty array", async () => {
      const user = userEvent.setup();
      const files = [makePendingFile("only.jpg", 1000)];
      const { onChange } = renderPicker(files);

      await user.click(screen.getByRole("button", { name: "Remove only.jpg" }));

      const newFiles = onChange.mock.calls[0][0] as PendingFile[];
      expect(newFiles).toHaveLength(0);
    });
  });

  // ─── BR-30: Max files limit ────────────────────────────────────

  describe("BR-30: max files limit", () => {
    it("shows 5/5 when 5 valid files are present", () => {
      renderPicker([
        makePendingFile("a.jpg", 1000),
        makePendingFile("b.jpg", 1000),
        makePendingFile("c.jpg", 1000),
        makePendingFile("d.jpg", 1000),
        makePendingFile("e.jpg", 1000),
      ]);
      expect(screen.getByText("5/5")).toBeInTheDocument();
    });

    it("drop zone is disabled when at max files", () => {
      renderPicker([
        makePendingFile("a.jpg", 1000),
        makePendingFile("b.jpg", 1000),
        makePendingFile("c.jpg", 1000),
        makePendingFile("d.jpg", 1000),
        makePendingFile("e.jpg", 1000),
      ]);
      const dropZone = screen.getByRole("button", {
        name: "Maximum attachments reached",
      });
      expect(dropZone).toHaveAttribute("aria-disabled", "true");
      expect(dropZone).toHaveAttribute("tabindex", "-1");
    });

    it("drop zone is NOT disabled when under max files", () => {
      renderPicker([makePendingFile("a.jpg", 1000)]);
      const dropZone = screen.getByRole("button", {
        name: "Drop files here or click to browse",
      });
      expect(dropZone).not.toHaveAttribute("aria-disabled", "true");
    });

    it("drop zone returns to enabled after removing a file from max", async () => {
      const user = userEvent.setup();

      // Need a stateful wrapper since AttachmentPicker is controlled
      function StatefulWrapper() {
        const [files, setFiles] = useState<PendingFile[]>([
          makePendingFile("a.jpg", 1000),
          makePendingFile("b.jpg", 1000),
          makePendingFile("c.jpg", 1000),
          makePendingFile("d.jpg", 1000),
          makePendingFile("e.jpg", 1000),
        ]);
        return <AttachmentPicker files={files} onFilesChange={setFiles} />;
      }

      render(<StatefulWrapper />);

      // At max — counter text is split across nodes, use container text
      const counter = document.querySelector(`[class*="counter"]`);
      expect(counter?.textContent?.replace(/\s/g, "")).toBe("5/5");

      // Remove one
      await user.click(screen.getByRole("button", { name: "Remove a.jpg" }));

      // Should be back to enabled
      expect(counter?.textContent?.replace(/\s/g, "")).toBe("4/5");
      expect(
        screen.getByRole("button", {
          name: "Drop files here or click to browse",
        }),
      ).toBeInTheDocument();
    });
  });

  // ─── Filename display ──────────────────────────────────────────

  describe("filename display", () => {
    it("shows the filename", () => {
      renderPicker([makePendingFile("important-document.pdf", 5000)]);
      expect(screen.getByText("important-document.pdf")).toBeInTheDocument();
    });

    it("filename element has title attribute for full name on hover", () => {
      renderPicker([makePendingFile("very-long-filename-here.jpg", 1000)]);
      const el = screen.getByText("very-long-filename-here.jpg");
      expect(el).toHaveAttribute("title", "very-long-filename-here.jpg");
    });
  });

  // ─── Drop zone hints ───────────────────────────────────────────

  describe("drop zone hints", () => {
    it("shows accepted file types in hint text", () => {
      renderPicker([]);
      expect(
        screen.getByText(/JPG, PNG, WEBP, PDF/),
      ).toBeInTheDocument();
    });

    it("shows max file size in hint text", () => {
      renderPicker([]);
      expect(screen.getByText(/5\.0 MB each/)).toBeInTheDocument();
    });
  });
});
