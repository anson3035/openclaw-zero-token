# 違規檢舉 — 手機 App (Capacitor)

Capacitor 包裝既有 web UI 為原生 iOS / Android App。架構：

```
[手機 App (WebView + Capacitor)]
        ↓ HTTPS / HTTP（您設定）
[Mac Mini API 服務 :8787]
        ↓
[OpenAI / Gemini / TDX / SMTP]
```

Native 整合：
- 📷 **Camera** — 直接從 App 拍照（不必先存到相簿）
- 📍 **Geolocation** — 自動填入裝置定位
- 🔐 **Preferences** — 安全儲存（比 localStorage 更安全）
- 📤 **Share** — Native 分享 sheet 將 PDF 報告傳到 Mail / Messages
- 🌐 **Network** — 偵測連線狀態
- 🎨 **Status Bar / Splash** — 原生狀態列 + 啟動畫面

---

## 前置條件

| 平台 | 需要 |
|---|---|
| **iOS** | macOS + Xcode 15+ + Apple Developer 帳號（可免費簽 7 天測試）|
| **Android** | macOS / Linux / Windows + Android Studio + Java JDK 17+ + Android SDK |

---

## 第一次設定（在您 Mac Mini 上）

### 1. 安裝 mobile 套件

```bash
cd extensions/taiwan-report-bot/mobile
npm install
```

### 2. 編譯 www/（把 web/ 注入 Capacitor 整合）

```bash
npm run build
```

### 3a. iOS 設定（Mac Mini 必須有 Xcode）

```bash
# 一次性：加入 ios 平台
npm run ios:add

# 開 Xcode（自動執行 cap sync）
npm run ios:open
```

在 Xcode 中：
1. **Signing & Capabilities** → 選您的 Apple ID（免費版亦可）
2. 連接 iPhone（USB or Wi-Fi 配對）
3. 上方選您的裝置 → ▶ Run
4. 第一次裝會被 iOS 擋下 → 設定 → 一般 → VPN與裝置管理 → 信任憑證

### 3b. Android 設定（任何 OS）

```bash
# 一次性
npm run android:add

# 開 Android Studio
npm run android:open
```

在 Android Studio 中：
1. 連接 Android 手機（USB 開發人員模式 + USB 偵錯）
2. 上方選裝置 → ▶ Run

或直接命令列跑（手機已連）：

```bash
npm run android:run
```

---

## 修改 web UI 後重 build

每次改 `../web/` 後：

```bash
npm run sync   # = build + cap sync
```

iOS / Android Studio 會自動 pick up，按 ▶ 重跑即可。

---

## 連線 Mac Mini API 設定

App 啟動後右上角有齒輪 ⚙ 按鈕。點按設定 API 端點：

| 場景 | 範例 URL |
|---|---|
| 手機與 Mac Mini 同 Wi-Fi | `http://192.168.1.100:8787` |
| 透過 Tailscale 遠端 | `http://mac-mini.your-tailnet.ts.net:8787` |
| 雲端部署 | `https://api.violation.example.com` |

> ⚠ iOS 18+ / Android 9+ 預設禁 HTTP 明文，已在 `capacitor.config.ts` 開 `allowMixedContent` (Android) 與 `iOS App Transport Security` 例外（需自行加 plist）。Tailscale 通常為 HTTP，建議用 Tailscale 並信任 LAN。

---

## 包成正式 App（送 App Store / Play Store）

### iOS（App Store）

需要：
- 付費 Apple Developer 帳號（$99/年）
- 在 Xcode 中：Product → Archive → Distribute App
- 上傳至 App Store Connect → 設定 metadata → 送審

### Android（Play Store）

需要：
- 一次性付款 Google Play Developer 帳號（$25）
- Android Studio → Build → Generate Signed Bundle/APK
- 上傳 .aab 到 Play Console

---

## 個人使用免上架

iOS：
- 免費 Apple ID 簽署 → 每 7 天需重簽
- 升級到 Sideloady (https://sideloadly.io) 自動續簽
- 或加入 TestFlight 內測（需付費帳號）

Android：
- Build Release APK → 直接安裝（手機需開啟「未知來源」）
- 不需 Play Store

---

## 故障排除

| 問題 | 解法 |
|---|---|
| `npx cap add ios` 失敗 | 先 `npm install`；確認 `mobile/www/` 已存在（`npm run build`）|
| iOS 簽不過 | Xcode → Project → Signing → Team 選您的 Apple ID |
| Android 編譯 Gradle 卡住 | `cd android && ./gradlew clean` |
| 手機連不到 API | (1) 確認 Mac Mini 開機且 API 在跑 (2) 確認同 Wi-Fi (3) 改用 Tailscale |
| 相機沒權限 | 系統設定 → 違規檢舉 App → 相機 → 允許 |
| 定位沒權限 | 同上，→ 定位服務 → 允許 |

---

## 檔案地圖

```
mobile/
├── package.json              — Capacitor 套件
├── capacitor.config.ts       — App ID、name、平台設定
├── README.md                 — 本檔
├── www/                      — build 後產出（npm run build 產生）
├── scripts/
│   ├── build-www.sh          — 把 ../web 包成 www（注入 mobile-bridge.js）
│   └── mobile-bridge.js      — Capacitor plugin 接口 + settings UI
├── ios/                      — npx cap add ios 後產生
└── android/                  — npx cap add android 後產生
```
