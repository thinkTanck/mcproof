---
name: MCProof — Sentinel Fields
description: Dark control-room HUD for red-teaming MCP agents; tri-state status signal, three type roles, measured-not-asserted.
colors:
  nominal-cyan: '#54d4e6'
  readout-cyan: '#b6ecf4'
  line-emphasis-cyan: '#2b6b7d'
  caution-amber: '#ebb561'
  breach-red: '#ed576e'
  breach-text: '#f58ea0'
  inert-slate: '#708c9e'
  navy-base: '#05080b'
  navy-panel: '#101823'
  navy-raised: '#17212d'
  line: '#1c2a36'
  ink-hi: '#d3e2ea'
  ink-body: '#99b8c7'
  ink-muted: '#708c9e'
  ink-faint: '#6a8798'
typography:
  display:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '40px'
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: '-0.01em'
  masthead:
    fontFamily: 'Geist Mono, ui-monospace, SF Mono, monospace'
    fontSize: '21px'
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: '0.09em'
  headline:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: 'clamp(32px, 5cqi, 44px)'
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: '-0.02em'
  title:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '28px'
    fontWeight: 600
    lineHeight: 1.2
  lead:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '18px'
    fontWeight: 400
    lineHeight: 1.5
  subhead:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '20px'
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '17px'
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.4
  data:
    fontFamily: 'Geist Mono, ui-monospace, SF Mono, monospace'
    fontSize: '15px'
    fontWeight: 500
    lineHeight: 1.05
  readout:
    fontFamily: 'Geist Mono, ui-monospace, SF Mono, monospace'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: '0.02em'
  label:
    fontFamily: 'Geist Mono, ui-monospace, SF Mono, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: '0.02em'
rounded:
  sm: '2px'
  md: '4px'
  lg: '8px'
  pill: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.navy-panel}'
    textColor: '{colors.readout-cyan}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '12px 24px'
  button-primary-hover:
    backgroundColor: '{colors.navy-raised}'
    textColor: '{colors.readout-cyan}'
  status-chip:
    backgroundColor: '{colors.navy-panel}'
    textColor: '{colors.nominal-cyan}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '4px 10px'
  panel:
    backgroundColor: '{colors.navy-panel}'
    textColor: '{colors.ink-body}'
    rounded: '{rounded.lg}'
    padding: '16px'
  input-field:
    backgroundColor: '{colors.navy-base}'
    textColor: '{colors.ink-hi}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
---

# Design System: MCProof — Sentinel Fields

## 1. Overview

**Creative North Star: "Sentinel Fields — a mission-control console for a run in progress"**

Sentinel Fields is a dark control room, not a dark SaaS dashboard. The base is deep blue-black navy (never pure black), overlaid with thin glowing line-work, arc and ring motifs, and translucent panels that read like instrument glass. The system's whole job is to make one thing legible under time pressure: where an agent was compromised, and whether the verdict can be trusted. So the interface behaves like an instrument, calm at rest and alive while a run replays, never like a game that celebrates a score. The measured-not-asserted thesis of the product is carried in the type: the numbers that matter are the focus, and the honest provenance sits beside them.

The system explicitly rejects the generic AI dark-dashboard reflex: the uniform cyan-on-navy wash where nothing has hierarchy, the thin-border panel soup where every element is the same 1px card, and the tiny uppercase tracked eyebrow stacked above every section. It also rejects color-only status (a red glow with no label), low-contrast grey-on-tint body text, and gamified ornament (confetti, scanlines, neon-for-neon's-sake). Where a choice looks superficially like an AI tell but carries real information, it stays and is defended in prose: the tri-state glow is a functional signal language, and the 01 to 10 numbering is the real OWASP ASI taxonomy.

**Key Characteristics:**

- Dark navy control-room base with thin glowing line-work, arcs, and translucent panels.
- A functional tri-state status signal (nominal / caution / breach) plus a neutral inert fourth state, always glow with a label or icon.
- Three deliberately non-interchangeable type roles: Reading, Instrument, Display.
- Motion that is restrained and alive: a playhead sweep, nodes lighting, a soft glow-pulse, the verdict easing in.
- Measured, not decorated: the focal numbers are the design, the provenance sits beside them.

## 2. Colors

A near-black navy field carrying a single functional accent trio (cyan, amber, red) whose color IS its meaning, plus a quiet ink ramp for text.

### Primary

- **Nominal Cyan** (#54d4e6): the "normal / nominal" status and the primary interactive accent. Focus rings, active nav, the leakage-barrier line-work, play controls. Never used as a decorative wash; its presence signals state or action.
- **Readout Cyan** (#b6ecf4): the high-value monospace readout ink for the numbers and identifiers that ARE the focus (run ids, step readouts, the Display role's default color).
- **Line-emphasis Cyan** (#2b6b7d): the dim cyan for emphasized hairlines, graticule line-work, and structural rings; a quiet structural accent, used at low alpha, never as a fill.

### Secondary

- **Caution Amber** (#ebb561): the "elevated / caution" middle status. Degraded robustness, partial coverage, a warning that is not yet a breach.
- **Breach Red** (#ed576e): the "compromise / breach" status. Reserved for an actual breach; spending it anywhere else corrupts the signal. **Breach Text** (#f58ea0) is the AA-safe red for breach text on the dark field (8.0:1).

### Tertiary

- **Inert Slate** (#708c9e, the ink-500 family): the neutral fourth state, "not measurable / out of scope" (the ASI07/08/09 rows on the coverage board). `--status-inert`, AA on base and panel, desaturated, explicitly NOT a tri-state member, no glow, and never red.

### Neutral

- **Navy Base** (#05080b): the app background. Deep blue-black, never pure black.
- **Navy Panel** (#101823) / **Navy Raised** (#17212d): translucent panel fills and raised surfaces; elevation is earned, not default.
- **Line** (#1c2a36): the hairline border and divider.
- **Ink Hi** (#d3e2ea, 13.7:1): primary reading text and headings. **Ink Body** (#99b8c7, 8.7:1): body prose. **Ink Muted** (#708c9e, 5.7:1) / **Ink Faint** (#6a8798, 5.3:1): the AA-safe instrument label tiers.

### Named Rules

**The Signal Rule.** Cyan, amber, and red are a functional signal language, not decoration. Each appears only where it means its state (nominal / caution / breach), always as glow PLUS a label or icon, never color alone. Red is reserved for an actual breach; a not-tested category is inert, never red.

**The Earned-Elevation Rule.** Surfaces are flat by default on the navy field. A panel fill or a raised tone appears only where hierarchy needs it. Never nest cards; never wrap every element in an identical 1px border.

## 3. Typography

**Display Font:** Geist (with Inter, system-ui fallback)
**Body Font:** Geist (with Inter, system-ui fallback)
**Label/Mono Font:** Geist Mono (with ui-monospace, SF Mono fallback)

**Character:** One family pairing on a contrast axis of sans versus mono. Sans carries everything a human reads and the focal numbers; mono carries the telemetry. The tell we avoid is pairing two similar sans; here the axis is prose-sans against instrument-mono, and the split is measurable.

### Hierarchy

The system runs on THREE deliberately non-interchangeable roles. Prose never renders at instrument size; telemetry never carries a sentence; a focal number is never chrome.

- **Display** (500, 40 / 28 / 20 / 15px, line-height 1.05): the focal-data role. Values that ARE the visual focus: hero stats, leaderboard cell values and the OVERALL column, the replay step numeral. Family follows the surface (sans hero counters, mono leaderboard readouts); the role pins the scale and rhythm, not the family.
- **Headline / Reading h1** (600, clamp(32px, 5cqi, 44px), line-height 1.1): the page pitch or screen title. Sized in `cqi` against the content column (which resizes as the command deck collapses), never `vw`.
- **Title / Reading h2, h3** (600, 28px / 20px): section and panel titles.
- **Body / Reading** (400, 17px, line-height 1.6): every sentence a human reads. 16px is the AA floor, not the target. The design owns the column width; the type role pins no measure cap.
- **Caption** (400, 14px sans): secondary labels, list-item names, and field captions (the Core-7 category titles, a field's server-side-only assurance line). A sans tier below body, for short labels and captions only, never running body prose.
- **Label / Instrument** (400, 12 to 13px, letter-spacing 0.02em, uppercase micro-labels at 0.12em): telemetry ONLY. Labels, chips, metadata, cues, column and row headers, in Geist Mono.
- **Masthead lockup** (600, 21px, letter-spacing 0.09em from 360px up and 0 below it, Geist Mono): the dominant MCProof wordmark in the top bar only. A single deliberate lockup at its own size (design system section 7), not a general step; it is the one place the brand mark asserts scale.

### Named Rules

**The Three-Role Rule.** Reading is sans prose, Instrument is mono telemetry, Display is the focal number. The roles stay measurably distinct: the Display floor (15px) and the Reading body (17px) both sit above the Instrument ceiling (13px). Prose wearing an Instrument role is a blocking review failure.

**The Reference Rule.** The frozen design is the default visual reference; these roles describe it, they do not redesign it. Where a role and the design disagree, the design is the default and the role is re-examined (see [ADR-0004](docs/adr/0004-design-frozen-and-impeccable-as-craft-gate.md)).

## 4. Elevation

Flat by default. Depth on the navy field is conveyed by tonal layering (base to panel to raised) and by a functional glow, not by drop shadows. There is no ambient drop-shadow vocabulary; the only "shadow" tokens are colored status glows, which are signal, not depth.

### Shadow Vocabulary

- **Nominal glow** (`box-shadow: 0 0 12px color-mix(in srgb, #54d4e6 35%, transparent)`): a nominal-state accent (an active node, a focus emphasis).
- **Caution glow** (`box-shadow: 0 0 12px color-mix(in srgb, #ebb561 35%, transparent)`): an elevated/caution accent.
- **Breach glow** (`box-shadow: 0 0 16px color-mix(in srgb, #ed576e 45%, transparent)`): a breach accent; the only glow allowed the extra radius, because breach is the one thing the eye must find first.

### Named Rules

**The Glow-is-Signal Rule.** A glow is never decoration. If an element glows, its glow encodes a status, and it is accompanied by a label or icon carrying the same meaning. No element glows "for atmosphere."

## 5. Components

### Buttons

- **Shape:** small radius (4px); pills (999px) only for status chips.
- **Primary:** a navy-panel fill with readout-cyan mono label and a thin nominal border; padding 12px 24px. The primary CTA (play the sample, connect the agent) reads as an instrument control, not a marketing button.
- **Hover / Focus:** hover lifts the fill to navy-raised; focus shows the single 2px cyan focus ring at 2px offset (keyboard only, via `:focus-visible`).
- **Ghost:** a mono link in nominal cyan with an arrow glyph, underline on hover.

### Chips

- **Style:** pill (999px), navy-panel fill, mono uppercase label, a status-colored dot or icon plus a text label.
- **State:** the dot and label color carry the tri-state (nominal / caution / breach) or inert; the chip never relies on color alone.

### Cards / Containers (panels)

- **Corner Style:** 8px radius.
- **Background:** translucent navy-panel over the base field.
- **Shadow Strategy:** none at rest (see Elevation); a status glow appears only to signal state.
- **Border:** a single hairline (#1c2a36); never nested, never a stack of identical bordered cards.
- **Internal Padding:** 16px.

### Inputs / Fields

- **Style:** navy-base fill, hairline border, 4px radius, ink-hi text.
- **Focus:** the shared 2px cyan focus ring, no color-only cue.
- **Error:** breach-text red plus an icon and message, never a red border alone.

### Navigation

- **Style:** a left command deck of mono labels; default ink-faint, hover ink-hi, active nominal cyan with a glow accent. Collapses to a native popover deck on mobile with a dimmed, slightly blurred backdrop.

### Signature Component: the tri-state status readout

The recurring atom of the whole system: a small unit of `glow + colored dot/icon + mono label` that encodes nominal, caution, breach, or inert. It appears as timeline nodes, leaderboard cells, coverage-board rows, and fleet-status lines. It is the reason the HUD reads as one system.

## 6. Do's and Don'ts

### Do:

- **Do** treat cyan / amber / red as a functional signal (nominal / caution / breach); always pair a glow with a label or icon.
- **Do** reserve red for an actual breach; mark not-measurable categories with the inert slate, never red.
- **Do** keep the three type roles measurably distinct: Reading sans prose at 17px, Instrument mono telemetry at 12 to 13px, Display focal numbers at 15px and up.
- **Do** size headlines in `cqi` against the content column, never `vw`.
- **Do** earn elevation: flat navy by default, a panel fill or glow only where hierarchy or state needs it.
- **Do** keep the OWASP 01 to 10 numbering; it is the real ASI taxonomy, an ordered sequence the reader needs.

### Don't:

- **Don't** ship the generic AI-generated dark dashboard: the uniform cyan-on-navy wash where nothing has hierarchy or register.
- **Don't** stack a tiny uppercase tracked eyebrow above every section; an eyebrow is voice only as one deliberate named kicker.
- **Don't** present the measured precision and recall as the generic hero-metric template (big number, small label, supporting stats); keep the numbers, drop the templated treatment.
- **Don't** use color-only status: a red glow with no label or icon is prohibited.
- **Don't** shrink prose to HUD size; a sentence a human reads is never Instrument-role telemetry.
- **Don't** build thin-border panel soup or nest cards; elevation is earned.
- **Don't** use em dashes in UI copy; use a period, a comma, or a colon.
