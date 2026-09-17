import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Badge from "../../src/components/shared/Badge";

describe("Badge", () => {
  // -----------------------------------------------------------
  // Priority badges
  // -----------------------------------------------------------
  describe("priority variant", () => {
    it("renders LOW with correct text and styling", () => {
      const { container } = render(
        <Badge variant="priority" value="LOW" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("Low");
      expect(span?.className).toMatch(/priorityLow/);
    });

    it("renders MEDIUM with correct text and styling", () => {
      const { container } = render(
        <Badge variant="priority" value="MEDIUM" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("Medium");
      expect(span?.className).toMatch(/priorityMedium/);
    });

    it("renders HIGH with correct text and styling", () => {
      const { container } = render(
        <Badge variant="priority" value="HIGH" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("High");
      expect(span?.className).toMatch(/priorityHigh/);
    });
  });

  // -----------------------------------------------------------
  // Status badges
  // -----------------------------------------------------------
  describe("status variant", () => {
    it("renders NEW with correct text and styling", () => {
      const { container } = render(
        <Badge variant="status" value="NEW" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("New");
      expect(span?.className).toMatch(/statusNew/);
    });
  });

  // -----------------------------------------------------------
  // Accessibility (§1): text label is always present, never color-only
  // -----------------------------------------------------------
  describe("accessibility", () => {
    it("has role=status for screen readers", () => {
      render(<Badge variant="priority" value="HIGH" />);
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("text content is always visible (not sr-only)", () => {
      render(<Badge variant="status" value="NEW" />);
      const badge = screen.getByRole("status");
      // text should be directly in the element, not hidden
      expect(badge).toHaveTextContent("New");
    });
  });

  // -----------------------------------------------------------
  // Lab 3 status/priority values (ui-spec.md §4/§6)
  // -----------------------------------------------------------
  describe("Lab 3 values", () => {
    it("renders every TicketStatus with a human-readable label", () => {
      const expected: Record<string, string> = {
        NEW: "New",
        OPEN: "Open",
        IN_PROGRESS: "In Progress",
        WAITING_FOR_REQUESTER: "Waiting for Requester",
        RESOLVED: "Resolved",
        CLOSED: "Closed",
        REOPENED: "Reopened",
        CANCELLED: "Cancelled",
      };

      for (const [value, label] of Object.entries(expected)) {
        const { container, unmount } = render(
          <Badge variant="status" value={value} />,
        );
        expect(container.querySelector("span"), value).toHaveTextContent(label);
        unmount();
      }
    });

    it("renders URGENT as an IT priority with the high-risk styling", () => {
      const { container } = render(<Badge variant="priority" value="URGENT" />);
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("Urgent");
      expect(span?.className).toMatch(/priorityUrgent/);
    });
  });

  // -----------------------------------------------------------
  // Graceful fallback for unknown values
  // -----------------------------------------------------------
  describe("unknown values", () => {
    it("renders unknown priority without crashing", () => {
      const { container } = render(
        <Badge variant="priority" value="SOMEDAY" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("Someday");
    });

    it("renders unknown status without crashing", () => {
      const { container } = render(
        <Badge variant="status" value="SOMEDAY_NEW_STATUS" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("Someday New Status");
    });
  });
});
