# DesignNote — UX and Accessibility Audit (Phase 4)

_Run 2026-10-18, Windows 11, Chrome 155 and Edge 156, using `tests/browser-a11y.js` (24 checks)._

**What this is:** observed friction points with before/after evidence from a real browser.
**What it is not:** a formal accessibility conformance audit (WCAG or otherwise). No screen reader was
driven and no participant took part. Those are listed under "Not verified".

## How it was measured

`tests/browser-a11y.js` loads the unpacked extension in real Chrome and measures it:
- **Keyboard:** real `Tab`, `Enter` and `Escape` key events go through the DevTools protocol (no `.click()` shortcuts in the keyboard checks).
- **Accessible names:** taken from Chrome's computed accessibility tree.
- **Focus rings:** computed style with and without keyboard focus, read after transitions finish.
- **Contrast:** each text colour against its background. Semi-transparent panels are alpha-composited over the host page. Backdrop blur is ignored, which is also the no-`backdrop-filter` case.
- **Themes:** both themes, over a white host page and over a near-black one.
- **Reduced motion:** `prefers-reduced-motion: reduce` is emulated, then every DesignNote element is checked for transitions or animations over 100 ms.
- **Zoom:** 200% is approximated as a 640×450 CSS-px viewport (1280×900 at 200%). 320×568 stands in for 400% zoom or a small phone. Real browser zoom was not used.

The same suite was run on the pre-Phase-4 copy for the "Before" column.

## Results

| ID | Check | Before | After |
|---|---|---|---|
| K1 | Keyboard only: Tab to Mark → Enter → Tab to a page control → Enter → type → Tab to Save → Enter | ✓ (worked, unannounced) | ✓ |
| K2 | After saving, focus returns to where the user was | ✗ lost to `<body>` | ✓ |
| K3 | Sidebar: Escape (focus inside) closes it, focus returns to the Notes button | ✗ Escape did nothing | ✓ |
| K4 | A card can be focused and Enter jumps to its element | ✗ cards were mouse-only | ✓ number badge is a "Go to annotation n" button |
| K5 | Export menu: focus moves to the first item, Escape closes, focus returns, `aria-expanded` resets | ✗ focus stayed on the trigger, items weren't reachable by Tab, Escape did nothing | ✓ |
| K6 | Edit form: Escape closes it and focus returns to the Edit button | ✗ focus lost to `<body>` | ✓ |
| K7 | Table: focus moves in on open, Escape closes, focus not lost | ✗ | ✓ focus goes to search, then back to the Notes button |
| K8 | In Mark mode with the sidebar open, one Escape leaves Mark mode only | ✓ (the old code had no sidebar Escape) | ✓ |
| K9 | Keyboard drag of the floating bar (Enter, arrows, Escape) | ✗ **never worked**: the same Enter that started the drag also ended it | ✓ moves, Escape restores |
| N1 | Every visible control has an accessible name | ✓ (91 controls) | ✓ (97) |
| N2 | Mark exposes on/off, Notes exposes open/closed | ✗ neither | ✓ `aria-pressed`, `aria-expanded` |
| N3/N4 | Forms are labelled dialogs; the note field has a real label | ✗ placeholder only, no dialog role | ✓ |
| F1 | Visible keyboard focus on 15 sampled controls | ✓ | ✓ |
| T1 | Type/category shown as text, not colour only | ✓ | ✓ |
| E1 | The empty state names controls that exist | ✗ said "Mark" and "+ Note"; neither label existed | ✓ |
| S1 | Jumping to a note whose element is gone says so | ✗ silent | ✓ "Couldn't find this element… Scrolled to where it was." |
| M1 | Reduced motion: no transitions or animations | ✗ 8 kinds of element still animated | ✓ |
| C1 | Light theme on a light page | ✗ secondary text 4.48:1, Note badge 3.99:1 | ✓ |
| C2 | Light theme on a dark page | ✗ count 2.37:1, badge 1.81:1, card number 2.45:1 | ✓ |
| C3 | Dark theme on a light page | ✗ count 2.42:1, meta 2.08:1 | ✓ |
| C4 | Dark theme on a dark page | ✗ card number 2.45:1 | ✓ |
| Z1 | 200% zoom: everything stays on screen | ✗ Edit form ran off the bottom-right | ✓ |
| Z2 | 320×568 | ✗ sidebar close button and 5 table header controls off screen; Edit form off screen | ✓ |

**Totals:** 5/24 before, 24/24 after (Chrome 155 and Edge 156).

## Friction points found and what changed

### P1: keyboard and focus (K2–K7, N2–N4)
- **Escape.** One handler on `#designnote-root` closes the innermost open layer: menu, then table, then sidebar. It only acts while focus is inside DesignNote's UI, so the host page's own Escape keeps working. The forms and Mark mode keep their own Escape:
  - In Mark mode, one Escape now only leaves Mark mode. It used to also close the sidebar underneath.
  - During a keyboard drag of the floating bar, Escape still cancels the drag.
- **Focus return.** Every close path puts focus back on the control that opened the layer:
  - menu → its trigger
  - forms → whatever was focused when they opened
  - sidebar and table → the Notes button
- **Listener leak.** The create form's Escape and outside-click listeners used to leak after Save or Cancel, and the edit form's after Save. They are now removed on every close, including when a form is replaced by a new one.
- **Export / Copy menus.** Opening one focuses its first item. Picking an item returns focus to the trigger.
- **Cards.** The number badge is now a button ("Go to annotation n on the page"). It also makes the compact rail keyboard-usable.
- **State attributes.**
  - Mark button: `aria-pressed`. Its tooltip names the shortcut: "Mark an element to annotate (Alt+Shift+M)".
  - Notes button: `aria-expanded`.
  - Table view toggle and filter chips: `aria-pressed`.
- **Labelled dialogs.** The forms are `role="dialog"` with names: "New annotation", "New general note", "Edit annotation". Text fields and the table search have `aria-label`s.

- **Keyboard drag of the floating bar (pre-existing bug).** Pressing Enter on the drag handle started the drag, and the same keypress bubbled to the document-level drag listener, which ended it again. Keyboard users could never move the bar out of the way of page controls. Fixed by stopping that keypress at the handle.

### P2: Mark mode state and discovery (E1, K1)
- **Mark mode hint.** Entering Mark mode shows "Mark mode: click any element, or Tab to one and press Enter. Esc to stop." It appears in the existing `role="status"` toast.
- **Keyboard highlight.** In Mark mode, the element that keyboard focus lands on is highlighted, so keyboard users can see what Enter will mark. Marking by keyboard already worked (Enter on a focused control fires the click that Mark mode catches), but nothing showed or said it.
- **Empty state.** It now names the real controls: "Mark" (the target button on the floating bar) and "Add a general note" (+).

### P3: selector loss (S1)
- **Element not found.** When the element can't be found, a toast now explains why. If the note has a stored position, the page also scrolls to where the element was.
- **Fuzzy match.** The old "⚠ Matched approximately" badge was a positioned span that screen readers never announced. It is now a status toast that also says what to do: "Check it is the right element."

### P4: contrast in both themes (C1–C4)
**Root cause:** the panels were 72% opaque. Over a host page of the opposite brightness (dark theme on a white site, which is common), the panel turned mid-grey and secondary text fell to about 2.4:1.

**Changes** (tokens in `design-tokens.css`, mirrored in `design-system.html`):

| Token | Light | Dark |
|---|---|---|
| `--dn-glass-bg` | 0.72 → 0.9 opacity | 0.72 → 0.9 opacity |
| `--dn-text-secondary` | `#787774` → `#5f5e5b` | `#9b9b9b` → `#b0b0b0` |
| `--dn-type-bug-text` | `#c4554d` → `#a8443d` | (unchanged) |
| `--dn-type-suggestion-text` | `#0b6e99` → `#0a6690` | (unchanged) |
| `--dn-type-note-text` | `#9d6b19` → `#8a5c12` | (unchanged) |
| `--dn-type-custom-l` (new) | 27% | 70% |

The darker light-theme type colours also replace the old ones in the HTML and print exports.

**Category colours.** `getTypeColor()` now returns token references instead of fixed hex values:
- Preset types use `var(--dn-type-*-text)`.
- Custom categories use `hsl(hue 65% var(--dn-type-custom-l))`.

Before, a custom category such as "Spacing" came out as a bright green behind white text (2.45:1).

**Text on category colours.**
- Card numbers and page pins use `--dn-text-inverse`.
- Custom-category badges use body text on their tint, because same-hue text on its own tint can't reach 4.5:1.

**Design trade-off (owner):** 0.9 opacity makes the "glass" effect visibly subtler. It is one token per theme, so it is easy to revert or tune. Anything below about 0.88 fails C2/C3 with the current text colours.

### P5: layout at 200% / 320 px (Z1, Z2)
- **Edit form position.** The edit form was never centred. Its pop-in animation replaced the `translate(-50%, -50%)` it relied on, so the form's top-left corner sat at the middle of the viewport. It was off screen whenever the viewport was under about 760 px wide or tall. It is now centred with `inset: 0; margin: auto` and scrolls internally when taller than the viewport. Its duplicate inline styles were removed (the CSS already defined them).
- **Wrapping.** The sidebar header actions and the table header now wrap instead of pushing controls off screen.

### P6: motion (M1)
- **CSS.** One `prefers-reduced-motion` rule turns off all DesignNote transitions and animations. The Drive "busy" pulse stays, because it is a fade and the only progress cue.
- **JS.** Scrolling (jump, card flash) is instant under reduced motion, and the Mark cursor ring no longer trails the pointer.

### P7: filter chips used colour-only state and fixed light-theme colours
The active chip was shown only by hue, through inline styles with hard-coded light-theme hex values; inactive chips lost all styling after the first click. They now use token-based CSS. The selected chip is inverted, and the state is exposed as `aria-pressed`. About 30 lines of colour maps were deleted.

## Backdrop-filter fallback
- **Existing fallback.** `content.css` already had a `@supports not (backdrop-filter)` block that makes panels opaque. The edit form and the action menus were missing from it and have been added.
- **Not testable here.** The fallback can't be exercised in Chromium, which supports `backdrop-filter`.
- **Covered anyway.** The contrast checks ignore blur, so they cover the no-blur appearance at the new 0.9 opacity.

## Known gaps (not fixed in Phase 4)
| Gap | Why it's left | Workaround |
|---|---|---|
| Mark mode can only reach **focusable** page elements by keyboard (links, buttons, inputs), not plain text or divs | Needs a new element-picker interaction (feature scope) | "Add a general note" and describe the location; or mark the nearest focusable control |
| Table rows jump to their element on click only | Jumping closes the table and opens the sidebar anyway | The sidebar card's number button does the same thing by keyboard |
| Forms are non-modal dialogs with no focus trap | Not modal by design: the page stays usable while a form is open | Escape closes and returns focus |
| Toasts are created with `role="status"` already populated | Some screen readers announce only *changes* inside an existing live region | Needs a screen-reader check (see below) before deciding on a persistent live region |
| The design-token block also defines `--dn-*` on the host page's `:root` | Pre-existing (Phase 2 risk); `--dn-type-custom-l` follows the same pattern | Part of D9 (shadow DOM) |
| Tertiary text (`--dn-text-tertiary`) | Used only for placeholders and decorative icons, not measured | Revisit with a visual review |
| Export / Copy menus have no arrow-key navigation | Items are ordinary buttons reachable with Tab | Tab / Shift+Tab |

## Not verified (needs a human)
- **Screen reader.** NVDA, JAWS, Narrator or VoiceOver: are toasts, dialog names and pressed/expanded states announced as intended?
- **Real browser zoom** at 200% (Ctrl +) rather than the CSS-viewport approximation.
- **Visual review.** In a headed window in both themes, check:
  - the new 0.9 panel opacity
  - the inverted active filter chip
  - card numbers as buttons
  - the Mark mode hint toast (shown each time Mark mode starts; it may feel noisy to frequent users)
- **First-run discoverability** without coaching. That is a Phase 5 participant question; no participant data exists.
- **Windows High Contrast / forced-colors mode.**
- **Firefox.**
