# Taiwan Violation Reporting Bot

A Telegram bot that turns a single photo or video into a ready-to-send Taiwan administrative-violation report.

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
| send a photo / video | analyze → reply with full report markdown |
| `/draft` | reply with email subject + body for manual sending |
| `/send [override@email]` | SMTP-send to authority (or override) |
| `/sms` | reply with SMS body + `sms:` deep link (one-tap send on phone). Traffic violations only. |
| `/to <email>` | rewrite recipient for the current session |
| `/category <traffic\|environment\|building\|condominium>` | force a category |
| `/address <地址>` | set address manually when EXIF lacks GPS |
| `/cancel` | drop the current session |
| `/help` | command list |

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

Unit coverage:
- Legal-rule pattern matching (traffic / environment / building / condominium)
- Report builder (markdown structure, email subject, condominium notice, emergency notice, evidence gaps, prefilled online form URL, recipient routing)
- Address parsing (city extraction, 臺/台 normalization)
- SMS body formatting and `sms:` deep-link generation (Taiwan E.164 normalization, plate/time/address composition, segment-length truncation, traffic-only gating, per-city number routing)

Live OpenAI / Telegram calls are not covered by unit tests; run the bot end-to-end with a real Telegram chat once env is set.

## License

Same as parent repo.
