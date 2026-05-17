# ADR-0009: Astro static build, Fastify serves the artifact

- **Status**: Accepted, refines ADR-0003
- **Date**: 2026-05-18
- **Charter ref**: §3 IN scope (Web UI), §6 Tech Stack

## Context

ADR-0003 chose Astro + selective client islands for the UI. ADR-0003 left the
implementation open: how does Astro render, and how is the result served?

Three implementation options were considered:

1. **Astro SSR via `@astrojs/node`** — Astro starts its own Node server. Polaris
   would need to either run two processes (Astro + Fastify), proxy from Fastify
   to Astro, or embed Astro's handler inside Fastify. Each path adds operational
   complexity and additional native processes / ports to coordinate.

2. **Astro middleware embedded in Fastify** — Astro 4+ exposes an SSR handler
   that can be invoked imperatively. No mature Fastify adapter exists; we'd be
   writing custom glue code and owning its compatibility against future Astro
   releases.

3. **Astro static build** — `astro build` with `output: 'static'` produces
   `dist/ui/*.html` + `dist/ui/_polaris/*.js,css`. Fastify serves the directory
   via `@fastify/static`. Dynamic data is fetched client-side from `/v1/metrics`
   (and other future endpoints).

## Decision

**For v0.1.0, Polaris uses option 3 (Astro static build, Fastify serves).**

Concretely:

- `astro.config.mjs` sets `output: 'static'` and `outDir: './dist/ui'`.
- `npm run build:ui` runs `astro build` and is wired into `npm run build`
  (which now does both UI + TS) and into `npm run gate` (before tests).
- `src/server.ts` registers `@fastify/static` rooted at the resolved project
  `dist/ui` directory, serving the SPA shell on `/`.
- Dynamic data: each Astro page fetches the relevant `/v1/*` endpoint
  client-side. Bearer token is held in `localStorage` (consistent with the
  shared-token auth model from ADR-0004).

## Consequences

**Gains**
- Single process, single Docker image, single port — no proxy.
- Build artifact is immutable HTML+JS — trivially cacheable / CDN-ready.
- Lower architectural complexity than embedded SSR.
- Faster cold-page render: the server doesn't render anything; the client
  parses HTML and fires a fetch.

**Trade-offs**
- No build-time data injection. Per-project pre-rendering won't be possible
  until/unless we move to SSR.
- Token-required pages show a brief loading flash before the first API call
  resolves. Acceptable for a self-hosted dev tool.
- Token persists in `localStorage`. Already true under ADR-0004; documented
  in the page's auth pane.

**Risks accepted**
- When the CCMeter-parity heatmaps land (M1), we may want SSR so the page can
  emit a single HTML payload with data pre-injected (faster perceived render
  for the heatmap, no second fetch). At that point we re-evaluate: SSR via
  `@astrojs/node` embedded vs. server-rendered string templates from Fastify
  (skipping Astro entirely). Either way, ADR-NNNN.

## Reversibility

Cost to revoke (move to SSR): **moderate**. Need to:
1. Add an Astro adapter (`@astrojs/node`).
2. Restructure server.ts to either spawn or embed the Astro handler.
3. Rewrite client-side data fetch as server-side data injection.

Roughly 1-2 days of focused work. Bounded.

Cost to keep: **zero**.

## Supersedes / Refines

Refines ADR-0003 (which chose Astro + selective islands but left runtime mode
open). Does not supersede ADR-0003 — the "selective islands" rule still
applies inside individual `.astro` pages.
