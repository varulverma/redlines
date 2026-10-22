# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary (confirmed 2026-10-19): a freelance web designer or front-end developer who reviews live sites alone and hands findings to a developer, a team, or an AI coding assistant. They work inside other people's pages, mid-review, and want to capture an issue without breaking flow.

## Product Purpose
DesignNote is a Chrome (MV3) extension that lets the user mark up any webpage with Figma-style comments pinned to elements, saved locally per URL. Success: a visual issue is recorded with enough context (element selector, page, screenshot) to be actionable, then handed off — file, clipboard, AI prompt, or Drive — with less ambiguity than a screenshot and a sentence.

## Positioning
Local-first, element-anchored annotation that lives on the live page itself, with no account or backend, and an optional "Enhance" step that rewrites a raw note into a structured coding-agent prompt using the user's own API key.

## Operating Context
Runs as an overlay on arbitrary third-party sites (light or dark, any CSS), so its UI must stay legible and isolated on any host. Primary workflow: turn on Mark mode (pill or `Alt+Shift+M`) → click an element → pick a category → write → save → review in sidebar or table view → edit/delete/copy/jump → export or send. Closing the UI must leave the page exactly as before.

## Capabilities and Constraints
- Surfaces: in-page UI under `#designnote-root` (floating pill, Mark mode highlight, annotation form, sidebar, table view, menus, toasts), toolbar popup, settings page, `design-system.html` reference.
- Categories: 4 presets (text, suggestion, bug, note) plus any custom category string.
- Exports: file formats and clipboard, scoped "this page" / "all pages"; optional AI Enhance (Anthropic / OpenAI / OpenRouter); optional Google Drive upload.
- Vanilla JS/HTML/CSS, no build step, no new dependencies without owner approval.
- Offline-first: no network in capture/save/load; outbound only on trusted user action with one-time consent, only from `background.js`.
- Colours come from `design-tokens.css`; `getTypeColor()` returns `var(...)` values, never fixed hex.
- Open decisions live in `docs/product/PRODUCT_BRIEF.md` (D5 URL keying, D6 release browsers, D8 backup, D9 shadow DOM, D10 Drive OAuth).

## Brand Commitments
- Name: **Redlines** (renamed from DesignNote on 2026-10-19). Tagline: "See. Mark. Explain. Ship." The annotate mode is called **Inspect Mode** in user-facing copy.
- Internal identifiers (`dn_*` storage keys, `#designnote-root`, `designnote-*` ids, the gecko id) stay unchanged so existing local notes keep loading.
- The logo is final: the **Burst** mark (finalized 2026-10-20). Masters live in `brand/logo/burst/` (SVG, mono, lockups, app icons, PNGs) and in Figma `Portfolio-27` → Logo section (`66:1544`, board "Redlines — Burst final"). Use those files wherever a mark appears (`.dn-mark-slot`, `.rl-mark-slot`, `icons/`); don't redraw, recolour or restyle it.
- Visual source of truth: the Redlines moodboard in Figma (`Portfolio-27`, section `19:1276`).

## Evidence on Hand
- Current UI rebuilt in Figma: `Portfolio-27`, node `23:1284` ("Extension UI — as shipped").
- Product, privacy, testing and UX audit docs under `docs/`.
- No user research, testimonials, or usage data exist yet; do not fabricate them.

## Product Principles
- Reliability before feature count.
- Local-first; the user can always tell what leaves the browser and where it goes.
- Context travels with the finding.
- Never disturb the host page.
- Small, safe changes in plain web tech.

## Accessibility & Inclusion
Keyboard-complete: Escape closes the innermost layer only while focus is in DesignNote UI, and every close returns focus to its opener. Text contrast is checked over both light and dark host pages (`tests/browser-a11y.js`, `docs/ux/UX_AUDIT.md`).
