# MCProof — Product context

> Strategic "who / what / why" for the Impeccable design method (the site's START
> phase). Impeccable is the design method for all UI work here: an opinionated
> design partner that reads this file and DESIGN.md before every command and picks
> the brand-vs-product lane from the task cue and the register below. The visual
> "how it looks" lives in DESIGN.md and in the DTCG two-tier token system
> (primitives to semantic aliases) in `src/app/globals.css`.

## Register

product

## Platform

web

## Users

Security engineers, red-teamers, and AI-safety practitioners evaluating how robust an MCP-tool-using agent is against the OWASP Top 10 for Agentic Applications (2026). They arrive to run an evaluation and read the result under time pressure: launch a run, watch the attack replay, find the exact step where the agent was compromised, and export an engineer-ready fix. They value precision, reproducibility, and being able to trust the verdict at a glance.

## Product Purpose

Red-team an MCP agent against the Core-7 OWASP Agentic categories and make the outcome legible. Five surfaces carry the work: Run Setup (the targeting console), Live Attack Replay (the hero, a scrubbable step timeline with the compromise step badged and the detector rationale pinned), the Robustness Leaderboard (a per-model by per-category heatmap), Findings and fix-reports (case files), and Threat Model and Coverage (which of the ten OWASP categories are measured, with the Core-7 covered and ASI07/08/09 marked not-measurable). The UI renders observable data only; the held-out ground truth never reaches it (leakage separation). Success is an operator who launches a run, locates the compromised step, trusts the verdict, and leaves with a fix.

## Positioning

Bring your own MCP agent, live red-team it against the Core-7, and get a verdict from a detector whose accuracy was actually measured (leakage-separated precision and recall), not asserted. The single claim every screen reinforces: you can trust this verdict because the detector that produced it was measured against attacks with known outcomes.

## Brand Personality

A serious instrument, not a game. Internal name Sentinel Fields: a dark control-room base (dark navy, never pure black), thin glowing line-work, arc and ring motifs, translucent panels, and monospace (Geist Mono) technical readouts. Calm but alive; the interface breathes as a run replays. Confident, precise, understated. Mission control, not an arcade. The primary surface is product (the instrument screens); Home and Sign-in are the brand front door where design carries the message.

## Anti-references

- Gamified or arcade dashboards, score-celebration confetti, badges-for-everything.
- Gratuitous scanlines, CRT glitch, neon-for-neon's-sake, or motion that distracts from the readout.
- Color-only status: a red glow with no label or icon.
- Light-gray body text on a tinted near-white (the classic low-contrast failure).
- The generic AI-generated dark dashboard: the "dark SaaS admin" reflex, a look you could guess from the category alone.
- Thin-border panel soup: every element the same 1px-bordered card, and never nested cards. Elevation is earned.
- Uniformly small mid-grey text with no reading/instrument split, so prose shrinks to HUD size and everything reads as telemetry.
- The tiny uppercase tracked eyebrow above every section (Impeccable flags this as an AI tell, and we accept the fix: an eyebrow is voice only when it is one deliberate named kicker, never scaffolding on every section).
- The generic hero-metric presentation (a big number, a small label, supporting stats): the measured precision and recall numbers stay, the templated treatment does not.
- Em dashes: never in UI copy. Use a period, a comma, or a colon.

## Design Principles

- Tri-state status is the core signal: cyan (nominal), amber (caution/elevated), red (breach/compromise). This is a functional signal language, not decorative dark-mode glow, and it is a deliberate departure from Impeccable's "dark mode with glowing accents" tell that we keep and defend. Status is always glow plus a label and/or icon, never color alone. A fourth state, inert (neutral/muted), marks "not measurable" and is never red.
- Numbering is data, not scaffolding. The 01 through 10 labels are the real OWASP ASI codes (ASI01 to ASI10), an ordered taxonomy the reader needs, so they are voice rather than the AI "01 / 02 / 03" section-marker tell.
- Register shifts per surface: Home and Sign-in read brand (design carries the message, it may be expressive); Connect, Replay, Leaderboard, Findings, and Threats read product (legible, data-dense, the design serves the readout).
- Restrained-alive motion: a playhead sweep, nodes lighting as it passes, a soft glow-pulse on the active/compromise node, the verdict easing in. GPU-cheap transforms and opacity, CWV-safe. Serious, not gamified.
- Legibility first: monospace readouts, generous negative space, one clear focal point per screen (the compromise step on Replay, the worst cell on the Leaderboard). The HUD language carries across every screen so the tool reads as one system.

## Accessibility & Inclusion

WCAG 2.2 AA is non-negotiable. Body text at least 4.5:1, large text at least 3:1 against its surface. Status is conveyed by glow and a label or icon, never color alone. `prefers-reduced-motion` (and low-power / no-WebGL) resolves to a calm static fallback with no sweep or pulse. Full keyboard operation for play/pause/step/scrub, with correct roles and names for the timeline nodes and the verdict panel. Automated checks (`@axe-core/playwright` plus Lighthouse CI, and `/impeccable audit`) catch roughly 30 to 50 percent of issues; they are not a substitute for manual assistive-technology testing.
