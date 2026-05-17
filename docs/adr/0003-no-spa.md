# ADR-0003: Server-rendered HTML (Astro) + selective client islands

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 IN scope, §6 Tech Stack

## Context

Polaris's web UI must replicate CCMeter's information architecture (see [docs/ccmeter-parity.md](../ccmeter-parity.md) once written, and `CHARTER.md §5`):

- KPI banner (5 metrics)
- 4 GitHub-style heatmaps
- Project cards grid with sparklines
- Per-project drill-down view
- Time filter (1h / 12h / Today / week / month / all)
- Rate-limit toggleable view
- Settings panel (rename / merge / hide / star projects)

Three implementation approaches were considered:

1. **Full SPA (React / Vue / Svelte)** — Server is a JSON API; all rendering on client.
2. **Server-rendered (Astro / Fastify+templates)** — Server emits HTML; minimal-to-zero JS.
3. **Server-rendered + selective client islands (Astro islands)** — HTML server-rendered, isolated JS only where genuinely interactive.

Aegis chose Option 1. The dashboard grew to 366 files (1.9× the backend codebase) and introduced features (analytics, billing, routines, accessibility tour) that contradicted the self-hosted single-user positioning. The full-SPA mental model invited scope creep — every "small UI feature" was a new component tree, new global state, new test surface.

## Decision

**Polaris uses Astro for the web UI, with server-rendered HTML by default and selective client islands for genuinely-interactive widgets.**

- Static layout, KPI banner, project cards, time-filter buttons: server-rendered HTML, no JS shipped.
- Interactive widgets that benefit from client state (heatmap hover details, sparkline tooltips, live time-filter updates without page reload): isolated Astro islands using Svelte 5 or vanilla TypeScript.
- Charts via **uPlot** (~1.7 KB) or vanilla SVG. **No Recharts, no Chart.js, no ApexCharts** — they cost 10–100× the bundle.
- **No global state manager.** No Redux, no Zustand, no Pinia. Each island owns its state; cross-island coordination via DOM events if needed.

Target: initial JS payload for the dashboard ≤ 50 KB.

## Consequences

**Gains**
- Bounded JS bundle = fast initial paint, low memory, mobile-friendly.
- HTML-first means search-engine-friendly + screen-reader-friendly by default.
- Components testable in isolation (Astro renders to HTML in tests).
- SPA-pattern temptations (routing layer, deep component trees, suspense boundaries) are blocked by tech choice, not just by discipline.

**Trade-offs**
- Some "app-feel" interactions (e.g., optimistic UI on settings save) require more thought.
- Server has to render HTML on every navigation; mitigated by HTTP caching for read-only views.
- Learning curve for developers coming from React-only backgrounds.

**Risks accepted**
- A future feature may require more interactivity than islands can deliver cleanly. We will add a client island for it. We will **not** migrate to a full SPA. If multiple features need this, ADR-NNNN superseding this one.

## Reversibility

Cost to revoke (full SPA migration): **very high** — full UI rewrite, new build pipeline, new test approach. Procedural cost: write ADR-NNNN.

Cost to keep: **zero** — Astro is being adopted as our default.

One of the stickiest decisions in Polaris. Sticky-by-design.
