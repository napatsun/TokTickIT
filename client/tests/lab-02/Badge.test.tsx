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
  // Graceful fallback for unknown values
  // -----------------------------------------------------------
  describe("unknown values", () => {
    it("renders unknown priority without crashing", () => {
      const { container } = render(
        <Badge variant="priority" value="URGENT" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("Urgent");
    });

    it("renders unknown status without crashing", () => {
      const { container } = render(
        <Badge variant="status" value="IN_PROGRESS" />,
      );
      const span = container.querySelector("span");
      expect(span).toHaveTextContent("In_progress");
    });
  });
});
