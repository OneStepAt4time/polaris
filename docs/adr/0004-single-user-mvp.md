# ADR-0004: Single-user MVP, multi-user defer to v2

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 IN scope, §10 ADRs

## Context

Polaris v1.0 targets a solo developer running Polaris on their own machine to observe their own AI agent usage. Multi-user features carry significant baggage:

- User table + session management + login flow
- Per-user isolation everywhere (`user_id` foreign key, query scoping)
- Email/password or OAuth provider integration
- Password storage and reset
- MFA, account recovery, deactivation
- Admin/user role separation
- Audit trail per user
- GDPR-style personal data handling
- Email infrastructure for transactional messages

Aegis introduced an auth subsystem (`src/auth.ts`, RBAC manager, quota manager) targeting a multi-user future that hadn't shipped. The complexity was real; the value was speculative.

For Polaris v1.0, the user already has all the data on their machine — they don't need authentication to see their own data; they need a way to access the dashboard without random network strangers reading their cost/token history.

## Decision

**Polaris v1.0 has no concept of users.** Authentication is a single shared bearer token stored in the env var `POLARIS_AUTH_TOKEN`.

- All API requests and UI access require `Authorization: Bearer ${POLARIS_AUTH_TOKEN}` (or `?token=` query param for UI bootstrap).
- No user table, no session table, no password storage.
- All data belongs to "the operator" implicitly (the token holder).
- Settings (project renames, hides, stars) are per-instance, not per-user.

Multi-user is **deferred to v2**, at which point we will:
1. Add a `User` entity and `user_id` to relevant tables via a single migration with a default user for v1 data.
2. Choose an auth approach (likely email magic-link or local password — TBD by ADR at that time).
3. Add per-user settings, audit trail, and role separation only if requested by real users.
4. Write an ADR superseding this one.

## Consequences

**Gains**
- Trivially simple setup: one env var.
- No user management UI to build.
- No password security to get wrong (no hashing libraries, no rate-limited login endpoint, no leak responsibility).
- No GDPR personal-data handling for v1.
- No email infrastructure for transactional flows.

**Trade-offs**
- Team use requires running multiple Polaris instances or sharing one token (suboptimal — token sharing means no per-user audit).
- No per-user notification preferences in v1 (one Telegram chat, one Slack channel).
- v1 → v2 migration needs a one-time schema update with a default user assignment.

**Risks accepted**
- Token leakage = full access. Mitigated by:
  - Recommending the token live in `.env` or a secret manager, never in URLs or logs.
  - Token redaction in server logs (handled by middleware).
  - Documentation encouraging firewall / reverse-proxy auth as defense-in-depth.

## Reversibility

Cost to revoke (add multi-user in v2): **medium** — schema migration plus auth flow plus UI. Procedural cost: write ADR-NNNN.

Cost to keep (stay single-user): **zero**.

Reversible without trauma. The v2 schema migration is the most expensive piece, and we will design v1 schemas with v2 in mind (foreign-keyable IDs, even if v1 has no `User` table).
