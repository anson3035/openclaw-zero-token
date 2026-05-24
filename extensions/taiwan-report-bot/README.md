# Taiwan Violation Reporting Bot

A Telegram bot that turns photo / video evidence into a ready-to-send Taiwan administrative-violation report.

Supported categories:
- 交通違規 (Traffic — 道路交通管理處罰條例)
- 環保違規 (Environment — 廢棄物清理法 / 噪音管制法 / 空氣污染防制法)
- 建築違規 (Building — 建築法)
- 公寓大廈違規 (Condominium — 公寓大廈管理條例)

## Architecture

```
[Telegram User] ──photo/video──▶ [Telegraf Bot]
                                       │
                                       ▼
                        ┌──────────────────────────┐
                        │  EXIF reader (gps/time)  │
                        │  Nominatim reverse geo   │
                        │  GPT-4o vision analysis  │
                        │  Legal rule matcher      │
                        │  Authority lookup        │
                        │  Report builder          │
                        └──────────────────────────┘
                                       │
                                       ▼
        ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────┐
        │  /draft  │  │  /send   │  │ online form  │  │  /sms    │
        │  (text)  │  │  (SMTP)  │  │ deep link    │  │ deep link│
        └──────────┘  └──────────┘  └──────────────┘  └──────────┘
```

## Setup

```bash
cd extensions/taiwan-report-bot
pnpm install          # or npm install
cp .env.example .env  # then fill in TELEGRAM_BOT_TOKEN + OPENAI_API_KEY
pnpm start            # or: node --import tsx src/index.ts
```

### Required env

| Key | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `OPENAI_API_KEY` | needs `gpt-4o` (vision) access |

### Optional env

| Key | Default | Purpose |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o` | Override model |
| `SMTP_HOST/PORT/USER/PASS/FROM` | — | Enables `/send` |
| `EVIDENCE_DIR` | `./evidence` | Where downloaded media is stored |
| `ALLOWED_USER_IDS` | (empty) | Comma-separated Telegram user IDs whitelist |
| `NOMINATIM_USER_AGENT` | `taiwan-report-bot/0.1` | Required by OSM |

## Commands

| Command | Behavior |
|---|---|
| send a photo / video / **album** | analyze → reply with full report markdown + compliance check |
| `/identify 王小明\|0912-345678\|1234` | set reporter identity (name \| contact \| optional national-ID last 4) — required by 道交 §7-1 |
| `/whoami` | show current reporter identity |
| `/forgetme` | delete stored identity |
| `/draft` | reply with email subject + body for manual sending |
| `/send [override@email]` | start send flow — requires `/confirm` to actually dispatch |
| `/confirm` | confirm and dispatch the pending send |
| `/sms` | reply with SMS body + `sms:` deep link (one-tap send on phone). Traffic violations only. |
| `/to <email>` | rewrite recipient for the current session |
| `/category <traffic\|environment\|building\|condominium>` | force a category |
| `/address <地址>` | set address manually when EXIF lacks GPS |
| `/cancel` | drop the current session |
| `/help` | command list |

### Multi-photo (album / media group)

Send 2+ photos as a **Telegram album** (long-press → select multiple → send). The bot buffers them by `media_group_id` and treats them as one report. This is required for continuous-violation traffic cases (e.g. 違停) per 道交 §7-1, which mandates ≥ 2 photos taken ≥ 3 minutes apart.

### Compliance gate

Before `/send` will dispatch, the report must pass a compliance check covering:

- Reporter identity set (`/identify`)
- For continuous-parking traffic: ≥ 2 photos and ≥ 3 min apart with EXIF timestamps
- License plate detected (traffic only)
- Address resolved (not the placeholder)

Failures are surfaced in the markdown report's "送件前合規檢查" section and block `/confirm`.

### Evidence integrity

Every downloaded file is SHA-256 hashed at ingestion. Hashes are:

- Embedded in the markdown report (truncated)
- Embedded in the full email body (full hex) so recipients can verify the attachment was not modified in transit
- Recorded in the JSONL audit log at `${DATA_DIR}/audit.log.jsonl`

### Audit log

Every meaningful event is appended to `${DATA_DIR}/audit.log.jsonl`:

```
media_received | analyzed | report_built | draft_viewed |
send_requested | send_confirmed | sent | send_failed |
cancelled | identity_set | rate_limited
```

Each line has `{ts, type, chatId, userId, meta}`. Use for ops debugging and as evidentiary chain-of-custody.

### Persistent state

Sessions and reporter identities are persisted to `${DATA_DIR}/store.json` so bot restarts don't lose in-flight cases. Sessions auto-expire after 30 minutes.

### Rate limiting

In-memory token bucket per Telegram user:

- Analysis: 5 burst, ~10/hr refill
- Send: 3 burst, ~5/hr refill

## Built-in authority routing

| City | Traffic email | Online form | SMS number |
|---|---|---|---|
| 台北市 | tpd@mail.taipei.gov.tw | TPD filing | 0911-510119 |
| 新北市 | 10618@police.ntpc.gov.tw | NTPC filing | 0911-511110 |
| 桃園市 | tpd@mail.tycg.gov.tw | TYHP | 0911-512110 |
| 台中市 | tcpb@taichung.gov.tw | Taichung filing | 0911-513110 |
| 台南市 | tnpd@tainan.gov.tw | Tainan filing | 0911-514110 |
| 高雄市 | khpb@kcg.gov.tw | KCPD filing | 0911-515110 |
| (other) | service@npa.gov.tw | — | — |

(Environment / Building / Condominium follow the same per-city pattern; see `src/data/authorities.ts`.)

> ⚠ **SMS numbers verification**: per-city SMS reporting lines change periodically. Verify against the relevant 警察局交通隊 webpage or the 警政服務 App before relying on them for production filings. The bot includes a `smsNote` per city you can override in `src/data/authorities.ts`.

## Compliance notes

- For condominium cases the report appends a reminder to contact the 管委會 first and obtain 區分所有權人會議 minutes as supporting evidence.
- For environment / building cases the report appends an emergency reminder to call **110 / 1999** when an active hazard is in progress.
- Third-party license plates and faces should be masked before submission; the report's "證據檢核" section calls this out.
- `/send` is opt-in. The recommended default workflow is `/draft` → user reviews → user sends from their own mailbox so the report has a real reply-to identity.

## Tests

```bash
pnpm test
```

Unit coverage (54 tests across 7 files):
- Legal-rule pattern matching (traffic / environment / building / condominium)
- Report builder (markdown structure, email subject, condominium notice, emergency notice, evidence gaps, prefilled online form URL, recipient routing, reporter identity embedding, SHA-256 fingerprinting in body)
- Address parsing (city extraction, 臺/台 normalization)
- SMS body formatting and `sms:` deep-link generation (Taiwan E.164 normalization, plate/time/address composition, segment-length truncation, traffic-only gating, per-city number routing)
- Compliance check (identity required, multi-photo enforcement, ≥ 3 min interval, EXIF timestamp warning, license-plate requirement, address resolution)
- Rate limiter (capacity, per-user isolation, analysis vs send separation, burst exhaustion)
- Persistent store (session round-trip with Date revival, identity round-trip, session/identity independence)

Live OpenAI / Telegram calls are not covered by unit tests; run the bot end-to-end with a real Telegram chat once env is set.

## Roadmap (known gaps, intentionally deferred)

The current implementation covers P0 (legal-correctness blockers) and key P1 items. The following are known gaps tracked for future iterations:

### P2 — should-have
- [ ] **Video frame extraction** (`ffmpeg-static` + `fluent-ffmpeg`) — currently videos are downloaded but sent to the vision model as a single frame, which the model cannot decode. Extract N frames evenly across the duration and pass them to the analyzer.
- [ ] **Inline-keyboard UI** — replace `/confirm`, `/category <type>`, `/cancel` with Telegraf inline buttons for a one-tap UX. The current text-command flow is correct but more clicks.
- [ ] **Third-party privacy auto-masking** — auto-blur non-violator faces and license plates in the attached evidence before `/send`. Currently the bot only advises the user in the markdown report.
- [ ] **Structured logging** (`pino`) with log levels, request IDs, and rotation. Currently `console.error` only.
- [ ] **EXIF orientation auto-rotation** — some phones store rotation in EXIF; the vision model occasionally analyzes a sideways image.

### P3 — nice-to-have
- [ ] **Dockerfile + docker-compose** for one-command deployment
- [ ] **HTTP health endpoint** (`GET /healthz`) on a configurable port for k8s/Fly liveness probes
- [ ] **Webhook mode** (vs long-polling) for higher throughput
- [ ] **Geocoding cache + throttle** — Nominatim's policy is 1 req/sec; add a tiny in-process LRU cache and request throttling
- [ ] **OpenAI retry / backoff** with circuit breaker on persistent failure
- [ ] **PDF report generation** for authorities that prefer formal documents
- [ ] **RFC 3161 trusted timestamping** of the SHA-256 hash for stronger evidentiary value
- [ ] **i18n** — English fallback for system messages (currently zh-TW only)
- [ ] **`/status` and `/list`** — show current session and recall past submissions

### Explicit non-goals
- We will **not** auto-submit to police online forms — captchas + ToS would require headless browsers and likely violate authority terms.
- We will **not** store full national-ID numbers; only the last four digits are kept and embedded in submissions.
- We will **not** support anonymous submissions; the law requires named reporters and the bot enforces this.

## License

Same as parent repo.
