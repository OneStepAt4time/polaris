# ADR-0011: Multi-arch Docker builds on native runners

- **Status**: Accepted
- **Date**: 2026-05-19
- **Supersedes**: implicit QEMU-based emulation pattern in `.github/workflows/docker.yml` prior to PR #13
- **Charter ref**: §6 Tech Stack ("Build/dist"), §9 Roadmap (release cadence)

## Context

Until 2026-05-19, `.github/workflows/docker.yml` built `linux/amd64` and `linux/arm64` in a single `ubuntu-latest` job using `docker/setup-qemu-action` to emulate ARM. The emulated arm64 build took ~5 min while the dependency footprint was small.

PR #13 (ACP-A) added `@agentclientprotocol/claude-agent-acp@0.36.1`, which transitively pulls in `@anthropic-ai/claude-agent-sdk` — a large dependency. Under QEMU arm64 emulation the install + Astro build phase exceeded the GitHub Actions 6h job timeout and the run was force-cancelled. Without a fix every future PR touching `src/` or deps would risk the same outcome.

Two prerequisites converged on 2026-05-19:

1. **GitHub free arm64 Linux runners** (`ubuntu-24.04-arm`) are now generally available, but only without per-minute billing on **public** repositories.
2. The Polaris repo was flipped from private to public the same day. The CHARTER never required private; the early private setting was conservatism, not policy.

This unlocks native-runner multi-arch builds at zero cost.

## Decision

**Build each architecture on its own native runner; merge the manifest in a separate job.**

Layout:

- `build` job, matrix over `{platform=linux/amd64, runner=ubuntu-latest}` and `{platform=linux/arm64, runner=ubuntu-24.04-arm}`. Each job builds only its own platform.
- On pull requests both jobs build with `outputs: type=cacheonly` — no registry push, full build validation, both arches exercised on every PR that touches Docker-relevant paths.
- On pushes to `develop`, `main`, and `v*` tags, each job pushes a digest-only image (`push-by-digest=true`) and uploads the digest as an artifact.
- A `merge` job (`if: github.event_name != 'pull_request'`, `needs: build`) downloads both digests and creates the manifest list with the standard tag set (`v{X.Y.Z}`, `{X.Y}`, branch, `sha-*`, `latest`) using `docker buildx imagetools create`.
- Build cache is scoped per arch (`scope=amd64`, `scope=arm64`) so the two jobs do not invalidate each other.

QEMU is removed entirely. `docker/setup-qemu-action` no longer appears in the workflow.

## Consequences

**Positive:**

- arm64 build time drops from "6h timeout" to roughly the same as amd64 (native execution, no instruction translation). Total wall-clock per PR is now `max(amd64, arm64)` ≈ 5 min instead of `amd64 + emulated_arm64` ≈ 35+ min.
- PR feedback validates both arches on every relevant change — the Aegis-style "we'll catch arm64 problems at release time" trap is avoided.
- Cache hit rate improves: per-arch scopes eliminate cross-arch cache thrash that the unified scope used to cause.
- No moving parts beyond what `docker/build-push-action` already supports — this is the upstream-blessed multi-arch pattern.

**Negative:**

- The workflow is longer (one `build` matrix + one `merge` job vs. one monolithic job). Net +30 LOC in YAML, all boilerplate.
- The repo must remain public for the arm runner to stay free. Going back to private would force a fallback (e.g. amd64-only on PR, arm64 only on tag push, or self-hosted ARM runner). This trade is accepted: public is the long-term posture (see §1 below).
- `ubuntu-24.04-arm` is a relatively new image. If GitHub deprecates the label we revisit. Low-probability risk; the label is officially supported.

**Out of scope (not done in this ADR):**

- Migrating other workflows (CI Gate matrix) to native arm runners. The Gate already runs Linux/macOS/Windows and the arm story for non-Docker steps is independent. Reopen if observed CI latency justifies it.
- Adding more platforms (linux/arm/v7, linux/s390x). No user demand.

## Notes

§1 — On the repo going public: CHARTER §4 only said "Repo location: github.com/OneStepAt4time/polaris (private)". That was a deployment decision, not a policy commitment. Public posture is consistent with the MIT license already shipped, the public release cadence, and the absence of any private credentials in the tree (GitGuardian gate enforces this). The visibility change is logged here for traceability; no other ADR is required.
