# Annotation UI v2: build and test results (21 Oct 2026)

Build of the approved design (DESIGN.md → *Annotation UI v2*) into `content.js`, `content.css`, `design-tokens.css`, `settings.html`.
Browser: Chrome 156.0.8078.47 (headless, real extension).

| Suite | Result |
|-------|--------|
| selector-fingerprint, content-helpers, mcp-structure (unit) | pass |
| browser-selector | pass |
| browser-smoke | 26/26 |
| browser-a11y | 24/24 |
| browser-env | 18/18 |
| browser-privacy | 13/13 |
| browser-bridge | pass |
| browser-annotation-ui (new) | 21/21 |

## Test changes (and why)

- **browser-smoke C14c** reads the row Copy button's tooltip from `data-tip` ("Copy this note as Markdown") instead of `title`: tooltips moved to the shared `data-tip` system.
- **browser-a11y K6** accepts `.dn-act` as the Edit button when focus returns (the button class changed from `dn-icon-btn`).
- **browser-bridge B25/B26** now send from the note's own Send button and its agent menu. The create form no longer has a "Send to" row (by design: category only).
- **browser-annotation-ui** is new and covers the composer, connector, category add/rename, sidebar filters and actions, screenshot viewer, tooltips, table actions and the four surfaces.

## Bugs found while building (fixed)

- The connector `<svg>` was hidden with `.hidden = true`, which only sets a JS field on SVG elements; it stayed on screen after Esc. Now uses the `hidden` attribute and a detached guard.
- Save as a real `disabled` button broke keyboard-only saving and the tests that fill the field by script; it is `aria-disabled` and the click reads the live text.
- The note field lost its focus indicator when its border went transparent (a11y F1); it now gets a faint field and an accent hairline.
- Icon buttons were 32px, not 28px, because of padding; the action row wrapped at six buttons.

## Not covered by automation

- Glass and Liquid are visual options; their contrast is only guaranteed for Frosted and Solid (a11y suite). Liquid is least legible on pure white or pure black pages.
- Several AI agents connected at once for the Send menu (the bridge suite exercises two).
- Dragging the form after it is placed, very small windows (<320px) with the connector.

## Follow-up (same day): agents back in the callout, arrow-only category menu

- The create form shows every active AI agent as an icon-only toggle at the right end of the caption line, on the same row as the selector (`#dn-form-agents` inside `.dn-form-cap`; first placed on its own row under Save, moved on request); the picked one becomes the note's `assignee` on save. The sidebar/table Send button stays.
- The category chip is split: the name is plain text (double-click renames) and only the arrow `#dn-cat-toggle` opens the menu, which is always closed when the form opens.
- Tests changed to match: **a11y F1** opens the menu with the arrow before checking the pills' focus ring and also checks the arrow; **browser-bridge B25/B26** are the icon row again (placement under Save, logos, assignment), with new **B26b** for the note's Send button (take back, then pick an agent from the menu); **browser-annotation-ui A1/A7/A8** check the closed menu, name-click does not open it, arrow does, and rename starts from the name.
