# Polaris — Charter, Architettura e Regole di Sviluppo

> Charter di partenza. Scritto come farebbe una software house: vision, scope, architettura, stack, regole, roadmap, criteri di rilascio.
>
> **Decisioni locked (2026-05-17)**: nome = **Polaris**; repo GitHub = `OneStepAt4time/polaris` (private); UI = **solo web** (no TUI — CCMeter copre già il caso TUI).
>
> **Pivot (2026-05-18, ADR-0010)**: dopo il rilascio di v0.1.0 (observatory baseline, M0 chiuso), Polaris adotta **ACP** per diventare un **lean control plane**. Altri agenti, strumenti o umani possono delegare lavoro a Claude Code via API mantenendo la modalità interattiva multi-turn della TUI. Aegis vive in parallelo finché Polaris v1.0 non sostituisce la sua missione (ADR-0023 di Aegis), eseguita sotto la disciplina di Polaris.

---

## 1. Context (perché esistiamo)

**Aegis** (predecessore, stesso maintainer, repo privato separato) è risultato over-engineered su tre dimensioni confermate da audit parallelo il 2026-05-17:

| Dimensione | Evidenza |
|---|---|
| Over-build | Dashboard 366 file (1.9× del backend), `src/pipeline.ts` orchestrazione che contraddice ADR-0023, Redis coordination half-wired (25k LOC scollegate dallo store), OTel dual exporter, `postgres-profile.ts` mai istanziato. |
| Rotture | 8 test falliti su Windows, dashboard 404 (#3609), MCP wiring bug (#3614), `release.yml` modificato non committato + 4 fallimenti recenti. |
| Scope drift | "Bridge not orchestrator" dichiarato → ma pipeline.ts, billing scaffolding, Phase 4 multi-tenant pianificato. |

**Decisione (2026-05-17)**: Aegis va avanti per conto suo. Si parte un nuovo progetto, **Polaris**, con scope brutale e tutte le lezioni applicate.

**Polaris è ispirato a CCMeter** (https://github.com/hmenzagh/CCMeter, MIT, Rust+ratatui, 107★): TUI dashboard che parsa i JSONL di Claude Code e mostra token/costi/code-metrics/rate-limit. Polaris porta lo **stesso modello informativo** in una **web UI accessibile remotamente**, aggiunge **notifiche multi-canale** (Telegram + Slack + Discord) e **supporto multi-agente** (Claude Code v1, altri in v2).

---

## 2. Product Vision

**One-liner (it)**: Polaris è il **control plane self-hosted dei tuoi agenti AI** — altri agenti, strumenti o umani delegano lavoro a Claude Code (e in futuro Codex / Gemini CLI) attraverso Polaris come se aprissero la TUI dell'agente, con approval handshake e multi-turn nativi via ACP, e una dashboard web mostra token, costi, rate-limit e attività live di tutte le sessioni.

**One-liner (en)**: Polaris — self-hosted lean control plane for your AI coding agents. Delegate via API, monitor live.

**Target user**:
- **v0.1**: developer solo che vuole observability dei propri agenti Claude Code (token, costi, rate-limit) da una web UI accessibile remotamente.
- **v0.3-v0.5**: + altri agenti AI o strumenti che vogliono usare Claude Code come "vibe coder" via API, con multi-turn + approval handshake che riproducono l'esperienza interattiva della TUI.

**Differenze rispetto a CCMeter e ad Aegis** (perché esiste Polaris):

| Aspetto | CCMeter | Aegis | Polaris (v0.5+) |
|---|---|---|---|
| UI | TUI local | Dashboard SaaS-style 366 file | Web UI server-rendered ispirata a CCMeter |
| Control plane (lanciare agenti) | No | Sì (1175 LOC `AcpBackend` god-object) | Sì (lean ACP in 4 file ≤200 LOC ciascuno) |
| Approval handshake | No | Sì (con persistence cross-restart, driver control, pause) | Sì (in-memory only, no driver / pause / restart-backoff) |
| Notifiche | No | Telegram + Slack + Email + Webhook (5 canali con registry) | Telegram + Slack + Discord + Webhook (funzioni concrete, no registry) |
| Agenti supportati | Claude Code only | Claude Code via ACP | Claude Code via ACP in v1; multi-agent v2 |
| Dato persistito | `~/.config/ccmeter/history.json` | Postgres pluggable (mai usato) + Redis half-wired | SQLite singolo file |
| Deployment | Binary locale | Self-hosted con Phase 4 multi-tenant pianificato | Self-hosted single-user only (ADR-0001, 0004) |
| LOC backend | ~10k Rust | 189 file TS + 366 file dashboard | 8000 LOC ceiling totale, attualmente ~1000 |

**Posizionamento concreto**:
- Polaris **converge sulla missione di Aegis** (ADR-0023 "control plane of Claude Code") ma con disciplina anti-over-engineering applicata da subito.
- Polaris **non sostituisce CCMeter**: per analytics TUI locale CCMeter resta superiore. Polaris vince quando serve delegazione programmatica + accesso remoto.
- Polaris **sostituirà Aegis** quando raggiungerà feature parity (v0.5) + stabilità (v1.0). Fino a quel momento Aegis vive in parallelo (il maintainer ha un team di agenti 24/7 su Aegis che migra gradualmente a Polaris).

**Comparabili (per posizionarsi)**:
- **CCMeter** — TUI Claude Code analytics. Inspirazione visiva diretta per la dashboard.
- **Aegis** (predecessore) — stessa missione control plane, ma over-engineered. Polaris è la versione lean.
- **Helicone / Langfuse** — LLM observability ma SaaS-first e B2B.
- **claude-usage / ccusage CLI** — CLI tool view-only, no delegation, no notifiche.

---

## 3. Scope (refined by ADR-0010 il 2026-05-18)

### IN scope per v1.0 (Beta)

**Observatory layer** (v0.1 ✅, baseline rilasciata):
- **Data ingest**:
  - JSONL parser per `~/.claude/projects/**/*.jsonl` (sessions Claude Code).
  - Streaming + dedup per `requestId` come fa CCMeter (ADR-0007).
  - File watcher su `~/.claude/projects/` per ingest live (v0.2).
  - Polling OAuth `/api/oauth/usage` per rate-limit tracking (futuro, dopo v0.5).
- **Metriche calcolate** (parità con CCMeter ±1%):
  - Token (input, output, cache) per modello (Opus, Sonnet, Haiku).
  - Costi USD via pricing table built-in (`pricing/anthropic.json`).
  - Lines suggested/accepted/added/deleted + acceptance rate (futuro, dopo v0.5).
  - Active time estimation per progetto (futuro).
  - Efficiency score (token/line) (futuro).
- **Web UI** (ispirata a CCMeter):
  - KPI banner: cost totale, events, input/output/cache tokens.
  - Time-range tabs (today, 7d, 30d, all).
  - Per-model breakdown.
  - Heatmaps + project cards + per-project detail (futuro, dopo v0.5).

**Control plane layer** (v0.3-v0.5, formalizzato da ADR-0010):
- **ACP runtime** via `@agentclientprotocol/claude-agent-acp`:
  - Spawn `claude-agent-acp` child process per session.
  - JSON-RPC client wrapper per request/response correlation.
  - 4 file flat in `src/acp/`, ognuno ≤200 LOC (anti-Aegis-god-object).
- **Session lifecycle API**:
  - `POST /v1/sessions` create.
  - `POST /v1/sessions/:id/messages` send prompt → SSE stream eventi.
  - `POST /v1/sessions/:id/approve` rispondi ad approval request.
  - `DELETE /v1/sessions/:id` cancel.
  - `GET /v1/sessions` list attive.
- **Approval workflow**:
  - In-memory only, no persistence cross-restart.
  - Timeout configurabile, default deny.
  - SSE emette `needs_approval` event al caller.
- **Multi-turn conversation** + **session resume** (limitato a singolo processo Polaris; multi-instance fuori scope).

**Trasversale**:
- **Notifiche**:
  - Trigger: cost-threshold superato, rate-limit approaching (>80%), session failed (futuro).
  - Canali: Telegram, Slack, Discord, Webhook (funzioni concrete, no plugin registry — ADR-0005).
- **Auth**: shared token via env `POLARIS_AUTH_TOKEN` (ADR-0004).
- **Storage**: SQLite singolo file (ADR-0002).
- **Distribuzione**: Docker image multi-arch (linux/amd64 + linux/arm64) su GHCR.

### OUT scope (esplicito; aggiornato 2026-05-18)

**Hard NO (forever)** — pathologies that destroyed Aegis:
- Driver control (claim/release/transfer ownership cross-istanza).
- Pause/resume intervention mid-session.
- Restart backoff esponenziale (child crash = session dies, caller retries).
- Multi-instance Redis coordination.
- Pluggable session storage con N backend (ADR-0002).
- `AgentAdapter` interface con 1 sola impl (ADR-0005 / ADR-0008).
- Approval persistence cross-restart.
- Orchestrazione / pipeline / DAG / workflow engine.
- `AcpBackend` god-object (lezione Aegis: 4 file flat, no monolite).

**NO in v1.0** (deferred, eventualmente in v2+):
- SaaS / cloud hosting / billing / Stripe.
- Multi-tenant / organizations / workspaces.
- Multi-user / RBAC / OAuth / SSO.
- Multi-agent (Cursor / Codex CLI / Gemini CLI) — il primo backend non ACP, se mai, richiede ADR.
- Plugin system per channel custom o agent custom.

**NO comunque**:
- Postgres, Redis, Kubernetes, Helm chart.
- OpenTelemetry export.
- TUI Polaris (CCMeter occupa quella nicchia).
- Mobile native app (Telegram/Slack/Discord coprono mobile).
- Integrazione con Anthropic Console / claude.ai (limite tecnico, CCMeter già lo nota).
- Cost tracking custom oltre i modelli supportati nel pricing table.

---

## 4. Naming (LOCKED)

**Nome: Polaris** (stella polare).
- 7 lettere, pronunciabile internazionalmente in inglese e italiano.
- "Polaris" = stella polare = punto di riferimento centrale e fisso → fit perfetto per "centro stella di monitoraggio".
- Si presta a tagline: *"Your fixed point on your agents."*

**Repo location (LOCKED)**: `github.com/OneStepAt4time/polaris` (private). Disponibilità verificata 2026-05-17.

**Conflitti noti**:
- **Apache Polaris** è un *data catalog* (dominio diverso, marketing OK con disambiguation).
- **Shopify Polaris** è un design system. Conflitto marketing futuro; nostro repo è dev tool, OK in self-hosted niche.

**Checklist npm/domain (da fare prima di v0.1.0 release pubblica)**:
- [ ] npm: `polaris` quasi certamente taken — fallback `@onestepat4time/polaris` o `polaris-meter`, `polaris-cli`, `polaris-watch`.
- [ ] Domain (opzionale per OSS): `polaris.dev`, `getpolaris.com`, `usepolaris.io`.
- [ ] Logo/icona: stella stilizzata (5-punte o North Star design).

---

## 5. Architettura

```
                  ┌─────────────────────────────────────────────────────┐
                  │   Data sources (locali al server o pushed)          │
                  │  ~/.claude/projects/**/*.jsonl  ←  watch + ingest   │
                  │  Anthropic /api/oauth/usage     ←  poll (5–10 min)  │
                  └────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────────────────┐
                  │            Polaris server (single binary)           │
                  │                                                     │
                  │  Ingest layer                                       │
                  │   ├─ JSONLWatcher        (fs.watch, debounced)      │
                  │   ├─ JSONLParser         (streaming, dedup by reqId)│
                  │   └─ OAuthPoller         (async, randomized cadence)│
                  │                       │                             │
                  │                       ▼                             │
                  │  Metrics layer                                      │
                  │   ├─ TokenAggregator     (per-model, daily/minute)  │
                  │   ├─ CostCalculator      (pricing tables built-in)  │
                  │   ├─ ActivityEstimator   (active-time + lines)      │
                  │   ├─ EfficiencyScorer    (tok/line + quartiles)     │
                  │   └─ RateLimitTracker    (5h/7d/Opus/Sonnet/Cowork) │
                  │                       │                             │
                  │                       ▼                             │
                  │  Storage (SQLite)                                   │
                  │   tables: sessions, events, daily_aggregates,       │
                  │           rate_history, notifications_sent          │
                  │                       │                             │
                  │            ┌──────────┴──────────┐                  │
                  │            ▼                     ▼                  │
                  │  Rule engine            Web UI (Astro SSR + islands)│
                  │   ├─ cost-threshold      ├─ Dashboard (KPI+heatmap) │
                  │   ├─ rate-limit-near     ├─ Project cards/detail    │
                  │   ├─ session-failed      ├─ Rate-limit view         │
                  │   └─ daily-summary       └─ Settings panel          │
                  │            │                                        │
                  │            ▼                                        │
                  │  Notification dispatcher                            │
                  │   ├─ Telegram   ├─ Slack    ├─ Discord              │
                  │   ├─ Webhook    └─ Email (opzionale M2)             │
                  └─────────────────────────────────────────────────────┘
```

**Strati (4 layer, niente di più):**
1. **Ingest** — watch filesystem + poll OAuth, deduplicate, normalize in event stream.
2. **Metrics** — compute aggregati (per-model, per-project, per-time-window) e li scrive su SQLite.
3. **Surface** — Web UI server-rendered + Rule engine + Notification dispatcher.
4. **Storage** — SQLite (con possibilità di S3/disk backup di file `.db`).

**Regole anti-Aegis applicate**:
- Nessuna astrazione (interface, factory, registry) prima che esistano 2 implementazioni reali.
- Multi-agent in v2: in v1 hardcoded Claude Code, niente "AgentAdapter" interface prematuro.
- Web UI = server-rendered con selettivo client-side (Astro islands). NON SPA React/Vue/Svelte intero.

---

## 6. Tech Stack

| Layer | Scelta | Motivo |
|---|---|---|
| Language | **TypeScript** (Node 22 LTS) | Maintainer comfort zone (Aegis), ecosistema maturo. Migrare a Go/Rust in v2 solo se distribution diventa pain. |
| HTTP server | **Fastify v5** | Conosciuto, performante. No Express. |
| DB | **SQLite via better-sqlite3** | Self-hosted single-user: zero ops. Backup = copia file. Migrations inline. |
| Web UI | **Astro** + selective **client islands** (Svelte 5 o vanilla TS) | Server-rendered di default (anti-Aegis-SPA), client-side solo per widget interattivi (heatmap, sparklines, filtri live). NON un SPA intero. |
| Charts/sparklines | **uPlot** (1.7 KB, fastissimo) o SVG vanilla | uPlot fa miracoli con poco. Niente Recharts/Chart.js (pesanti). |
| Heatmap | CSS Grid + dataset inline | CCMeter usa caratteri ASCII; in HTML basta CSS Grid con celle colorate via opacità → 30 righe di codice. |
| JSONL parser | Custom streaming (no full file in memory) | File possono essere grossi. Stream → dedup per `requestId` → event emit. |
| OAuth poll | `undici` (HTTP client Fastify-native) | Già transitivo via Fastify. |
| Notification | Adapter functions, no plugin registry | Telegram: `node-telegram-bot-api`. Slack/Discord: webhook HTTP plain. Email: `nodemailer`. |
| Build/dist | **Bun build --compile** + Docker multi-arch | Single binary per piattaforma. |
| Test | **Vitest** | Stesso Aegis. |
| Lint/format | **Biome** | Singolo tool, no ESLint sprawl. |
| CI | **GitHub Actions** | Matrix Linux+macOS+Windows. |
| Release | **Release Please** | Auto-changelog da Conventional Commits. |

**Decisione critica giustificata**: TypeScript invece di Rust (CCMeter è Rust). Motivo: maintainer non conosce Rust, time-to-MVP > performance teorica. Server JSONL parsing in TS è abbastanza per single-user (anche 10k sessioni si parsano in <2s in streaming).

---

## 7. Repository Structure

```
polaris/
├── README.md                  # 1 pagina: pitch + install + quickstart
├── CHARTER.md                 # questo file
├── ARCHITECTURE.md            # 1 pagina: diagram + strati
├── CONTRIBUTING.md            # 1 pagina: regole sviluppo
├── LICENSE                    # MIT
├── package.json
├── tsconfig.json
├── biome.json
├── astro.config.mjs           # Astro setup
├── .github/workflows/
│   ├── ci.yml                 # tsc + biome + vitest + build matrix
│   └── release.yml            # tag → binaries + Docker + npm
├── src/
│   ├── server.ts              # Fastify app entry, route mounting
│   ├── config.ts              # env vars (≤12, ognuno con why)
│   ├── db.ts                  # SQLite setup, migrations inline
│   ├── ingest/
│   │   ├── jsonl-watcher.ts   # fs.watch su ~/.claude/projects
│   │   ├── jsonl-parser.ts    # streaming + dedup by requestId
│   │   └── oauth-poller.ts    # /api/oauth/usage polling
│   ├── metrics/
│   │   ├── token-aggregator.ts
│   │   ├── cost-calculator.ts # pricing tables Anthropic
│   │   ├── activity-estimator.ts
│   │   ├── efficiency-scorer.ts
│   │   └── rate-limit-tracker.ts
│   ├── rules/
│   │   ├── cost-threshold.ts
│   │   ├── rate-limit-near.ts
│   │   ├── session-failed.ts
│   │   └── daily-summary.ts
│   ├── channels/
│   │   ├── telegram.ts
│   │   ├── slack.ts
│   │   ├── discord.ts
│   │   ├── webhook.ts
│   │   └── email.ts           # M2
│   ├── ui/
│   │   ├── pages/             # Astro pages: index, project, settings
│   │   ├── components/
│   │   │   ├── KpiBanner.astro
│   │   │   ├── Heatmap.astro          + heatmap.client.ts (island)
│   │   │   ├── ProjectCard.astro
│   │   │   ├── Sparkline.svelte       (client island, uPlot)
│   │   │   ├── TimeFilter.astro       + filter.client.ts
│   │   │   └── RateLimitView.astro
│   │   └── styles/
│   │       └── theme.css      # dark-first, color tokens
│   └── __tests__/
├── docs/
│   ├── adr/                   # 8 ADR Day-1 (vedi §10)
│   ├── user-guide.md
│   ├── ccmeter-parity.md      # checklist parity CCMeter feature-by-feature
│   └── pricing-tables.md      # come/quando aggiornare prezzi modelli
├── pricing/
│   └── anthropic.json         # pricing table versionata
└── examples/
    ├── docker-compose.yml
    └── systemd/polaris.service
```

**Ceiling target**: ≤8000 LOC totali a v1.0. Sforatura = refactoring obbligatorio.

---

## 8. Development Rules

### 8.1 Commit Conventions
Conventional Commits: `fix:` patch / `feat:` minor / `feat!:` major. Decision tree:

```
fix bug                          → fix:
improve speed/memory             → perf:
restructure (no behavior change) → refactor:
tests only                       → test:
CI/build/deps only               → ci: or chore:
docs only                        → docs:
new user-visible feature         → feat:
```

`feat:` richiede review esplicita (anche solo da te a te stesso) per evitare minor bump immotivati.

### 8.2 Branching
```
feature/<short-name> → develop → release/<v> → main → tag
```
- PR sempre verso `develop`, mai verso `main`.
- Solo-mode: self-merge OK. Quando arriva un secondo contributor: review obbligatoria.

### 8.3 PR rules
- Max **400 LOC** changed per PR.
- Quality gate obbligatorio: `npm run gate` = `tsc --noEmit && biome check && vitest run`.
- PR body con `Closes #<n>` se chiude issue.
- No PR con CI rosso.

### 8.4 Coding rules
- **No `any`** → `unknown` + type guards.
- **No abstrazioni speculative** → 1 impl = funzione concreta. Aspetta la 2a.
- **Pricing tables versionate** in `pricing/anthropic.json`, con changelog. Niente hardcode in metrics/.
- **Dipendenze**: max **20** runtime dependencies.
- **Env vars**: max **12**. Ogni nuovo richiede 1-line why in `config.ts`.
- **No commenti se non spiegano WHY non-ovvio**.

### 8.5 Testing
- Unit test su `metrics/*` con coverage ≥80% (è il cuore: dedup, pricing, efficienza).
- Unit test su `ingest/jsonl-parser.ts` con fixture JSONL reali (anonimizzate, ~5 fixture).
- Integration test via HTTP (boot server, simulate JSONL append, GET /v1/metrics).
- UI: manuale finché v1.0; Playwright opzionale M2.

### 8.6 Releases
- SemVer rigoroso.
- Release Please.
- Artifacts per tag: Docker multi-arch + binary (Linux/macOS/Windows) + npm.

### 8.7 Pricing tables
- File `pricing/anthropic.json` versionato in repo.
- Quando Anthropic cambia prezzi → PR dedicata che aggiorna il file + nota in CHANGELOG.
- Polaris carica il file all'avvio; cache aggregati non viene invalidato (storico mostra prezzo del momento).

---

## 9. Roadmap (riscritta da ADR-0010 il 2026-05-18)

Polaris ha completato la baseline observatory in v0.1.0 e ora costruisce il control plane via ACP. Sei tappe di rilascio chiare, ognuna con scope brutalmente limitato.

### v0.1.0 ✅ — Observatory baseline (M0, 2026-05-17→18)

JSONL ingest + dedup `requestId` + SQLite + `GET /v1/metrics` + Astro static UI + Docker multi-arch GHCR. 9 ADR Day-1, 6 PR mergiati, 6 trappole Aegis catturate da CI, zero rollback. 934 / 8000 LOC src/.

### v0.2.0 — File watcher (target: 1 settimana dopo v0.1.0)

Goal: ingestione passiva live, complementare ad ACP.

- [ ] `src/ingest/jsonl-watcher.ts` con `fs.watch` su `~/.claude/projects/**/*.jsonl`.
- [ ] Debounced re-parse per file appendati.
- [ ] Integrazione con il parser+dedup già esistente.
- [ ] Test: append a un file fixture mid-test, verify event in DB entro 2s.

**Exit v0.2**: Polaris ingesta in <5s eventi JSONL appendati a sessioni live di Claude Code che girano fuori da Polaris.

### v0.3.0 — ACP-A: client wrapper + spawner (target: 2 settimane dopo v0.2)

Goal: Polaris sa parlare ACP a `claude-agent-acp`.

- [ ] Dipendenza `@agentclientprotocol/claude-agent-acp` aggiunta in runtime deps.
- [ ] `src/acp/spawner.ts` — spawn child process, signal handling, exit code cleanup (~80 LOC).
- [ ] `src/acp/json-rpc-client.ts` — JSON-RPC request/response correlation, AsyncIterator per event stream (~120 LOC).
- [ ] Test con fixture replay (registra ACP traffic reale, replaya in test).

**Exit v0.3**: `npm test` mostra Polaris che apre una sessione ACP fittizia, manda prompt, riceve eventi. No HTTP API ancora.

### v0.4.0 — ACP-B: session manager + HTTP API (target: 2 settimane dopo v0.3)

Goal: Polaris espone le sessioni ACP via REST.

- [ ] `src/acp/session-manager.ts` — Map<sessionId, Handle> + persistence metadata su SQLite + cleanup on close (~200 LOC totali con tipi).
- [ ] Routes: `POST /v1/sessions`, `DELETE /v1/sessions/:id`, `GET /v1/sessions`.
- [ ] Auth via `POLARIS_AUTH_TOKEN` (ADR-0004).
- [ ] Test integration: `app.inject` apre sessione, simula response ACP, verify state.

**Exit v0.4**: `curl POST /v1/sessions` apre una vera sessione Claude Code via ACP; `curl GET /v1/sessions` la lista; `curl DELETE` la chiude.

### v0.5.0 — ACP-C: approval workflow + SSE (target: 2 settimane dopo v0.4)

Goal: **feature parity con Aegis ADR-0023**, in lean form.

- [ ] `POST /v1/sessions/:id/messages` → ritorna SSE stream eventi.
- [ ] Approval handshake: agent richiede tool use → server emette `needs_approval` su SSE → caller POST `/v1/sessions/:id/approve {accept: true|false}`.
- [ ] Timeout approval configurabile (default: deny dopo N minuti).
- [ ] UI Astro aggiornata: lista sessioni attive + tab per inviare prompt + auto-render approval prompt.
- [ ] Documentation: "use Polaris as an ACP delegation runtime from your AI agent".

**Exit v0.5**: un altro agente AI può fare via HTTP esattamente quello che farebbe aprendo `claude` in un terminale. Approval, multi-turn, resume. Aegis ADR-0023 raggiunto in ~1500 LOC totali src/ (vs Aegis stesso).

### v1.0.0 — Stabilization + Aegis archive decision (target: 1-2 mesi dopo v0.5)

Goal: prima validazione esterna seria, ≥5 utenti self-hosted, decisione su Aegis.

- [ ] Performance budget: 100 sessioni concorrenti, 10k eventi/giorno, p99 query < 100ms.
- [ ] Email notification adapter (`nodemailer`) — il 5° canale.
- [ ] Retention/pruning automatico per `events` table.
- [ ] User guide + install guide + comparison docs (vs CCMeter, vs Aegis).
- [ ] **Aegis archive decision**: se Polaris stabile + il team agenti 24/7 del maintainer ha migrato, archivia Aegis ufficialmente.

**Exit v1.0**: Polaris in produzione su ≥5 setup esterni, Aegis archivable (decisione esplicita), tag `v1.0.0` su main.

### Post-v1.0 (deferred, ognuno richiede ADR + evidence)

- Multi-agent (Cursor / Codex CLI / Gemini CLI) — primo backend non-ACP forse problematico.
- Rate-limit OAuth polling (CCMeter-style live rate-limit view).
- Heatmaps + project cards CCMeter-parity nella UI.
- Plugin system per channel custom (se ≥2 use case esterni reali).

---

## 10. ADR Day-1 (da scrivere PRIMA di codice production)

Ogni ADR: 1 pagina max, formato Context / Decision / Consequences.

1. **ADR-0001 — Self-hosted only, no SaaS in v1.0/v2.0.** Motivo: zero costo operativo, focus prodotto.
2. **ADR-0002 — SQLite as primary (and only) storage in v1.0.** No Postgres, no Redis. Lezione Aegis.
3. **ADR-0003 — Server-rendered HTML (Astro) + selective client islands, no full SPA.** Lezione Aegis dashboard.
4. **ADR-0004 — Single-user MVP, multi-user defer to v2.** Auth = singolo token via env.
5. **ADR-0005 — No abstractions before 2 implementations exist.** Lezione Aegis.
6. **ADR-0006 — 8000 LOC ceiling per v1.0.** Misurato. Sforatura = refactoring prima di nuove feature.
7. **ADR-0007 — JSONL dedup strategy: by `requestId` (Anthropic billing unit).** Replica logica CCMeter.
8. **ADR-0008 — Multi-agent adapter pattern DEFERRED a v2.** In v1 il parser è hardcoded per formato Claude Code JSONL.

---

## 11. Verifica end-to-end (per ogni release)

```bash
# 1. Boot con dati reali
./polaris --port 3000 --token test123 \
       --db /tmp/polaris.db \
       --jsonl-dir ~/.claude/projects &

# 2. Wait initial parse, query metrics
sleep 5
curl -H "Authorization: Bearer test123" \
     http://localhost:3000/v1/metrics | jq .total_cost_usd

# 3. Verifica parità con CCMeter (manuale)
ccmeter   # confronta KPI banner totali
# Polaris UI: http://localhost:3000   confronta cost/tokens/efficiency

# 4. Genera evento (touch un JSONL), verifica detection
echo '{"requestId":"test-123","model":"claude-sonnet-4","input_tokens":1000,"output_tokens":500}' \
  >> ~/.claude/projects/test-proj/test-session.jsonl
sleep 3
curl http://localhost:3000/v1/events | jq '.[0].requestId'  # → "test-123"

# 5. Trigger rule (cost threshold), verifica notifica
# (manuale: imposta soglia bassa, fai pingare Telegram)

# 6. Rate-limit view
curl -H "Authorization: Bearer test123" \
     http://localhost:3000/v1/rate-limits | jq .
```

Vitest deve coprire (target ≥80% su `src/metrics/` e `src/ingest/`):
- Dedup correctness: 3-source duplicato JSONL → 1 evento, non 3.
- Cost calculation: input+output+cache tokens → USD usando pricing table.
- Activity estimation: minuti attivi vs gap nelle sessioni.
- Efficiency score: token/line + quartile gauge.
- Rate-limit forecast: estrapolazione lineare da velocity recente.
- HTTP auth (401 senza token).

---

## 12. Criteri di rilascio (per ogni versione)

**v0.1.0 ✅ (2026-05-18)** — observatory baseline. Criteri originali soddisfatti:
- ✅ Docker image multi-arch su GHCR (`ghcr.io/onestepat4time/polaris:0.1.0`).
- ✅ JSONL ingest via `POST /v1/ingest` con dedup `requestId`.
- ✅ Web UI mostra: KPI banner, per-model table, time filter.
- ✅ `npm run gate` passa su Linux + macOS + Windows.
- ✅ Budgets: 934 / 8000 LOC, 5 / 20 deps, 4 / 12 env vars.
- ✅ 61 test passati, no skipped, no mocked SQLite.
- ⚠️ Differiti a release future (non bloccanti per v0.1.0): heatmap GitHub-style, project cards, rate-limit view (post-v0.5); parità ±1% su dataset reale (verifica utente); Telegram integration (verrà nei rilasci dopo v0.5).

**v0.2.0+** — ogni release deve passare:
1. `npm run gate` verde su Linux + macOS + Windows.
2. Docker multi-arch su GHCR.
3. README quickstart copy-paste funzionante con il tag della versione.
4. Tutti i ceiling rispettati (8000 LOC, 20 deps, 12 env vars).
5. ADR scritto per ogni decisione architetturale nuova prima del codice.
6. PR template compilato, anti-Aegis checklist al 4/4.

Se uno solo manca: NON si rilascia, si itera.

---

## 13. Cosa rifiutiamo (lista citabile nei refiuti di issue/PR)

Se qualcuno (incluso il maintainer in un momento di debolezza) propone uno di questi senza nuova evidenza forte:

**Hard NO forever (anti-Aegis hard line)**:
- Driver control multi-istanza (claim/release/transfer di session ownership).
- Pause/resume intervention mid-session.
- Restart backoff esponenziale (crash = session dies, caller retries).
- `AcpBackend` god-object o equivalente — ACP DEVE rimanere in 4 file flat ≤200 LOC ciascuno (ADR-0010).
- Approval persistence cross-restart.
- Pipeline / orchestration / workflow engine.

**NO in v1.0** (deferred, eventualmente ADR + evidence):
- Multi-tenant / organizations / workspaces.
- SaaS hosted version.
- OAuth / SSO / OIDC / SAML.
- Postgres / Redis / Kafka / qualunque broker come storage primario.
- Kubernetes / Helm chart / operator.
- OpenTelemetry export.
- Mobile native app.
- Multi-agent (Cursor / Codex CLI / Gemini CLI) — primo backend non-ACP è candidato ad ADR dedicato.
- Plugin system per channel custom (in v3 forse, con due use-case esterni reali).

**NO comunque**:
- TUI Polaris (CCMeter occupa la nicchia).
- Generic process monitoring (Polaris è specifico per AI agent observability + control plane).
- Integrazione con claude.ai web/desktop (limite tecnico, CCMeter già nota).
- Custom pricing (oltre i modelli supportati nel pricing table).

Idea unavoidable → apri issue `needs-human`, NON iniziare PR.

---

## 14. Next steps (immediati dopo bootstrap)

1. **CCMeter deep-dive tecnico**: clonare CCMeter localmente, leggere `src/data/parser.rs` e `src/data/tokens.rs` per capire dedup logic in dettaglio (servirà a `src/ingest/jsonl-parser.ts`).
2. **Scrivere gli 8 ADR Day-1** (§10) in `docs/adr/`.
3. **Snapshot pricing table** in `pricing/anthropic.json` (copia da CCMeter `src/data/models.rs`).
4. **Bootstrap M0** secondo §9: `package.json`, `tsconfig.json`, Astro setup, Fastify server, SQLite schema, primo JSONL parser.

---

## 15. Cosa studiamo da CCMeter / Aegis

**Da CCMeter (studio + adattamento)**:
- `src/data/parser.rs` — algoritmo dedup `requestId`, gestione `/compact` retry, sub-agent transcripts.
- `src/data/tokens.rs` — daily aggregation logic.
- `src/data/models.rs` — pricing table struttura (copiamo i numeri).
- `src/data/oauth.rs` — OAuth credential loading + `/api/oauth/usage` polling cadence.
- `src/ui/heatmap.rs` — quartile coloring logic (verde→giallo→rosso).
- `src/ui/cards/` — info architecture per-project card.
- `assets/dashboard.png` + `assets/project.png` + `assets/rate-tracking.png` — riferimento visivo per UI mockup.

**Da Aegis (pattern OK da riusare come reference)**:
- `src/auth.ts` — token auth da env var.
- `src/config.ts` — env vars pattern (con tetto di 12 stavolta).
- `src/channels/telegram-channel.ts` — Telegram bot integration.
- `src/channels/slack-channel.ts` — Slack webhook.
- `src/__tests__/*` — Vitest setup.

**Da Aegis (STUDIO con cautela, post-ADR-0010)** — l'ACP wrapper di Aegis è scar tissue da studiare per capire i fail modes, NON da copiare:
- `src/services/acp/json-rpc-client.ts` (696 LOC) — studiare correlazione request/response, timeouts, abortion handling; **NON copiare** la dimensione monolitica.
- `src/services/acp/child-process.ts` — studiare signal handling e stdio piping; replicare in ~50 LOC, non i 318 originali.
- `src/services/acp/backend.ts` (1175 LOC) — studiare COSA NON FARE: god-object, driver control, pause interventions, restart backoff. Polaris implementa solo session lifecycle + approval handshake, ognuno in file separato.

**NON riusare da Aegis**:
- `src/pipeline.ts` — out of scope (Aegis stesso ammette in ADR-0023 che contraddice "bridge not orchestrator").
- `dashboard/` — UI Polaris è Astro server-rendered, non React SPA.
- `src/services/state/` — pluggable store, out of scope.
- `src/services/billing/` — fuori scope.

---

## 16. Decisioni finali del maintainer (2026-05-17)

Tutte le micro-decisioni sono chiuse:

1. **Nome**: **Polaris** ✓ locked.
2. **GitHub location**: `github.com/OneStepAt4time/polaris` privato ✓ locked.
3. **UI**: **solo web** ✓ locked. CCMeter rimane TUI di riferimento; Polaris non duplica quel caso.

Nessuna ambiguità residua. Pronto per M0.
