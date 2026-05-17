# Polaris — Charter, Architettura e Regole di Sviluppo

> Charter di partenza. Scritto come farebbe una software house: vision, scope, architettura, stack, regole, roadmap, criteri di rilascio.
>
> **Decisioni locked (2026-05-17)**: nome = **Polaris**; repo GitHub = `OneStepAt4time/polaris` (private); UI = **solo web** (no TUI — CCMeter copre già il caso TUI).

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

**One-liner (it)**: Polaris è l'osservatorio self-hosted dei tuoi agenti AI — vedi token, costi, rate-limit e attività di Claude Code (e altri) in una dashboard web ispirata a CCMeter, e ti notifica via Telegram, Slack o Discord prima che bruci il budget o sbatti contro un rate-limit.

**One-liner (en)**: Polaris — self-hosted analytics & alerts for your AI coding agents.

**Target user v0**: developer solo che usa Claude Code (eventualmente Cursor/Codex/Gemini CLI in futuro) e vuole sapere quanto sta spendendo, dove sta sprecando token, quando si avvicina al rate-limit, e quando una sessione fallisce — senza dover stare incollato a un terminale.

**Differenze rispetto a CCMeter** (perché esiste Polaris se c'è già):

| Aspetto | CCMeter | Polaris |
|---|---|---|
| UI | TUI (terminale locale) | Web UI (remoto, da telefono o desktop) |
| Notifiche | Nessuna | Telegram + Slack + Discord + Webhook + Email |
| Agenti supportati | Claude Code only | Claude Code in v1, multi-agent v2 |
| Dato persistito | `~/.config/ccmeter/history.json` locale | SQLite server, accessibile da più macchine |
| Deployment | Binary locale | Server self-hosted (Docker o binary) |
| Soglie / alert | No | Sì (cost-per-day, rate-limit-approaching, session-failed) |

Polaris **non sostituisce CCMeter**: CCMeter resta superiore se vuoi solo TUI locale. Polaris vince quando vuoi notifiche, accesso remoto, o multi-machine aggregation.

**Comparabili (per posizionarsi)**:
- **CCMeter** — TUI Claude Code analytics. Inspirazione visiva diretta.
- **Uptime Kuma** — self-hosted uptime, ma non AI-specific.
- **Helicone / Langfuse** — LLM observability ma SaaS-first e B2B.
- **claude-usage / ccusage CLI** — CLI tool, no UI live, no notifiche.

---

## 3. Scope locked al Day-1

### IN scope per v1.0 (Beta)
- **Data ingest**:
  - JSONL parser per `~/.claude/projects/**/*.jsonl` (sessions Claude Code).
  - Streaming + dedup per `requestId` come fa CCMeter (vedi §10 ADR-0007).
  - Polling OAuth `/api/oauth/usage` per rate-limit tracking.
- **Metriche calcolate** (parità con CCMeter):
  - Token (input, output, cache) per modello (Opus, Sonnet, Haiku).
  - Costi USD via pricing table built-in.
  - Lines suggested/accepted/added/deleted + acceptance rate.
  - Active time estimation per progetto.
  - Efficiency score (token/line).
- **Web UI** (CCMeter-equivalent, vedi §5):
  - KPI banner: cost totale, streak, active days, avg tokens/day, efficiency.
  - Heatmaps GitHub-style (4 metriche).
  - Project cards con sparklines.
  - Per-project detail view.
  - Time filters: 1h, 12h, Today, week, month, all.
  - Rate-limit view (toggleable).
- **Notifiche**:
  - Trigger: cost-threshold superato, rate-limit approaching (>80%), session failed, daily summary.
  - Canali: Telegram, Slack, Discord, Webhook (+ Email opzionale M2).
- **Auth**: shared token via env `POLARIS_AUTH_TOKEN`.
- **Storage**: SQLite (cache aggregati + historical metrics).
- **Distribuzione**: Docker image multi-arch + single binary (Linux x64/arm64, macOS x64/arm64, Windows x64).

### OUT scope (esplicito, scritti come ADR Day-1)
- SaaS / cloud hosting / billing / Stripe.
- Multi-tenant / organizations / workspaces.
- Multi-user / RBAC / OAuth / SSO (defer to v2).
- Orchestrazione / pipeline / DAG (lezione Aegis `pipeline.ts`).
- Cost tracking custom (oltre le pricing table dei modelli supportati).
- Mobile native app (Telegram/Slack/Discord coprono mobile).
- Postgres, Redis, Kubernetes, Helm chart.
- OpenTelemetry export.
- TUI (CCMeter esiste già — non duplichiamo).
- Multi-agent in v1 (Claude Code only finché v1 non è stabile; Cursor/Codex/Gemini CLI in v2 via adapter).
- Plugin system per channel custom o agent custom (in v3 forse, con due use-case esterni).
- Integrazione con Anthropic Console / claude.ai (CCMeter già nota i limiti).

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

## 9. Roadmap (3 milestone, niente Phase 4 fantasiose)

### M0 — Foundation (target: 1 settimana)
Goal: scheletro che compila, deploya, ingesta JSONL.

- [ ] Setup TS + Fastify + Astro + SQLite + Biome + Vitest + CI matrix.
- [ ] JSONL parser streaming con dedup `requestId` (5 fixture test).
- [ ] Storage SQLite con schema sessions/events/daily_aggregates.
- [ ] `GET /v1/metrics` ritorna JSON con totali aggregati.
- [ ] Astro page `/` mostra HTML basic con totali (no heatmap ancora).
- [ ] Docker image build.
- [ ] 8 ADR Day-1 scritti.

**Exit M0**: `polaris --jsonl-dir ~/.claude/projects` parsa i tuoi JSONL reali, salva su SQLite, `curl localhost:3000/v1/metrics` ritorna totali sensati confrontabili con CCMeter ±1%.

### M1 — MVP CCMeter-parity + notifiche (target: 3-4 settimane dopo M0)
Goal: web UI replica info-architecture CCMeter, + Telegram/Slack/Discord notifications.

- [ ] **Metrics layer completo**: token aggregator, cost calculator, activity estimator, efficiency scorer.
- [ ] **Rate-limit tracker**: OAuth poll, persistence, forecast estrapolazione.
- [ ] **UI dashboard** (Astro):
  - [ ] KPI banner (5 metriche).
  - [ ] Heatmap GitHub-style (4 metriche, CSS Grid).
  - [ ] Project cards grid con sparkline.
  - [ ] Per-project detail view.
  - [ ] Time filter (1h/12h/Today/week/month/all).
  - [ ] Rate-limit view toggleabile.
- [ ] **Rule engine** con 4 regole built-in: cost-threshold, rate-limit-near, session-failed, daily-summary.
- [ ] **Notification adapter**: Telegram (bot), Slack (webhook), Discord (webhook).
- [ ] **Auth**: `POLARIS_AUTH_TOKEN`.
- [ ] **Settings panel** (Astro): rename project, merge, hide, star (parità CCMeter).
- [ ] User guide + install guide + Docker compose example.
- [ ] Release v0.1.0 con binary + Docker.

**Exit M1**: maintainer runna Polaris come daemon, dashboard visibile da telefono via web UI, riceve notifica Telegram quando supera soglia di costo giornaliero. Totali metriche allineate con CCMeter ±1%. Total LOC ≤6500.

### M2 — Beta pubblico + Email + secondo agente (target: 1-2 mesi dopo MVP)
Goal: prima validazione esterna, ≥5 utenti self-hosted.

- [ ] Email notification adapter (`nodemailer`).
- [ ] Webhook outbound generico (integrazioni custom).
- [ ] Retention/pruning automatico (storico > N giorni → aggregati only).
- [ ] **Secondo agente**: Cursor session parser (o l'agente che più utenti chiedono).
- [ ] Performance budget: 10k sessioni parsate in <5s; UI p99 <100ms.
- [ ] Documentation: troubleshooting, FAQ, "comparison with CCMeter / claude-usage".
- [ ] CHANGELOG + community contributing guide.

**Exit M2**: ≥5 utenti esterni runnano Polaris ≥1 settimana, almeno 1 issue da utente esterno, no regressione.

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

## 12. Criteri di rilascio v0.1.0 ("MVP shippable")

v0.1.0 esce SOLO se TUTTI questi sono veri:

1. `curl -L .../polaris-linux-x64 -o polaris && chmod +x polaris && ./polaris` funziona (single binary).
2. `docker run -p 3000:3000 -v ~/polaris:/data -v ~/.claude:/claude:ro ghcr.io/.../polaris:latest` funziona.
3. JSONL ingest in tempo reale (file appender → evento in <5s).
4. Web UI mostra: KPI banner, heatmap GitHub-style, project cards, time filter, rate-limit view.
5. **Parità metriche con CCMeter ±1%** su stesso dataset.
6. Almeno **Telegram** funziona end-to-end (canale minimo).
7. Almeno **1 regola di alert** firea: cost-threshold giornaliero.
8. `npm test` passa su Linux + macOS + Windows CI.
9. README ha install + quickstart in <5 minuti.
10. Total LOC ≤ 6500.
11. Runtime dependencies ≤ 20.
12. Env vars ≤ 12.

Se uno solo manca: NON si rilascia, si itera.

---

## 13. Cosa rifiutiamo (lista citabile nei refiuti di issue/PR)

Se qualcuno (incluso il maintainer in un momento di debolezza) propone uno di questi senza nuova evidenza forte:

- Multi-tenant / organizations / workspaces.
- SaaS hosted version.
- OAuth / SSO / OIDC / SAML.
- Postgres / Redis / Kafka / qualunque broker.
- Kubernetes / Helm chart / operator.
- OpenTelemetry export.
- TUI (CCMeter esiste già, fa benissimo il suo lavoro).
- Mobile native app.
- Pipeline / orchestration / workflow.
- Custom pricing (oltre i modelli supportati).
- Plugin system custom per channel o agent (in v3 forse, con due use-case esterni).
- Generic process monitoring (non più scope di Polaris — pivotato verso AI-agent-specific con CCMeter parity).
- Integrazione con claude.ai web/desktop (CCMeter ha già notato i limiti).

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

**NON riusare da Aegis**:
- `src/services/acp/` — Polaris non bridgea Claude Code, ne legge i JSONL.
- `src/pipeline.ts` — out of scope.
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
