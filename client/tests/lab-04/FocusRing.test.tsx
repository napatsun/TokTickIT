import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * UI-16 — shared `Field` focus ring (ui-spec.md §8, AC-13; tests.md §5)
 *
 * The evidence run measured no visible focus indicator on `/login`. Two root
 * causes live in `Field.module.css`, both pinned here at CSS-source level:
 *
 *   1. Coverage — the ring rule listed `.inputControl:focus`, a class `Field`
 *      never applies to `<input>` elements, and omitted `.invalidControl:focus`
 *      / `.selectControl:focus`, so inputs and selects in the `invalid` state
 *      had no ring at all (every screen's error state: login, change password,
 *      Create Ticket, admin dialogs).
 *   2. Timing — `.control` transitioned `border-color`/`box-shadow` over 150ms,
 *      so a read taken immediately after focus saw the transition's start
 *      value: a fully transparent 0px shadow and an unmoved border. This is
 *      exactly the trap `e2e/lab-03/responsive.spec.ts` (RESP-04) documents.
 *
 * jsdom performs no layout and applies no `:focus` cascade, so — like UI-15 in
 * `tests/lab-03/ChangePassword.test.tsx` — these assertions read the authored
 * stylesheet instead of pixels. The rendered ring colour in a real browser
 * stays covered by RESP-04.
 */

function fieldStylesheet(): string {
  return fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "src",
      "components",
      "shared",
      "Field.module.css",
    ),
    "utf8",
  );
}

/** Every `selector { body }` block (Field.module.css has no @keyframes/@media). */
function cssRules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2].trim(),
  }));
}

describe("UI-16 — shared Field focus ring covers every editable state (ui-spec §8, AC-13)", () => {
  it("declares the 2px token ring on :focus for default, invalid, select and textarea controls", () => {
    const ringSelector = cssRules(fieldStylesheet())
      .filter(
        (rule) =>
          /:focus/.test(rule.selector) &&
          /box-shadow:\s*0 0 0 2px var\(--focus-ring-color/.test(rule.body),
      )
      .map((rule) => rule.selector)
      .join("\n");

    for (const expected of [
      ".defaultControl:focus",
      ".invalidControl:focus",
      ".selectControl:focus",
      ".textareaControl:focus",
    ]) {
      expect(
        ringSelector,
        `${expected} must be part of the focus-ring rule so every control state gets the ring`,
      ).toContain(expected);
    }
  });

  it("never removes outline without a replacement, except the documented readonly/disabled states", () => {
    const bare = cssRules(fieldStylesheet()).filter(
      (rule) =>
        /outline:\s*none/.test(rule.body) &&
        !/box-shadow/.test(rule.body) &&
        !/readonlyControl|disabledControl/.test(rule.selector),
    );

    expect(
      bare.map((rule) => rule.selector),
      "outline:none requires a replacement ring (Lab 2/3 ui-spec §3)",
    ).toEqual([]);
  });

  it("applies the ring with no transition window (an instant read after focus sees the full ring)", () => {
    const controlRules = cssRules(fieldStylesheet()).filter((rule) =>
      /(^|[,\s])\.control(?![A-Za-z0-9_-])/.test(rule.selector),
    );
    expect(controlRules.length, ".control must be authored").toBeGreaterThan(0);

    for (const rule of controlRules) {
      expect(
        rule.body,
        "the shared control must not fade border/box-shadow — the 150ms start value is a transparent 0px shadow (RESP-04)",
      ).not.toMatch(/transition:[^;]*(box-shadow|border-color)/);
    }
  });
});
