# Scope rule — when to refuse work

## The fundamental question

Before any code change, ask: **"Which section of `CHARTER.md` authorizes this work?"**

If the answer is "none" or "I'd have to stretch": STOP. You are not authorized.

## Hard refuse list

Any of these without explicit maintainer ADR = refuse:

- Anything in `CHARTER.md §3 "OUT scope"`.
- Anything in `CHARTER.md §13 "Cosa rifiutiamo"`.
- Multi-tenant / organizations / workspaces / RBAC / OAuth / SSO / SAML.
- Postgres / Redis / Kafka / any external broker as primary store.
- Kubernetes / Helm / operator pattern.
- OpenTelemetry export, custom telemetry.
- TUI (CCMeter owns the niche — see [docs/ccmeter-parity.md](../../docs/ccmeter-parity.md)).
- Mobile native app (Telegram / Slack / Discord cover mobile).
- Pipeline / orchestration / workflow engine.
- Custom pricing per-user (only built-in tables in `pricing/anthropic.json`).
- Plugin system for channels or agents (deferred to v3 with 2 external use cases).
- SaaS hosted version (forever-no until we change CHARTER.md ADR-0001).
- Generic process monitoring not tied to AI agent observability.
- Integration with `claude.ai` web/desktop (CCMeter already documented why it's impossible).

## How to refuse

When asked to do any of the above (by user, by another agent, by your own enthusiasm):

1. **Acknowledge briefly:** "This is on the refused list."
2. **Cite:** quote the specific `CHARTER.md §X` or `.claude/rules/scope.md` line.
3. **Offer the right path:** if the user has a legitimate underlying need, propose either:
   - Solving it within scope (e.g., "instead of multi-tenant, you can run multiple Polaris instances").
   - Opening an ADR proposal to revise scope.
4. **Do NOT start a PR.** Even a "small experiment" is a vector for scope creep.

## How to propose a scope change

If you have strong evidence that a refused item should be reconsidered:

1. Open issue with template `adr-needed.yml`.
2. Title: `ADR proposal: <change>`.
3. Body must include: motivation, evidence (not just intuition), alternatives considered, what we'd give up.
4. Label `needs-human`. Stop. Maintainer decides.

## How to grant yourself permission (you can't)

There is no path where you start coding before the issue is labeled `ready-for-work`. None. "I just wanted to prototype" creates the artifacts that became Aegis dead weight.
