# TokTickIT — Lab 3 Visual Checklist (Part 9 submission evidence)

**Branch:** `feature/lab3-06-ui-polish-and-a11y`
**Scope:** every screen Sprint 3 ships — Login, Change Password, App Shell, Requester Ticket Detail, IT Staff Ticket Queue, IT Staff Ticket Detail, Administrator User Management — at **375px (mobile)**, **768px (tablet)** and **1280px+ (desktop)**.
**Spec references:** `ui-spec.md` §8 (Screen Modes and Feedback Matrix) and §9 (Responsive and Accessibility Requirements); `specification.md` §9; handout §8.7/§9.

This file is the artifact the spec asks for: a per-screen, per-width record of *design consistency, role navigation, badge correctness, editable-vs-read-only field styling, validation placement, focus visibility, clipping, overlap and horizontal overflow*, each pass/fail with a one-line note.

> **Notes apply to all three widths unless a width is named.** Nothing in this branch changed the visual direction; where a note says "fixed", the change is a token/consistency correction listed in §"Findings fixed in this branch".

---

## 1. Criteria and how each one is verified

| Code | Criterion | Verification method |
|---|---|---|
| **DC** | Design consistency (Zen Green tokens/components only, one skeleton style, one empty/no-results pattern) | Static audit of `client/src/**/*.module.css` — every colour/spacing value resolves to a token in `theme.scss` (see §4) |
| **RN** | Role navigation correctness (only permitted destinations, hamburger collapse below 768px) | `e2e/lab-03/responsive.spec.ts` RESP-05 + E2E-03 (all three roles) + `client/tests/lab-03/AppShell.test.tsx` |
| **BD** | Badge correctness (same colour for the same value everywhere; colour never the sole indicator; AA contrast) | Shared `Badge` component (single source of value→colour map) + the computed contrast table in §5 |
| **ER** | Editable-vs-read-only field styling | Shared `Field` component states (`default` vs `readonly`: warm ivory bg, muted text, not tabbable) + `RequesterTicketDetail.test.tsx` UI-12 and `StaffTicketDetail.test.tsx` read-only assertions |
| **VP** | Validation placement (message directly below its field, `aria-describedby`, `role="alert"`) | `Field` component + axe scans (§3) + describe-by assertions in the Login / ChangePassword / RequesterTicketDetail / StaffTicketDetail suites |
| **FV** | Focus visibility (Zen Green focus token on every focusable element) | CSS audit (§6) + RESP-04 asserts the computed focus ring of the focused Login field is `rgb(11, 122, 70)` in a real browser |
| **CL** | Clipping (nothing rendered outside the viewport) | `expectNoClipping()` in RESP-01…RESP-05 — element-level viewport-bounds assertion |
| **OV** | Overlap (no overlapping content) | `expectNoTextOverlap()` in RESP-01…RESP-05 — pairwise text-leaf intersection check |
| **HO** | Horizontal overflow (`scrollWidth <= clientWidth`) | `expectNoHorizontalOverflow()` in RESP-01…RESP-05, at all three widths |

Screenshot evidence (full-page, captured by the passing `RESP-04`/`RESP-05` runs and re-captured for the three pre-existing folders):

```
artifacts/lab-03/screenshots/authentication/          login-{375,768,1280}.png
                                                      login-failure-{375,768,1280}.png
                                                      change-password-{375,768,1280}.png
artifacts/lab-03/screenshots/app-shell/               app-shell-{375,768,1280}.png
artifacts/lab-03/screenshots/requester-ticket-detail/ requester-ticket-detail-{375,768,1280}.png
                                                      requester-resolve-mark-{375,768,1280}.png
artifacts/lab-03/screenshots/staff-queue/             queue-{375,768,1280}.png
artifacts/lab-03/screenshots/staff-ticket-detail/     staff-ticket-detail-{375,768,1280}.png
artifacts/lab-03/screenshots/user-management/         user-management-{375,768,1280}.png
                                                      create-user-modal-{375,768,1280}.png
```

---

## 2. Per-screen checklist

### 2.1 Login — `artifacts/lab-03/screenshots/authentication/login-*.png`, `login-failure-*.png`

| Width | DC | RN | BD | ER | VP | FV | CL | OV | HO |
|---|---|---|---|---|---|---|---|---|---|
| 375px | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768px | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1280px | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **DC** — Pass: card, tokens, and spacing are the shared Zen Green set; the only screen-specific class is the card wrapper. No badge family applies (**n/a**), which the spec's Login §2 does not define.
- **RN** — Pass: unauthenticated, so no navigation renders at all (asserted with a nav-count-0 check at each width); the `<main>` landmark was added so the page has correct landmark structure.
- **ER** — Pass: both fields are `default` (editable) `Field` instances; the busy state disables them without restyling them as read-only.
- **VP** — Pass: inline errors render directly below their own field, carry `role="alert"`, and are linked with `aria-describedby` (asserted).
- **FV** — Pass: the focused email input reports the Zen Green focus ring in a real browser (`box-shadow … rgb(11, 122, 70)`).
- **CL/OV/HO** — Pass: element-level clipping, text-overlap and document-overflow assertions all green in the idle **and** failure states.

### 2.2 Change Password — `artifacts/lab-03/screenshots/authentication/change-password-*.png`

| Width | DC | RN | BD | ER | VP | FV | CL | OV | HO |
|---|---|---|---|---|---|---|---|---|---|
| 375px | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768px | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1280px | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **DC** — Pass: same card/token treatment as Login; the primary action is full-width on mobile, matching Login.
- **RN** — Pass: the BR-02 gate renders outside the App Shell, so no role navigation is offered — asserted as nav-count 0 at all three widths.
- **ER** — Pass: both password fields are editable; nothing is styled read-only.
- **VP** — Pass: the always-visible complexity hint and the inline error are **both** announced with the field (`aria-describedby` = hint + error), and the error carries `role="alert"`.
- **FV / CL / OV / HO** — Pass: same automated assertions as Login; the 375px card keeps its padding and full-width action without overflowing.

### 2.3 App Shell / Navigation — `artifacts/lab-03/screenshots/app-shell/app-shell-*.png`

| Width | DC | RN | BD | ER | VP | FV | CL | OV | HO |
|---|---|---|---|---|---|---|---|---|---|
| 375px | ✅ | ✅ | ✅ | n/a | n/a | ✅ | ✅ | ✅ | ✅ |
| 768px | ✅ | ✅ | ✅ | n/a | n/a | ✅ | ✅ | ✅ | ✅ |
| 1280px | ✅ | ✅ | ✅ | n/a | n/a | ✅ | ✅ | ✅ | ✅ |

- **DC** — Pass: header, nav, identity, and role badge reuse only existing tokens; no Lab 2 selector remnants (MIG-02 verified).
- **RN** — Pass: **375px** — hamburger visible, desktop nav and mobile menu hidden until opened, and the opened menu exposes only the Requester's own destinations; **768px and 1280px** — hamburger hidden, full nav visible with the same role-scoped set (verified for Requester here and for all three roles by E2E-03).
- **BD** — Pass: the role badge pairs a text label with colour; it is the one badge that is deliberately restyled for the dark header surface (translucent white, 4.81:1) rather than using the shared badge palette used on light surfaces — text is always present, so colour is not the sole indicator.
- **ER / VP** — n/a: the shell renders no fields and no form validation.
- **FV** — Pass: nav links, the hamburger and both logout buttons gained an explicit `:focus-visible` ring using the pale-green Zen Green token (secondary-green is invisible against the header's primary green — the same choice the shipped Logout button already used).
- **CL/OV/HO** — Pass: asserted at each width with the menu **closed**, and additionally with the menu **open** for overflow/clipping so the dropdown itself is covered.

### 2.4 Requester Ticket Detail (Public Comments + Resolve-Mark) — `artifacts/lab-03/screenshots/requester-ticket-detail/*.png`

| Width | DC | RN | BD | ER | VP | FV | CL | OV | HO |
|---|---|---|---|---|---|---|---|---|---|
| 375px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1280px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **DC** — Pass: **fixed** — the header/summary cards, dividers and attachment list used hardcoded `#dde7e1`, `8px` and raw px values; they now use `--color-field-editable-border`, `--field-border-radius` and the `--space-*` scale, and the loading skeleton uses the same disabled-bg + opacity pulse as the other Lab 3 screens (previously a one-off pale-green shimmer).
- **RN** — Pass: Requester nav only (My Tickets / Create Ticket) at every width; the Resolved-status ticket and the OPEN ticket both render inside the shell.
- **BD** — Pass: Requested Priority / IT Priority / Current Status badges come from the shared `Badge`; the "appears resolved" marker is a deliberately different element (dashed outline) so it can never read as a formal status change (BR-05/BR-20) — asserted at each width.
- **ER** — Pass: header fields render in the `readonly` state (ivory bg, muted text, not tabbable, no focus ring by design); the public-comment composer is the only editable control.
- **VP** — Pass: the post form's failure banner is `role="alert"` and is linked to the textarea together with the live counter (`aria-describedby`), with `aria-invalid` set on failure (asserted). The page-level safe-failure banner is also `role="alert"` with a Retry action (**fixed** — it was the only failure banner in the app that did not announce itself).
- **FV** — Pass: buttons, the composer textarea and the confirm dialogs all use the Zen Green focus token.
- **CL/OV/HO** — Pass at 375/768/1280: asserted on both the marked ticket and the eligible/unmarked ticket with a populated Public Comments panel.

### 2.5 IT Staff Ticket Queue — `artifacts/lab-03/screenshots/staff-queue/queue-*.png`

| Width | DC | RN | BD | ER | VP | FV | CL | OV | HO |
|---|---|---|---|---|---|---|---|---|---|
| 375px | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768px | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1280px | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ |

- **DC** — Pass: tokens only; skeleton rows, empty state and error/retry banner share the pattern used by User Management.
- **RN** — Pass: IT Staff / Administrator only; the Requester never sees "Ticket Queue" (asserted in E2E-03 and RESP-05).
- **BD** — Pass: both priority columns and the status column render shared `Badge` instances — same colours as Ticket Detail and the user list.
- **ER** — n/a: no editable fields on this screen (filters/sort are controls, not fields).
- **VP** — Pass: invalid search/filter input yields server-side 400 handling and the search box has no field-level validation by design; the failure banner is `role="alert"` with a Retry action.
- **FV** — Pass: the Filters toggle, selects and sortable headers all define the Zen Green focus ring.
- **CL/OV/HO** — Pass: **375/768px** render the stacked card list (table removed from layout), **1280px** the full nine-column table; no overflow, clipping or overlap at any width.

### 2.6 IT Staff Ticket Detail (Internal Notes) — `artifacts/lab-03/screenshots/staff-ticket-detail/*.png`

| Width | DC | RN | BD | ER | VP | FV | CL | OV | HO |
|---|---|---|---|---|---|---|---|---|---|
| 375px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1280px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **DC** — Pass: Public Comments and Internal Notes are one component with two variants; the Internal Notes amber tint is unchanged in hue but its accent now uses the AA-safe amber token.
- **RN** — Pass: IT Staff / Administrator only; the detail route is reached from the Queue and navigation stays role-scoped.
- **BD** — Pass: the status/priority badges match the Queue; the author role badge inside comments/notes now uses the shared `Badge` (**fixed** — it previously rendered every role in the same pale green, so an Administrator's comment looked like a Requester's).
- **ER** — Pass: header fields are read-only; Owner, IT Priority and Change Status are the editable controls and are visually distinct (white/dropdown vs ivory readonly).
- **VP** — Pass: each editable control keeps its own inline failure region, now marked `role="alert"` **and** linked to its own select via `aria-describedby` + `aria-invalid` (asserted). The 409/422 messages shown are the server's safe envelope message, never a stack trace.
- **FV** — Pass: the three selects and the Claim/Reassign/Change Status buttons use the Zen Green focus token; the confirmation dialog traps focus and returns it.
- **CL/OV/HO** — Pass at all three widths, with both comment panels populated (Internal Notes panel included).

### 2.7 Administrator User Management — `artifacts/lab-03/screenshots/user-management/*.png` (+ `create-user-modal-*.png`)

| Width | DC | RN | BD | ER | VP | FV | CL | OV | HO |
|---|---|---|---|---|---|---|---|---|---|
| 375px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1280px | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **DC** — Pass: tokens only; skeleton, empty and no-results states share one pattern; the toast is width-capped so a long name cannot overflow at 375px.
- **RN** — Pass: Administrator only; non-Administrators are redirected by `RequireRole` and rejected server-side (SEC-01/02/09).
- **BD** — Pass: Role badges (neutral / pale green / solid green) and Active/Inactive badges come from the shared `Badge`; the same values read identically in the list, the cards and the App Shell.
- **ER** — Pass: the list is read-only; editable Name/Email/Role/Active live only in the modal, and guard-disabled controls render in the `disabled` state with a text explanation attached via `aria-describedby`.
- **VP** — Pass: field errors render below their own field with `role="alert"`; duplicate email is inline under Email; the create/edit failure banner keeps the entered values; the Initial Password helper text is now announced with the field.
- **FV** — Pass: the create/edit dialog traps focus on open, restores it to the trigger on close, closes on Escape, and only the top-most dialog answers the keyboard when the reset confirmation is stacked on top (all automated).
- **CL/OV/HO** — Pass: **375px** stacked cards, **768/1280px** five-column table; the Create modal fits inside every viewport (explicit bounding-box assertion) and the list itself is overlap-free.

---

## 3. Automated accessibility scans (UI-10)

`jest-axe` 10.0.0 is now a client dev dependency, wired through one small shared helper (`client/tests/support/a11y.ts`) used by the existing suites — no new test files and no changed expectations. **25 scans, 0 violations.**

| Suite | States scanned with axe |
|---|---|
| `client/tests/lab-03/Login.test.tsx` | idle · validating (inline errors) · generic failure banner |
| `client/tests/lab-03/ChangePassword.test.tsx` | idle · validating · safe failure banner |
| `client/tests/lab-03/AppShell.test.tsx` | loaded shell (with the `region` landmark rule **enabled**) |
| `client/tests/lab-03/StaffTicketQueue.test.tsx` | populated · no-results · failure |
| `client/tests/lab-03/StaffTicketDetail.test.tsx` | populated (both panels) · requester signal banner · status confirmation open · not-found · failure |
| `client/tests/lab-03/UserManagement.test.tsx` | populated · create modal · edit modal with guard notes · reset-password confirmation · failure |
| `client/tests/lab-02/RequesterTicketDetail.test.tsx` | populated · resolve-mark confirmation · resolved marker · remove-attachment dialog · page-level safe failure |

`color-contrast` is the one rule axe cannot evaluate in jsdom (no layout/paint), so it is verified numerically instead — §5.

One real violation was found and fixed by this pass: **`heading-order`** — dialog titles rendered as `<h3>` under a page `<h1>`, a skipped level. Dialog titles are now `<h2>` and the Edit modal's password sub-section is `<h3>`.

---

## 4. Token consistency audit (Zen Green)

No new colours, spacing values, or component patterns were introduced. Two exceptions, both deliberate and both contrast/consistency corrections rather than new visual language:

1. **`--color-warning-text: #8A6508`** added to `theme.scss` — the existing amber darkened so amber *text* meets WCAG AA (see §5). Same hue family, no new palette direction.
2. **`--color-field-readonly-border: #C7D3CC`** declared — the value `Field.module.css` was already falling back to inline; declaring the token removes a phantom token reference. Same value.

Everything else was replaced with existing tokens:

| Drift found | Resolved by |
|---|---|
| `#dde7e1` hardcoded borders/dividers on the Requester Ticket Detail + attachment list | `--color-field-editable-border` |
| One-off pale-green **shimmer** skeleton on the Requester Ticket Detail | shared disabled-bg + opacity pulse skeleton |
| Bespoke overlays/dialogs in `ResolveMarkConfirm`, `StatusChangeConfirm`, `RemoveAttachmentConfirm` | all three now render through the shared `Dialog` / `ConfirmDialog` (overlay, surface, radius, width cap, scroll, keyboard contract) |
| Bespoke author "role badge" inside comments/notes (one colour for every role) | shared `Badge variant="role"` |
| Leftover `window.__si` debug instrumentation in `SearchInput` | removed |
| 14px/12px/13px hardcoded font sizes and `16px/24px/28px` spacing in the Requester Ticket Detail CSS | `--font-size-*` / `--space-*` tokens |

**Known, deliberately untouched drift (out of this branch's screen scope):** the Lab 2 **My Tickets** list and **Create Ticket** screens still use the older `#dde7e1` border (and `CreateTicketPage` has one raw `#FFFFFF !important`). They are not among the seven Lab 3 screens this branch polishes, so they were left alone rather than silently restyled — flagged here for review.

---

## 5. Colour contrast (WCAG AA)

Method: relative-luminance contrast ratio computed from the exact token values in `theme.scss` (WCAG 2.x formula, sRGB). Badge labels are 12px/600 and body copy is 13–14px, so the **4.5:1** text threshold applies (not the 3:1 large-text allowance). Non-text accents (panel borders, icons) use the **3:1** threshold.

| Pair | Foreground | Background | Ratio | AA |
|---|---|---|---|---|
| Priority Low / Role Requester badge | `#3d4f46` | `#e8edea` | 7.37:1 | **Pass** |
| Priority Medium badge | `#8A6508` | `#FFF6E0` | 4.94:1 | **Pass** |
| Priority High / Urgent badge | `#9a1f1a` | `#fde8e7` | 6.91:1 | **Pass** |
| Status New / Open badge | `#0B7A46` | `#EAF6EF` | 4.87:1 | **Pass** |
| Status In Progress / Waiting / Reopened badge | `#8A6508` | `#FFF6E0` | 4.94:1 | **Pass** |
| Status Resolved / Closed badge | `#0B7A46` | `#EAF6EF` | 4.87:1 | **Pass** |
| Status Cancelled badge *(fixed)* | `#5B6B62` | `#E9ECEA` | 4.74:1 | **Pass** |
| Account Inactive badge | `#5B6B62` | `#E9ECEA` | 4.74:1 | **Pass** |
| Role IT Staff badge | `#0B7A46` | `#EAF6EF` | 4.87:1 | **Pass** |
| Role Administrator badge | `#FFFFFF` | `#0B7A46` | 5.40:1 | **Pass** |
| Error banner / destructive text | `#B3261E` | `#FBEAE9` | 5.62:1 | **Pass** |
| Success toast text | `#0B7A46` | `#EAF6EF` | 4.87:1 | **Pass** |
| Admin guard note (amber on dialog surface) *(fixed)* | `#8A6508` | `#FFFFFF` | 5.32:1 | **Pass** |
| Internal Notes body text | `#1E2B24` | `#FFF6E0` | 13.68:1 | **Pass** |
| Internal Notes hint text | `#5B6B62` | `#FFF6E0` | 5.24:1 | **Pass** |
| Internal Notes accent border + lock icon *(fixed)* | `#8A6508` | `#FFF6E0` | 4.94:1 | **Pass** (≥3:1) |
| Requester signal banner border *(fixed)* | `#8A6508` | `#FFF6E0` | 4.94:1 | **Pass** (≥3:1) |
| App Shell nav link, inactive *(fixed)* | `#d9e9e2` | `#006B3C` | 5.27:1 | **Pass** |
| App Shell wordmark / active nav / logout | `#FFFFFF` | `#006B3C` | 6.63:1 | **Pass** |
| App Shell role badge | `#FFFFFF` | `#268159` | 4.81:1 | **Pass** |
| Body text on surface | `#1E2B24` | `#FFFFFF` | 14.72:1 | **Pass** |
| Muted text on surface | `#5B6B62` | `#FFFFFF` | 5.64:1 | **Pass** |
| Muted text on page background | `#5B6B62` | `#F5FAF7` | 5.34:1 | **Pass** |

Failing pairs found and corrected (all were AA failures before this branch):

| Pair | Before | After |
|---|---|---|
| Status **Cancelled** badge | `#9AA5A0` on `#E9ECEA` = **2.14:1** | muted text token → 4.74:1 |
| Priority **Medium** / Status **In Progress, Waiting, Reopened** badges | `#B8860B` on `#FFF6E0` = **3.02:1** | `--color-warning-text` → 4.94:1 |
| Admin guard note (amber on white) | `#B8860B` on `#FFFFFF` = **3.25:1** | `--color-warning-text` → 5.32:1 |
| App Shell inactive nav link | `rgba(255,255,255,.75)` = **4.46:1** | `.85` → 5.27:1 |
| Create Ticket attachment-failure banner (Lab 2 screen, one-line fix) | `#B8860B` on `#FFF6E0` = **3.02:1** | `--color-warning-text` → 4.94:1 |

Disabled controls (`--color-disabled-bg` / `--color-disabled-text`, 2.14:1) are intentionally left as-is: WCAG 1.4.3 exempts inactive components, and the one place that token had been borrowed for a real status label (Cancelled) is fixed above.

---

## 6. Focus visibility audit

| Surface | Rule | Status |
|---|---|---|
| `Button` (all six variants) | `.button:focus-visible` → `box-shadow: 0 0 0 2px var(--focus-ring-color)` | ✅ (pre-existing) |
| `Field` input / textarea / select | `.defaultControl:focus` etc. → 2px ring | ✅ (pre-existing) |
| `Dialog` container (fallback when it holds no focusable control) | `.dialog:focus-visible` → token outline | ✅ added |
| App Shell desktop nav link | `.navLink:focus-visible` → pale-green token outline | ✅ added |
| App Shell mobile nav link | `.mobileNavLink:focus-visible` | ✅ added |
| App Shell hamburger button | `.hamburgerButton:focus-visible` | ✅ added |
| App Shell mobile Logout | `.mobileLogoutButton:focus-visible` | ✅ added |
| App Shell desktop Logout | pre-existing pale-green outline | ✅ (pre-existing) |
| Queue Filters toggle, filter selects, sortable headers | pre-existing token outline | ✅ (pre-existing) |
| Staff Ticket Detail selects | pre-existing token outline | ✅ (pre-existing) |
| Admin role filter select | pre-existing token outline | ✅ (pre-existing) |
| Admin Active checkbox | `.toggle input:focus-visible` → token outline | ✅ added |
| Content thread composer textarea | pre-existing token outline | ✅ (pre-existing) |
| Search input | pre-existing token box-shadow | ✅ (pre-existing) |

The one place the secondary-green ring is not used is the App Shell's primary-green header, where it would be invisible (≈1.1:1); those controls use the pale-green Zen Green token instead — the same choice the already-shipped Logout button made. RESP-04 asserts the token colour in a real browser for the Login field, and every dialog now moves focus in on open, traps Tab, closes on Escape and returns focus to its trigger (`UserManagement.test.tsx`, UI-10 keyboard contract).

---

## 7. Findings fixed in this branch (summary)

| # | Finding | Kind | Resolution |
|---|---|---|---|
| 1 | `SearchInput` shipped leftover `window.__si` debug instrumentation | defect | removed |
| 2 | `ResolveMarkConfirm`, `StatusChangeConfirm`, `RemoveAttachmentConfirm` used bespoke dialog markup | inconsistency | migrated to shared `Dialog` / `ConfirmDialog` |
| 3 | Author role badges in comments/notes used one colour for every role | inconsistency (badge drift) | shared `Badge variant="role"` |
| 4 | Requester Ticket Detail used hardcoded colours/px and a one-off shimmer skeleton | inconsistency | tokens + shared skeleton pattern |
| 5 | Status **Cancelled** badge at 2.14:1 | §9 violation | muted text token (4.74:1) |
| 6 | Amber badge/note text at 3.02:1–3.25:1 | §9 violation | `--color-warning-text` (4.94:1 / 5.32:1) |
| 7 | App Shell inactive nav link at 4.46:1 | §9 violation | 0.85 white (5.27:1) |
| 8 | Sortable Queue columns omitted `aria-sort` when unsorted | §9 gap | `aria-sort="none"` |
| 9 | Dialog titles were `<h3>` under a page `<h1>` (axe `heading-order`) | §9 violation | dialog title `h2`, sub-section `h3` |
| 10 | No modal focus trap / initial focus / focus return | §9 gap | implemented in the shared `Dialog` |
| 11 | Comment/note composer not `aria-describedby`-linked to its error/counter | §9 gap | wired with `aria-invalid` |
| 12 | Staff Ticket Detail inline action errors not linked to their control | §9 gap | `aria-describedby` + `aria-invalid` |
| 13 | Change Password hint and admin helper text not announced with their field | §9 gap | `Field` gains an optional `describedBy` |
| 14 | Login / Change Password had no `<main>` landmark | §9 gap | wrapped in `<main>` |
| 15 | Hamburger, nav links and admin checkbox had no explicit focus style | §9 gap | Zen Green focus token added |
| 16 | Requester Ticket Detail's page-level failure banner was the only one missing `role="alert"` | §8/§9 inconsistency | `role="alert"` + `data-testid` added; asserted |

---

## 8. Recorded run (this branch)

| Command | Result |
|---|---|
| `cd client && npx tsc --noEmit` | clean |
| `cd client && npx vitest run` | **16 files passed · 325 tests passed** (was 291; +34 assertions incl. 25 axe scans and the dialog keyboard contract) |
| `cd server && npx tsc --noEmit` | clean |
| `cd server && npx vitest run` | **20 files passed · 480 tests passed** |
| `npx playwright test` (repo root) | **25 passed** — E2E-01…E2E-06 plus RESP-01…RESP-05 at 375/768/1280px |
| Screenshots | re-captured for all seven screens in `artifacts/lab-03/screenshots/` |

`docs/lab-03/tests.md` rows RESP-04, RESP-05 and UI-10 record these results; every other row remains green.
