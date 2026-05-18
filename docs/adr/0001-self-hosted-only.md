# ADR-0001: Self-hosted only, no SaaS in v1.0/v2.0

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 OUT scope, §13 refused list

## Context

The deployment model of Polaris determines everything downstream:

| Aspect | Self-hosted | SaaS |
|---|---|---|
| Auth | Single shared token | OAuth, sessions, MFA, recovery |
| Billing | None | Stripe, invoicing, dunning, tax |
| Compliance | None | Privacy policy, DPA, SOC2 trajectory |
| Operations | Zero (user runs it) | 24/7 oncall, scaling, multi-region |
| Cost to ship | Days | Months (infra, support staff) |

Aegis attempted to be both ("open core"). The dual model added abstractions for hypothetical SaaS use cases (multi-tenant primitives, billing scaffolding) that never shipped, and yet poisoned the self-hosted product with complexity tax.

Polaris targets a solo developer (v1) and a small team via multiple instances (v2). Neither requires SaaS infrastructure.

## Decision

**Polaris v1.0 and v2.0 are self-hosted only.** No cloud-hosted version, no managed Polaris service, no paid tier.

Distribution channels:
- Docker image, multi-arch: `linux/amd64`, `linux/arm64` on `ghcr.io/onestepat4time/polaris`.
- Single binary, per platform: Linux x64/arm64, macOS x64/arm64, Windows x64.
- npm package as a fallback for `npx polaris`.

User data lives on the user's machine in SQLite (see ADR-0002).

## Consequences

**Gains**
- Zero operational burden for maintainers.
- No compliance scaffolding required (no GDPR controller role, no SOC2 path, no DPA template).
- Auth is trivial (shared token, see ADR-0004).
- Time-to-MVP is weeks, not quarters.

**Trade-offs**
- Smaller addressable market (self-hosting requires a technically competent user).
- No recurring-revenue path within current scope.
- No "try-before-you-install" demo path; we must rely on screenshots and a Docker quickstart.

**Risks accepted**
- Competitors offering managed observability may outpace us in adoption. We bet on better v1 quality (CCMeter parity + multi-channel notifications) over breadth.

## Reversibility

Cost to revoke (move to SaaS): **high** — would require building auth, billing, multi-tenant data isolation, and 24/7 ops. Procedural cost: write ADR-NNNN superseding this one.

Cost to enter (stay self-hosted): **zero** — this is the default.

Sticky by virtue of inertia. The procedural override exists; the engineering override is months of work.
