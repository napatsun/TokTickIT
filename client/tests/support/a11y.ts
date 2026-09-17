import { axe } from "jest-axe";
import { expect } from "vitest";

/**
 * jest-axe re-exports the runner but not axe-core's result/option types, so the
 * shapes are taken from the runner's own signature rather than copied by hand.
 */
type AxeResults = Awaited<ReturnType<typeof axe>>;
interface AxeRunOptions {
  rules?: Record<string, { enabled: boolean }>;
}

/**
 * Shared accessibility assertion for the Lab 3 component suites — UI-10
 * (tests.md §8, ui-spec.md §9).
 *
 * Deliberately a small helper module rather than a new test file: the five
 * existing suites (Login, ChangePassword, UserManagement, StaffTicketQueue,
 * StaffTicketDetail) plus AppShell call it at the end of a rendered state, so
 * the axe check runs against exactly the DOM the other assertions already
 * exercise — no duplicated rendering harness.
 *
 * Scope of the automated check vs. the manual pass:
 *   - axe in jsdom validates structure: roles, names, labels/`for` binding,
 *     `aria-describedby` targets, duplicate ids, heading order, live regions,
 *     focusability of interactive controls, and landmark coverage.
 *   - axe CANNOT evaluate `color-contrast` here (jsdom performs no layout and
 *     no painting, so the rule reports "incomplete" rather than a pass). Colour
 *     contrast is therefore verified numerically against the Zen Green tokens
 *     instead — see docs/lab-03/visual-checklist.md §Colour contrast, which
 *     records the computed WCAG ratios for every badge/banner pair.
 */

/**
 * Rules that cannot be evaluated for a screen rendered on its own.
 *
 * `region` requires every piece of content to sit inside a landmark, which is
 * the Application Shell's job (AppShell renders <header> + <nav> + <main>).
 * The five screen suites render a single page component without the shell, so
 * the rule is not meaningful there; AppShell.test.tsx runs the same check WITH
 * `region` enabled, which is where landmark coverage is actually asserted.
 */
const COMPONENT_RENDER_EXEMPT_RULES = ["region"];

function formatViolations(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `      ${node.target.join(" ")}\n        ${node.failureSummary ?? ""}`)
        .join("\n");
      return `  ${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n${nodes}`;
    })
    .join("\n");
}

/**
 * Assert that the rendered container has no axe violations.
 *
 * @param container  The element to scan — pass `document.body` (the default
 *                   from render()) so the check covers portals/overlays too.
 * @param label      Screen/state name, used in the failure message.
 * @param options    `disableRules` overrides the component-render default.
 */
export async function expectNoA11yViolations(
  container: Element,
  label: string,
  options: { disableRules?: string[] } = {},
): Promise<AxeResults> {
  const runOptions: AxeRunOptions = {
    rules: Object.fromEntries(
      (options.disableRules ?? COMPONENT_RENDER_EXEMPT_RULES).map((rule) => [rule, { enabled: false }]),
    ),
  };

  const results = await axe(container, runOptions);

  expect(
    results.violations.length,
    `${label} has ${results.violations.length} axe violation(s):\n${formatViolations(results)}`,
  ).toBe(0);

  return results;
}
