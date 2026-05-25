# Taiwan Violation Reporting Bot

Three frontends — Telegram bot, **Web UI**, **Electron desktop app** — sharing one backend, turning photo / video evidence into a ready-to-send Taiwan administrative-violation report.

```
                       Shared backend
       ┌─────────────────────────────────────────────────┐
       │  vision (GPT-4o) · exif · geocoding · report    │
       │  builder · compliance gate · mailer · audit log │
       │  rate-limit · persistent store · authorities    │
       └────┬────────────────────────────────────────────┘
            │
   ┌────────┼────────┐
   │        │        │
 ┌─▼──┐  ┌──▼──┐  ┌──▼─────┐
 │ TG │  │ Web │  │Desktop │
 │bot │  │ SPA │  │Electron│
 └────┘  └─────┘  └────────┘
```

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
npm install
cp .env.example .env  # then fill in TELEGRAM_BOT_TOKEN + OPENAI_API_KEY
```

### Run options

```bash
npm start             # both Telegram bot + HTTP API (default)
npm run start:bot     # Telegram bot only
npm run start:api     # HTTP API + Web UI only (defaults to port 8787)
npm run desktop       # launch the Electron desktop app (also starts API)
```

When the API is running, open `http://127.0.0.1:8787/` in any browser for the **Web UI**.

### Required env

| Key | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `OPENAI_API_KEY` | needs `gpt-4o` (vision) access |

### Optional env

| Key | Default | Purpose |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o` | Override model |
| `HTTP_PORT` | `8787` | Web/Desktop API port |
| `RUN` | `bot,api` | Comma-separated list of services to start |
| `SMTP_HOST/PORT/USER/PASS/FROM` | — | Enables `/send` (Telegram) and `📨 由系統代寄` (Web) |
| `EVIDENCE_DIR` | `./evidence` | Where downloaded media is stored |
| `DATA_DIR` | `./data` | Persistent store + audit log |
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
| `/lpr` | commercial-grade Taiwan ANPR — multi-frame verification + plate-rule correction (auto-runs on traffic cases; this command shows the raw breakdown: type / artifacts / raw OCR / confidence / ambiguity) |
| `/sms` | reply with SMS body + `sms:` deep link (one-tap send on phone). Traffic violations only. |
| `/to <email>` | rewrite recipient for the current session |
| `/category <traffic\|environment\|building\|condominium>` | force a category |
| `/address <地址>` | set address manually when EXIF lacks GPS |
| `/cancel` | drop the current session |
| `/help` | command list |

### Multi-photo (album / media group)

Send 2+ photos as a **Telegram album** (long-press → select multiple → send). The bot buffers them by `media_group_id` and treats them as one report. This is required for continuous-violation traffic cases (e.g. 違停) per 道交 §7-1, which mandates ≥ 2 photos taken ≥ 3 minutes apart.

### License plate recognition (ANPR v3 — two-pass + MOTC validation)

Traffic cases run a second-pass commercial-grade Taiwan ANPR engine (`src/services/lpr.ts`) over all available images / video frames after the main violation analysis. The engine enforces MOTC plate rules:

- `I` and `O` are never used → corrected to `1` and `0`
- Modern 7-character plates exclude the digit `4` in the numeric sequence
- Format awareness: 7-char (3L-4D), older 6-char (2L-4D / 4D-2L), motorcycle (3L-3D / 2L-3D), EV (`E*-****`), taxi (`T*-****` / `Y*-****`)

**Hallucination defenses (v2)**:
- Prompt declares an explicit visually-confusable character table (G↔E/C/6/0/8, M↔N/W/H, 0↔8/6, 9↔0/8/6 …)
- Forces Top-3 candidate enumeration with per-character alternatives and individual character confidence
- Capture-quality score (distance × angle × blur × glare × occlusion) caps the final confidence
- "Cross-frame agreement" trap warning — if all frames come from the same low-resolution capture, the model is instructed NOT to report agreement as verification (that's the same bias agreeing with itself)
- Post-hoc confidence cap in TypeScript: each severe artifact knocks 0.15 off the ceiling; final confidence ≤ min(model report, quality cap, artifact cap)
- `requires_human_verification=true` whenever confidence < 0.85, ambiguity detected, or any severe artifact

**Confidence boosters (v3)**:
- **Two-pass pipeline** (`src/services/lpr-pipeline.ts`): Pass-1 reads the full image and reports a `plate_bbox`; the pipeline crops to that bbox + 4× upscales + sharpens + normalises contrast (`src/services/image-ops.ts` via sharp/libvips); Pass-2 re-reads on the cropped+zoomed image. This is REAL independent verification (different visual input) rather than the same model seeing the same pixels twice.
- **Agreement boost**: when Pass-1 and Pass-2 agree, the resolved plate's confidence is multiplied by 1.5 (capped at 0.95). A correct read that initially scored 0.45 now climbs to ~0.68; one that scored 0.6 climbs to 0.9 (high confidence, auto-send unlocked).
- **MOTC pattern validation** (`src/services/plate-validator.ts`): a plate that satisfies the issuance rules (no I/O, no digit-4 in modern 7-char numerics, valid format / EV / taxi prefix) earns a +0.10 boost. A plate that VIOLATES the rules (likely OCR hallucination) is multiplied by 0.5 and forced into requires_human_verification.
- **Short-circuit**: Pass-1 alone is accepted when it already reports ≥ 0.85, saving the second OpenAI call.

**Gate**: even when LPR returns a plate, `/send` is blocked until the user explicitly confirms it with `/plate <PLATE>` — unless the pipeline reaches ≥ 0.85 final confidence (agreement + MOTC valid). The compliance check surfaces this clearly in the report.

**`/plate <PLATE>` command**: confirms or corrects the plate, marks it as user-verified, unlocks `/send`.

**`/lpr` output**: shows the resolved plate, capture quality, Top-3 candidates, per-character uncertainty for any position below 0.85, and whether human verification is required.

### Video support

Videos are decoded with `ffmpeg-static` and sampled at 5 evenly-spaced timestamps (skipping the first/last 5% of duration). The middle frame is used for the violation classifier; all frames are pooled for the ANPR pass.

### 舉發獎金 (Citizen-reporting rewards)

Each rule in the legal catalog now carries an optional `reward` annotation. When at least one matched citation qualifies, the report surfaces a `💰` banner and lists per-citation reward details: 核發單位 (authority), 法源 (legal basis), 結構 (percentage / fixed / tiered), 估算金額 (estimate range), and 備註 (notes).

Current rewardable categories (as of 2026):

| 違規類型 | 結構 | 估算 | 主管機關 |
|---|---|---|---|
| 亂丟垃圾 (廢清法 §27) | 罰鍰百分比 | 罰鍰 30%–50% | 各縣市環保局 |
| 棄置有害事業廢棄物 (廢清法 §46) | 分級 | 最高 50 萬元 | 環境部 / 縣市環保局 |
| 噪音超標 (噪音管制法) | 罰鍰百分比 | 罰鍰 10%–30% | 各縣市環保局 |
| 露天燃燒 / 空污 (空污法 §32) | 罰鍰百分比 | 罰鍰 10%–50% | 各縣市環保局 |
| 車輛排氣超標（黑煙）(空污法 §40) | 固定 | 100–500 元 / 案 | 各縣市環保局 |
| 餐飲業油煙 (空污法 §32) | 罰鍰百分比 | 罰鍰 10%–30% | 各縣市環保局 |

**No-reward categories** (intentionally flagged false): 交通違停／闖紅燈／未禮讓行人（2022 道交 §7-1 改革取消多數獎金）、建築違章、公寓大廈管理。

> ⚠ 估算金額依各縣市辦法不同，且須查獲屬實並完成裁罰後始能核發。請以當地環保局公告為準。

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

Unit coverage (68 tests across 9 files):
- Legal-rule pattern matching (traffic / environment / building / condominium)
- Report builder (markdown structure, email subject, condominium notice, emergency notice, evidence gaps, prefilled online form URL, recipient routing, reporter identity embedding, SHA-256 fingerprinting in body)
- Address parsing (city extraction, 臺/台 normalization)
- SMS body formatting and `sms:` deep-link generation (Taiwan E.164 normalization, plate/time/address composition, segment-length truncation, traffic-only gating, per-city number routing)
- Compliance check (identity required, multi-photo enforcement, ≥ 3 min interval, EXIF timestamp warning, license-plate requirement, address resolution)
- Rate limiter (capacity, per-user isolation, analysis vs send separation, burst exhaustion)
- Persistent store (session round-trip with Date revival, identity round-trip, session/identity independence)
- Auth (register / authenticate / token issuance & revocation, password length & username pattern, duplicate-name rejection)
- HTTP API (health, 401 without bearer, register→login→/me round-trip, duplicate registration, bad login, null session for fresh user, identity required, logout revokes token)

Live OpenAI / Telegram calls are not covered by unit tests; run the bot end-to-end with a real Telegram chat once env is set.

## Web UI

Open `http://127.0.0.1:8787/` once `npm run start:api` is running.

Flow:

1. **Register / Login** — username + password + reporter identity (name / contact / optional national-ID last 4). Identity is required by 道交 §7-1.
2. **Upload** — drag-drop or click. Multi-file supported for continuous-violation traffic cases.
3. **Auto-analysis** — system reads EXIF GPS + timestamp, hashes each file with SHA-256, calls GPT-4o vision, reverse-geocodes via Nominatim, runs the compliance gate.
4. **Report card** — markdown report with compliance banner (✅ green / ⚠ amber). Buttons: `🏷 重新分類` / `📍 修正地址` / `📋 複製 email 草稿` / `📱 簡訊舉發` / `📨 由系統代寄`.
5. **Send confirmation modal** — `📨` shows a recipient / subject / attachment-count preview; only `確認寄出` actually dispatches.

Auth tokens are stored in browser `localStorage` (30-day TTL). Logout calls `/api/logout` which revokes the server-side token.

### REST API (used by Web + Desktop)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | — | liveness + SMTP-configured flag |
| `POST` | `/api/register` | — | `{username, password, name, contact, nationalId?}` → `{token, user}` |
| `POST` | `/api/login` | — | `{username, password}` → `{token, user}` |
| `POST` | `/api/logout` | bearer | revoke current token |
| `GET` | `/api/me` | bearer | current user + identity |
| `POST` | `/api/upload` | bearer | multipart `files[]` + `caption?` → `{artifact, evidence[]}` |
| `GET` | `/api/session` | bearer | current report session (or `null`) |
| `POST` | `/api/session/category` | bearer | `{category}` → updated `{artifact}` |
| `POST` | `/api/session/address` | bearer | `{address}` → updated `{artifact}` |
| `POST` | `/api/session/cancel` | bearer | drop session |
| `POST` | `/api/send` | bearer | `{to?}` → `{pending, preview}`. Pass `{confirm:true}` to actually dispatch. |
| `POST` | `/api/lpr` | bearer | multipart `files[]` + optional `vehicleTypeHint` → `{lpr: {analysis, resolved_plate}}` |
| `GET` | `/api/sms` | bearer | `{sms: {number, body, deepLink, note}}` |

## Desktop (Electron)

```bash
npm run desktop
```

`desktop/main.cjs` spawns the API server as a child process (`node --import tsx src/server.ts`), waits for the port, then opens a 1100×800 `BrowserWindow` pointing at `http://127.0.0.1:8787/`. External links (and `sms:` deep links) open in the OS default app.

For packaging into a distributable `.dmg` / `.exe` / `.AppImage`, use `electron-builder` (not bundled here yet; see Roadmap).

## Roadmap (known gaps, intentionally deferred)

The current implementation covers P0 (legal-correctness blockers) and key P1 items. The following are known gaps tracked for future iterations:

### P2 — should-have
- [ ] **Video frame extraction** (`ffmpeg-static` + `fluent-ffmpeg`) — currently videos are downloaded but sent to the vision model as a single frame, which the model cannot decode. Extract N frames evenly across the duration and pass them to the analyzer.
- [ ] **Inline-keyboard UI** — replace `/confirm`, `/category <type>`, `/cancel` with Telegraf inline buttons for a one-tap UX. The current text-command flow is correct but more clicks.
- [ ] **Third-party privacy auto-masking** — auto-blur non-violator faces and license plates in the attached evidence before `/send`. Currently the bot only advises the user in the markdown report.
- [ ] **Structured logging** (`pino`) with log levels, request IDs, and rotation. Currently `console.error` only.
- [ ] **EXIF orientation auto-rotation** — some phones store rotation in EXIF; the vision model occasionally analyzes a sideways image.

### P3 — nice-to-have
- [ ] **electron-builder packaging** — distributable `.dmg` / `.exe` / `.AppImage` with code signing
- [ ] **Dockerfile + docker-compose** for one-command deployment
- [ ] **Webhook mode** (vs long-polling) for higher throughput
- [ ] **Geocoding cache + throttle** — Nominatim's policy is 1 req/sec; add a tiny in-process LRU cache and request throttling
- [ ] **OpenAI retry / backoff** with circuit breaker on persistent failure
- [ ] **PDF report generation** for authorities that prefer formal documents
- [ ] **RFC 3161 trusted timestamping** of the SHA-256 hash for stronger evidentiary value
- [ ] **i18n** — English fallback for system messages (currently zh-TW only)
- [ ] **`/status` and `/list` + history view** — recall past submissions in Web/Desktop
- [ ] **CSRF protection** for cookie-based sessions (currently bearer-token only, so not needed yet)

### Explicit non-goals
- We will **not** auto-submit to police online forms — captchas + ToS would require headless browsers and likely violate authority terms.
- We will **not** store full national-ID numbers; only the last four digits are kept and embedded in submissions.
- We will **not** support anonymous submissions; the law requires named reporters and the bot enforces this.

## License

Same as parent repo.
