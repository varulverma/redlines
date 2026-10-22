---
name: Redlines
description: "See. Mark. Explain. Ship."
colors:
  signal-cyan: "#00e5ff"
  signal-cyan-hover: "#5cf0ff"
  signal-cyan-text-paper: "#007585"
  signal-ink-contrast: "#031417"
  ink: "#0b0b0b"
  ink-secondary: "#111111"
  ink-raised: "#151515"
  charcoal: "#1a1a1a"
  slate-hairline: "#262626"
  slate-hairline-strong: "#3a3a3a"
  slate-hairline-subtle: "#1c1c1c"
  ink-text: "#eaeaea"
  ink-text-secondary: "#a6a6a6"
  ink-text-tertiary: "#8a8a8a"
  paper: "#fafafa"
  paper-secondary: "#f2f2f2"
  paper-tertiary: "#eaeaea"
  paper-raised: "#ffffff"
  paper-hairline: "#dedede"
  paper-hairline-strong: "#c4c4c4"
  paper-text: "#0b0b0b"
  paper-text-secondary: "#474747"
  paper-text-tertiary: "#636363"
  category-bug: "#ff6b6b"
  category-suggestion: "#5aa9ff"
  category-text: "#ffc53d"
  category-note: "#a6a6a6"
  category-bug-paper: "#c5302e"
  category-suggestion-paper: "#1e5fc8"
  category-text-paper: "#8a5800"
  category-note-paper: "#545454"
  success: "#3ddc97"
  success-paper: "#11845b"
typography:
  display:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: "44px"
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "30px"
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: "22px"
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Space Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
  data:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "16px"
    fontFeature: "tnum"
  label:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: "14px"
    letterSpacing: "0.12em"
rounded:
  xs: "3px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
components:
  button-primary:
    backgroundColor: "{colors.signal-cyan}"
    textColor: "{colors.signal-ink-contrast}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.signal-cyan-hover}"
    textColor: "{colors.signal-ink-contrast}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-text}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "38px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-text-secondary}"
    rounded: "{rounded.sm}"
    size: "28px"
  dock-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-text-secondary}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
  input-field:
    backgroundColor: "{colors.ink-secondary}"
    textColor: "{colors.ink-text}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "38px"
  category-chip:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.ink-text}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "2px 8px 2px 7px"
  number-chip:
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.xs}"
    padding: "0 5px"
    height: "20px"
  filter-chip-selected:
    backgroundColor: "{colors.signal-cyan}"
    textColor: "{colors.signal-ink-contrast}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
  panel:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.lg}"
  sidebar-row:
    backgroundColor: "transparent"
    padding: "14px 16px 12px"
---

# Design System: Redlines

## Overview

**Creative North Star: "The Inspector's Instrument"**

Redlines is a measuring tool laid over someone else's page. Its panels are ink slabs ruled with slate hairlines, its voice is a monospace readout, and it has exactly one signal: a neon cyan that marks what is live, locked or selected. The core gesture is the four-corner bracket frame that snaps around the element under inspection, with a selector chip above and a "W × H px" chip below. Everything else stays quiet so that the bracket, the dock's active Inspect state and the category marks read instantly over any host site, light or dark.

Density is that of a log, not a gallery. The sidebar is a 360px column of hairline-divided rows, not floating cards; metadata is set in uppercase tracked micro-labels; numbers are tabular. Prose (note bodies, explanations) switches to Space Grotesk so a human sentence reads differently from a machine readout. Panel titles end in a blinking cyan underscore, the terminal cursor borrowed from the wordmark.

This world deliberately replaced the earlier soft, translucent pill-and-card look. There is no glass, no backdrop blur and no gradient surface anywhere. Dark ink is the default theme; paper is a full counterpart that the user chooses in Appearance (Dark, Light, System), never something the UI switches to on its own.

**Key Characteristics:**
- Ink and paper neutrals plus one cyan signal; four category colours carry meaning only as dots, number chips and pins.
- Space Mono for UI, labels, numbers and selectors; Space Grotesk for prose.
- Uppercase micro-labels tracked at 0.12em.
- 1px hairlines everywhere; radii 3 / 6 / 8 / 12px.
- Rows, not cards, in lists.
- Blinking cyan underscore after panel titles.
- Opaque surfaces only; reduced motion removes animation.

## Colors

A restrained palette: neutral ink or paper does all the structural work, and a single neon cyan signal appears only where something is active, selected or being inspected.

### Primary
- **Neon Signal Cyan** (#00e5ff): the one accent. Fills (primary buttons, the Notes badge, the selected filter chip, the selector chip), rings (focus outline, input focus border, Inspect active outline with its glow), and the bracket frame. Fills always carry Signal Ink text (#031417), never white. The fill stays the same cyan in the light theme.
- **Signal Cyan, Hover** (#5cf0ff): hover state of cyan fills, paired with a soft cyan glow.
- **Deep Signal Teal** (#007585): cyan used as text or icon colour on paper. Neon cyan as text is unreadable on #fafafa, so `--dn-accent-text` flips to this value in the light theme while fills stay neon.
- **Signal Ink** (#031417): the text colour on every cyan fill.

### Secondary
Category colours are a semantic set, not decorative accents. Each is used as a 6px dot in a neutral chip, as the fill of a numbered chip, and as the fill of the page pin, with numerals in the inverse text colour (ink on dark, white on paper) at 4.5:1 or better.
- **Bug Coral** (#ff6b6b dark / #c5302e paper)
- **Suggestion Blue** (#5aa9ff dark / #1e5fc8 paper)
- **Text Amber** (#ffc53d dark / #8a5800 paper)
- **Note Grey** (#a6a6a6 dark / #545454 paper)
- Custom categories get a hashed hue at a theme-controlled lightness (70% dark, 27% paper) so their numerals keep the same contrast.

### Neutral
- **Ink** (#0b0b0b): default page and panel ground; also paper-theme text.
- **Ink Secondary** (#111111) and **Charcoal** (#1a1a1a): inset fields and segmented-control tracks; chip and selected-segment fill.
- **Ink Raised** (#151515): menus, the one surface lifted above a panel.
- **Slate Hairline** (#262626): every divider, panel border and chip border. **Strong** (#3a3a3a) for menu borders, table header rules, dashed placeholders and scrollbars; **Subtle** (#1c1c1c) for list separators inside prose blocks.
- **Ink Text** (#eaeaea / secondary #a6a6a6 / tertiary #8a8a8a): primary copy, supporting copy, labels and metadata.
- **Paper** (#fafafa, secondary #f2f2f2, tertiary #eaeaea, raised #ffffff) with **Paper Hairlines** (#dedede / #c4c4c4) and **Paper Text** (#0b0b0b / #474747 / #636363): the light theme, mapped one to one onto the ink roles.
- **Success Green** (#3ddc97 dark / #11845b paper): copied and connected confirmations only.

### Named Rules
**The One Signal Rule.** Cyan is the only accent. If something is cyan, it is active, selected, focused or under inspection. Nothing decorative is cyan.

**The Ink-On-Cyan Rule.** Cyan fills carry Signal Ink text. Cyan as text appears on ink only; on paper it becomes Deep Signal Teal.

**The Category-As-Mark Rule.** Category colours appear as dots, number chips and pins, never as chip backgrounds, text runs or panel tints. The chip itself stays neutral.

## Typography

**Display / UI Font:** Space Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas)
**Body Font:** Space Grotesk (with the system sans stack)
Both are bundled from `fonts/` (OFL) so the UI renders offline: Space Mono 400/700 with italics, Space Grotesk as a variable font.

**Character:** A monospace readout for everything the instrument says, and a geometric grotesk for everything a person writes. The switch between them tells the reader whether they are looking at data or a sentence.

### Hierarchy
- **Display** (Mono 700, 40px / 44px, -0.04em, tabular): the popup's annotation count. One per surface at most.
- **Headline** (Mono 700, 24px / 30px, -0.03em): the extension-page title ("Redlines_ / settings").
- **Title** (Mono 700, 15px / 22px, -0.02em): panel titles (Annotations, table view, edit dialog, popup), followed by the blinking cursor.
- **Body** (Grotesk 400, 13px, line-height 1.55): note text, empty-state copy, settings explanations (hint text at 12px). Explanatory paragraphs cap at about 60ch.
- **UI** (Mono 400, 12px / 18px): buttons, menu items, inputs, toasts, table cells.
- **Data** (Mono 400 or 700, 11px / 16px, tabular numerals): selectors, dimensions, number chips, pins, form target line.
- **Label** (Mono 400, 10px / 14px, 0.12em, uppercase): field labels, counts ("3 annotations on this page"), menu headings, table headers. Chip text and row metadata use the same uppercase treatment at a tighter 0.06em.

### Named Rules
**The Readout-Versus-Voice Rule.** Mono for anything the tool generates or the user operates; Grotesk only for prose the user reads or writes. Never set a note body in Mono or a control in Grotesk.

**The Tabular Numbers Rule.** Every count, badge, pin, size and timestamp uses tabular numerals so columns and chips don't jitter.

## Layout

Everything is built on a 4px base (4, 8, 12, 16, 20, 24, 32, 40). In-page UI floats over the host with a 16px inset from viewport edges: the dock sits bottom-centre and snaps to the nearest edge when dragged (horizontal or vertical orientation, labels hidden when vertical); the sidebar is a fixed 360px column on the right, top and bottom inset 16px, capped at the viewport width minus 32px; the table view fills the viewport inside a 16px inset over a light scrim. The sidebar can collapse to a 56px rail of numbered chips that expands on hover or keyboard focus.

Rows inside panels use 14-16px horizontal padding and are divided by hairlines, never gaps. Extension pages (settings) use a 760px column with a 220px label column beside the controls, collapsing to one column under 640px. The popup is a fixed 300px.

## Elevation & Depth

Depth comes from tonal steps and hairlines first. Panels are opaque ink (or paper) with a 1px border; one ambient shadow separates the floating layer from the host page, because the UI must sit legibly on any site. Inside a panel, nothing is lifted: rows are flat and divided by hairlines. Glow is reserved for the signal: an active or hovered cyan element may carry a soft cyan glow.

### Shadow Vocabulary
- **Float** (`0 18px 44px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.35)`; paper uses 0.14 / 0.08 alpha): dock, sidebar, form, edit dialog, table view and menus.
- **Toast** (`0 8px 20px rgba(0,0,0,0.40), 0 2px 6px rgba(0,0,0,0.30)`): toasts.
- **Pin** (`0 2px 6px rgba(0,0,0,0.35)`): page pins.
- **Signal Glow** (`0 0 18px rgba(0,229,255,0.28)`; paper `0 0 14px rgba(0,200,225,0.30)`): Inspect active, dragging dock, hover on cyan fills.
- **Modal Scrim** (`0 0 0 100vmax rgba(0,0,0,0.30-0.35)` added to Float): edit dialog and table view only.

### Named Rules
**The Opaque Instrument Rule.** Surfaces are solid ink or paper. No translucency over the host, no backdrop blur, no glass.

**The Glow-Means-Live Rule.** Only cyan glows, and only when something is active, dragging or hovered.

## Shapes

Precise and lightly softened. Four radii carry the whole system: 3px for chips, number chips, kbd keys and the size chip; 6px for icon buttons, chips you press, menu items and the mark slot; 8px for buttons, inputs, toasts, menus and segmented tracks; 12px for the outer panels (dock, sidebar, form, dialogs, table view). Pills (999px) appear only on the Notes badge. Every border is 1px; the only 2px lines are the bracket strokes, the focus outline and the ring around pins and the badge that separates them from the host.

Two recurring silhouettes: the **bracket frame** (four 12 × 2px corner strokes drawn 4px outside the target, cyan with a faint glow) and the **pin**, a rounded tag with a square bottom-left corner (6px 6px 6px 0) that points at the element's top-left corner. Placeholders and "add new" affordances use a dashed hairline.

## Components

### Buttons
Square-shouldered, monospace and quiet until active.
- **Shape:** gently rounded (8px); 38px tall on extension pages, 32px in the in-page form and dock.
- **Primary:** cyan fill, Signal Ink text, Mono 700 12px, 0 16px padding. Hover lightens to #5cf0ff and adds the Signal Glow. Disabled drops to 50% opacity, no glow.
- **Secondary:** transparent with a strong hairline and primary text; hover adds the neutral hover tint.
- **Icon button:** 28px square, 6px radius, secondary text colour; hover fills with the hover tint and brightens to primary text. A busy state turns cyan and pulses.
- **Focus:** a 2px cyan outline offset 2px on every control.

### Chips
- **Category chip:** neutral charcoal fill, 1px hairline, 3px radius, uppercase Mono 10px at 0.06em, led by a 6px category-coloured dot.
- **Number chip:** solid category colour, 3px radius, 20px tall, Mono 700 11px tabular numerals in the inverse text colour.
- **Category picker (form):** 6px radius chips with a dot; selected = cyan border plus cyan-subtle fill; "add new" is a dashed chip without a dot.
- **Filter chip (table):** transparent with a hairline; selected = solid cyan fill, Signal Ink text and bold weight, so state never relies on hue alone.

### Cards / Containers
- **Panels:** 12px radius, opaque ink fill, 1px slate hairline, Float shadow. The form has 12px padding, the edit dialog 16px.
- **Sidebar notes:** flat bordered cards with state edge, filters and colour-coded actions; see *Annotation UI v2* below. (Replaces the earlier hairline rows.)
- **Settings notes:** secondary-ink fill, hairline, 8px radius, Grotesk 12px.

### Inputs / Fields
- **Style:** inset secondary-ink fill, 1px hairline, 8px radius; Mono 12px for single-line fields, Grotesk 13px for note textareas; tertiary-text placeholders; cyan caret.
- **Focus:** border turns cyan with a 3px cyan-subtle ring; no outline.
- **Segmented control (Appearance):** 2px-padded track; the checked segment gets the charcoal fill and a 1px inset cyan line.

### Navigation
- **Dock:** a 12px-radius ink bar with 5px padding holding the dashed 24px mark slot, a grip, Inspect (icon plus label), Notes with its cyan count badge, Table, Settings and a hide control, split by 1px vertical hairlines. Buttons are 32px, secondary text; hover takes the hover tint. Active Inspect = cyan text, cyan-subtle fill, cyan border and Signal Glow. Dragging adds a cyan border and glow.
- **Menus:** raised ink, strong hairline, 8px radius, 4px padding; uppercase label headings; items are Mono 12px rows whose icons turn cyan on hover or focus. Open triggers take the cyan-subtle fill and cyan border.
- **Popup rows:** 38px full-width rows with a leading icon and a trailing kbd key; the primary row is a cyan fill.

### Inspect Highlight (signature)
The product's core gesture. While Inspect is on, the host cursor is replaced by a cyan dot inside a slowly breathing cyan ring. The hovered element gets a faint cyan wash (6% cyan) with a cyan-ring hairline, four cyan corner brackets 4px outside it, a solid cyan selector chip above (Mono 700 11px, Signal Ink text) and an ink "W × H px" chip below with a cyan border and cyan text. Near viewport edges the chips move inside the element. The frame tracks the pointer with a 130ms ease-out glide. When the form opens the highlight locks (as a rounded outline with a connector to the form, see *Annotation UI v2*) and the custom cursor hides.

### Page Pins and Toasts
- **Pins:** category-coloured tags (6px 6px 6px 0) with a 2px ground-coloured ring, Mono 700 11px inverse numerals and the Pin shadow; hover or focus scales them 1.12× with a cyan ring. Hidden during Inspect.
- **Toasts:** bottom-centre above the dock, ink fill, hairline, 8px radius, Mono 12px, led by a cyan "›" prompt; an optional uppercase outline action in cyan.

### Panel Title Cursor (signature)
Panel and page titles end in a cyan "_" that blinks with a hard step every 1.1s, using the accent-text colour so it stays legible on paper.

## Annotation UI v2 (shipped 21 Oct 2026)

The callout, sidebar notes and table actions. Clickable reference: `annotation-variations.html#shortlist` (serve the folder over http). Components: `design-system.html`. Code: `openForm` and `renderSidebar` in `content.js`, the `#designnote-popup-form`, `.dn-card` and `.dn-act` blocks in `content.css`, action and surface tokens in `design-tokens.css`.

- **Callout = one-line composer.** A 440px card, 14px radius, 6px padding, hairline edge. One 30px row: category chip (soft fill, 6px category dot, Mono 11px, chevron) · note (borderless, grows to ~7 lines, Shift+Enter = new line) · Esc (red ✕, ghost until hover/press) · Save (the only solid control, accent, arrow icon). Under it a faint caption `› selector · W×H · #NN`; "⇧↵ new line" fades in only while typing. Nothing else: no attachments. Every active AI agent shows as a small icon-only toggle (22px, its logo) at the right end of the caption line, on the same line as the selector; pick one and the note is sent to it on save (none connected: the row isn't there).
- **Save readiness.** Empty note: Save is `aria-disabled` (faint tile) but stays focusable; Enter or click then shakes the card and says "Please add a comment before saving." (A real `disabled` would drop it from the Tab order and from keyboard-only saving.)
- **Category.** The chip shows the category (default **UI**). Its name is plain text (double-click renames); only the small arrow beside it opens the menu (category pills, "+" to add one, "Rename"), and the menu is always closed when the form opens. Renaming changes the list and every saved note in that category (any page), like Settings → Categories. Settings → Categories (Hide/Show) now only affects the Edit dialog.
- **Attached to the element.** The locked highlight becomes a rounded accent outline (8px radius, 4px accent-subtle halo); a 1px elbow connector with a square node and a ring tip is drawn from it to the card (stroke-dashoffset, 280ms), then the card slides in 8px (280ms, 120ms delay). Placement: right of the element, else left, else below/above, 48px away and clear of an open sidebar. The connector follows scroll; it is an SVG, so it hides with the `hidden` attribute, not a property. Reduced motion: no animation.
- **Writing state.** With text, the whole card gets an accent border and 4px halo, and the element outline and connector glow. Esc is red and Save accent, and each flashes when it fires.
- **Sidebar notes are flat bordered cards** (8px radius, 6px apart): number chip · category chip · agent / status tags · right-aligned age · note · replies · screenshot thumbnail (96×56; click opens it large, Esc closes just that layer) · actions. A 3px left edge marks state: accent active, warning element lost, success resolved. Status filters (All · Open · Agent · Re-pin · Done) with live counts sit under the header; they hide in the compact rail.
- **Actions are colour-coded rounded buttons** (28px in cards, 30px in the table), one 16px stroke icon set: Resolve (green, labelled) | Copy (blue) · Copy image (violet) · Edit (amber) · Enhance (pink) · Send to agent (orange; filled = sent, click again takes it back; with several agents connected it opens a menu) · Delete (red, right-aligned; immediate, with an Undo toast). Lost notes add a labelled Re-pin. Resting buttons are slightly muted and light up on the card you are on. The hues are `--dn-act-*` tokens with light-theme variants.
- **Tooltips** are sentences from one floating `.dn-tip` driven by `data-tip` (hover and keyboard focus), so panel shapes never clip them.
- **Table** keeps its columns (# · Screenshot · Type · Note · [Page] · Location · Marked at · Actions) and filters; rows get the same buttons (icon-only, plus Resolve and Send), a status tag beside the note, and resolved rows dim.
- **Surfaces** (Settings → In-page panels): **Frosted** (default, 88% + blur 24), **Glass** (62% + blur 14, light top edge), **Liquid glass** (30% + blur 6, backdrop darkened/lifted, bright specular edge; most transparent, contrast on pure white/black pages is lower than the others) and **Solid**.
- **Rule exceptions.** Action hues are the one sanctioned use of extra colours: they code meaning, never decorate. Translucency exists only through the Surface setting.

## Do's and Don'ts

### Do:
- **Do** keep cyan (#00e5ff) to active, selected, focused and inspected states; put Signal Ink (#031417) text on every cyan fill.
- **Do** switch cyan used as text or icon colour to `--dn-accent-text`, which resolves to #007585 on paper.
- **Do** show categories as a 6px dot in a neutral chip, a solid number chip, or a pin, with inverse-colour numerals at 4.5:1 or better.
- **Do** set controls, labels, numbers and selectors in Space Mono and note bodies and explanations in Space Grotesk.
- **Do** use uppercase micro-labels at 10px with 0.12em tracking for field labels, counts and headers.
- **Do** divide lists with 1px hairlines and keep radii to 3 / 6 / 8 / 12px.
- **Do** end panel titles with the blinking cyan underscore.
- **Do** read every colour from `design-tokens.css` (`--dn-*`) so both themes stay mapped one to one.
- **Do** honour `prefers-reduced-motion`: transitions and animations collapse to zero (the in-page busy pulse is the one kept "working" cue).
- **Do** use the Burst mark from `brand/logo/burst/` wherever the brand mark appears (dock, popup, settings, icons); never redraw or recolour it.

### Don't:
- **Don't** use gradient surfaces on panels; translucency and blur come only from the In-page panels surface setting (Frosted by default).
- **Don't** introduce a second accent colour or tint panels, rows or chip backgrounds with category colours. The `--dn-act-*` action hues are the only exception, and only on note action buttons.
- **Don't** put cyan text on paper or white text on cyan.
- **Don't** float or shadow sidebar notes: they are flat bordered cards, not elevated panels.
- **Don't** add shadows inside panels or glow anything that isn't cyan and live.
- **Don't** switch the theme automatically; dark is the default and light or system is the user's choice.
