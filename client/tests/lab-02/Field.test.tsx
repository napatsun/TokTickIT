import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Field from "../../src/components/shared/Field";

describe("Field", () => {
  // -----------------------------------------------------------
  // 1. State rendering — correct CSS class per state
  // -----------------------------------------------------------
  describe("states", () => {
    it("renders default state with editable styling", () => {
      const { container } = render(
        <Field label="Summary" state="default" />,
      );
      const field = container.querySelector("[class*='field']");
      expect(field?.className).toMatch(/default/);
    });

    it("renders focused state with focused styling", () => {
      const { container } = render(
        <Field label="Summary" state="focused" />,
      );
      const field = container.querySelector("[class*='field']");
      expect(field?.className).toMatch(/focused/);
    });

    it("renders invalid state with error border", () => {
      const { container } = render(
        <Field
          label="Summary"
          state="invalid"
          errorMessage="Summary is required"
        />,
      );
      const field = container.querySelector("[class*='field']");
      expect(field?.className).toMatch(/invalid/);
    });

    it("renders readonly state — not tabbable", () => {
      const { container } = render(
        <Field label="Ticket Number" state="readonly" value="TKT-2026-000001" />,
      );
      const input = container.querySelector("input");
      expect(input).toHaveAttribute("tabindex", "-1");
      expect(input).toHaveAttribute("readonly");
    });

    it("renders disabled state with aria-disabled", () => {
      const { container } = render(
        <Field label="Summary" state="disabled" />,
      );
      const input = container.querySelector("input");
      expect(input).toHaveAttribute("aria-disabled", "true");
      expect(input).toBeDisabled();
    });
  });

  // -----------------------------------------------------------
  // 2. Required asterisk
  // -----------------------------------------------------------
  describe("required asterisk", () => {
    it("shows asterisk when required=true", () => {
      const { container } = render(
        <Field label="Summary" required />,
      );
      const asterisk = container.querySelector("[class*='required']");
      expect(asterisk).toBeInTheDocument();
      expect(asterisk).toHaveTextContent("*");
      expect(asterisk).toHaveAttribute("aria-hidden", "true");
    });

    it("does not show asterisk when required=false", () => {
      const { container } = render(
        <Field label="Summary" />,
      );
      const asterisk = container.querySelector("[class*='required']");
      expect(asterisk).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------
  // 3. Validation message — §3: always below the field
  // -----------------------------------------------------------
  describe("validation message", () => {
    it("renders error message below the field when invalid", () => {
      render(
        <Field
          label="Summary"
          state="invalid"
          errorMessage="Between 5–120 characters"
        />,
      );
      const msg = screen.getByRole("alert");
      expect(msg).toHaveTextContent("Between 5–120 characters");
      // §3: message is always present, not just a form-level summary
      expect(msg).toBeInTheDocument();
    });

    it("links error message via aria-describedby", () => {
      const { container } = render(
        <Field
          label="Summary"
          state="invalid"
          errorMessage="Required"
          id="summary"
        />,
      );
      const input = container.querySelector("input");
      expect(input).toHaveAttribute("aria-describedby", "summary-error");
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("does not render error message when state is default", () => {
      const { container } = render(
        <Field label="Summary" state="default" />,
      );
      const msg = container.querySelector("[role='alert']");
      expect(msg).not.toBeInTheDocument();
    });

    it("errorMessage alone (without state=invalid) triggers invalid styling and message", () => {
      const { container } = render(
        <Field label="Summary" errorMessage="Required" />,
      );
      // Field wrapper should have invalid class
      const field = container.querySelector("[class*='field']");
      expect(field?.className).toMatch(/invalid/);
      // Input should have invalid control class and aria-invalid
      const input = container.querySelector("input");
      expect(input).toHaveAttribute("aria-invalid", "true");
      // Error message should be rendered
      const msg = container.querySelector("[role='alert']");
      expect(msg).toHaveTextContent("Required");
    });
  });

  // -----------------------------------------------------------
  // 4. Input vs textarea
  // -----------------------------------------------------------
  describe("input vs textarea", () => {
    it("renders <input> by default", () => {
      const { container } = render(
        <Field label="Summary" />,
      );
      expect(container.querySelector("input")).toBeInTheDocument();
      expect(container.querySelector("textarea")).not.toBeInTheDocument();
    });

    it("renders <textarea> when type='textarea'", () => {
      const { container } = render(
        <Field label="Description" type="textarea" />,
      );
      expect(container.querySelector("textarea")).toBeInTheDocument();
      expect(container.querySelector("input")).not.toBeInTheDocument();
    });

    it("textarea has vertical resize only", () => {
      const { container } = render(
        <Field label="Description" type="textarea" />,
      );
      const textarea = container.querySelector("textarea");
      expect(textarea?.style.resize).toBe("vertical");
    });
  });

  // -----------------------------------------------------------
  // 5. Character counter
  // -----------------------------------------------------------
  describe("character counter", () => {
    it("shows counter when maxLength is set", () => {
      const { container } = render(
        <Field label="Summary" maxLength={120} value="Hello" onChange={vi.fn()} />,
      );
      const counter = container.querySelector("[class*='counter']");
      expect(counter).toHaveTextContent("5/120");
    });

    it("shows 0/maxLength when value is empty", () => {
      const { container } = render(
        <Field label="Summary" maxLength={120} value="" onChange={vi.fn()} />,
      );
      const counter = container.querySelector("[class*='counter']");
      expect(counter).toHaveTextContent("0/120");
    });

    it("does not show counter when maxLength is not set", () => {
      const { container } = render(
        <Field label="Summary" />,
      );
      const counter = container.querySelector("[class*='counter']");
      expect(counter).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------
  // 6. Label — §10: always above control, weight 600
  // -----------------------------------------------------------
  describe("label", () => {
    it("renders label with correct htmlFor", () => {
      render(<Field label="Summary" id="summary" />);
      const label = screen.getByText("Summary");
      expect(label.tagName).toBe("LABEL");
      expect(label).toHaveAttribute("for", "summary");
    });

    it("label has CSS class for 600 font weight", () => {
      const { container } = render(<Field label="Summary" />);
      const label = container.querySelector("label");
      // jsdom does not compute CSS; verify the CSS module class is applied
      // which sets font-weight: 600 per Field.module.css §10
      expect(label?.className).toMatch(/label/);
    });
  });

  // -----------------------------------------------------------
  // 7. Select with numeric value (PR reviewer concern #2)
  // -----------------------------------------------------------
  describe("select with numeric value", () => {
    it("does not produce React warnings when value is a number", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      render(
        <Field type="select" label="Priority" value={123} onChange={vi.fn()}>
          <option value="123">Medium</option>
          <option value="456">High</option>
        </Field>,
      );

      const select = document.querySelector("select");
      expect(select).toBeInTheDocument();

      // Check that no React warning about value type was emitted
      // React may warn: "Expected the `value` prop on `select` to be a `string`"
      // or similar type-related warnings
      const allCalls = [
        ...errorSpy.mock.calls,
        ...warnSpy.mock.calls,
      ];
      const typeWarnings = allCalls.filter(
        (call) =>
          call.some(
            (arg) =>
              typeof arg === "string" &&
              (arg.includes("Expected the `value` prop on `select` to be a `string`") ||
                arg.includes("value prop on a select") ||
                arg.includes("not a string") ||
                arg.includes("not a number")),
          ),
      );

      // Regression test: even if React doesn't warn today, this test will
      // catch it if a future React version adds the warning. For now we
      // assert zero type-related warnings and document the intent.
      expect(typeWarnings).toHaveLength(0);

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("renders the select with the correct option selected when value is a number", () => {
      const { container } = render(
        <Field type="select" label="Priority" value={123}>
          <option value="123">Medium</option>
          <option value="456">High</option>
        </Field>,
      );

      const select = container.querySelector("select") as HTMLSelectElement;
      expect(select.value).toBe("123");
    });
  });
});
