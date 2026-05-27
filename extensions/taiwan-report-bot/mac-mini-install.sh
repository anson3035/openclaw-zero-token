#!/usr/bin/env bash
# ============================================================================
# 台灣違規檢舉系統 — Mac Mini 一鍵安裝
# ============================================================================
# 用法：
#   bash mac-mini-install.sh
#
# 流程：
#   1. 檢查 macOS + 架構（Apple Silicon / Intel）
#   2. 安裝 Homebrew（若未安裝）
#   3. 安裝 Node.js 22 LTS（若未安裝）
#   4. 跑 setup-local.sh 互動式設定 .env
#   5. 跑單元測試
#   6. （選用）安裝 LaunchAgent 開機自動啟動
#   7. 顯示 LAN URL 給手機 / 其他電腦連線使用
# ============================================================================
set -e

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
PROJECT_NAME="violation-bot"

echo "╔════════════════════════════════════════════════════╗"
echo "║   台灣違規檢舉系統 — Mac Mini 安裝助手             ║"
echo "╚════════════════════════════════════════════════════╝"
echo

# ----------------------------------------------------------------------------
# 1) 環境檢查
# ----------------------------------------------------------------------------
if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "❌ 此腳本僅供 macOS 使用，請改用 setup-local.sh"
  exit 1
fi

MAC_VER=$(sw_vers -productVersion)
ARCH=$(uname -m)
echo "✅ macOS $MAC_VER ($ARCH)"

# Apple Silicon brew 路徑 vs Intel brew 路徑
if [[ "$ARCH" == "arm64" ]]; then
  BREW_PREFIX="/opt/homebrew"
else
  BREW_PREFIX="/usr/local"
fi

# ----------------------------------------------------------------------------
# 2) Xcode Command Line Tools（sharp / native modules 需要）
# ----------------------------------------------------------------------------
if ! xcode-select -p &> /dev/null; then
  echo
  echo "→ 安裝 Xcode Command Line Tools（sharp 模組需要）..."
  echo "  將跳出對話框，請點「安裝」並等候完成（5–10 分鐘）"
  xcode-select --install || true
  echo "  完成後請重新跑此腳本"
  exit 0
fi
echo "✅ Xcode CLT $(pkgutil --pkg-info=com.apple.pkg.CLTools_Executables 2>/dev/null | awk '/version:/ {print $2}' || echo 'installed')"

# ----------------------------------------------------------------------------
# 3) Homebrew
# ----------------------------------------------------------------------------
if ! command -v brew &> /dev/null; then
  echo
  echo "→ 安裝 Homebrew（系統套件管理員）..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # 把 brew 加入 PATH
  eval "$($BREW_PREFIX/bin/brew shellenv)"
  if ! grep -q "brew shellenv" ~/.zprofile 2>/dev/null; then
    echo "eval \"\$($BREW_PREFIX/bin/brew shellenv)\"" >> ~/.zprofile
  fi
fi
echo "✅ Homebrew $(brew --version | head -1)"

# ----------------------------------------------------------------------------
# 4) Node.js 22 LTS
# ----------------------------------------------------------------------------
NEED_NODE=1
if command -v node &> /dev/null; then
  NV=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NV" -ge 20 ]; then
    NEED_NODE=0
  fi
fi
if [ "$NEED_NODE" -eq 1 ]; then
  echo
  echo "→ 安裝 Node.js 22 LTS via Homebrew..."
  brew install node@22
  brew link node@22 --force --overwrite
fi
echo "✅ Node $(node -v) / npm $(npm -v)"

# ----------------------------------------------------------------------------
# 5) 跑互動式 setup-local.sh
# ----------------------------------------------------------------------------
echo
echo "→ 啟動 setup-local.sh（互動式設定 .env）..."
bash setup-local.sh

# ----------------------------------------------------------------------------
# 6) 跑測試
# ----------------------------------------------------------------------------
echo
echo "→ 跑單元測試（驗證安裝正確）..."
if npm test > /tmp/violation-bot-test.log 2>&1; then
  TESTS=$(grep -oE '[0-9]+ passed' /tmp/violation-bot-test.log | head -1)
  echo "✅ $TESTS"
else
  echo "⚠ 測試有失敗，看 /tmp/violation-bot-test.log"
fi

# ----------------------------------------------------------------------------
# 7) LaunchAgent (auto-start on login)
# ----------------------------------------------------------------------------
echo
read -p "→ 是否要安裝 LaunchAgent 讓 Mac Mini 開機 / 登入時自動啟動服務？[Y/n] " ANS
ANS=${ANS:-Y}
if [[ "$ANS" =~ ^[Yy] ]]; then
  PLIST_NAME="com.violation-bot.plist"
  PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
  mkdir -p "$HOME/Library/LaunchAgents"

  NODE_BIN=$(command -v node)
  NPM_BIN=$(command -v npm)
  LOG_DIR="$HOME/Library/Logs/violation-bot"
  mkdir -p "$LOG_DIR"

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.violation-bot</string>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NPM_BIN</string>
        <string>run</string>
        <string>start:api</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$BREW_PREFIX/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HTTP_PORT</key>
        <string>8787</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/stderr.log</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
EOF

  # 先卸載舊版本（若存在）
  launchctl bootout "gui/$UID/com.violation-bot" 2>/dev/null || true
  # 載入並啟動
  launchctl bootstrap "gui/$UID" "$PLIST_PATH"
  launchctl kickstart -k "gui/$UID/com.violation-bot"

  echo "✅ LaunchAgent 已安裝：$PLIST_PATH"
  echo "   log 檔：$LOG_DIR/"
  echo
  echo "   管理指令："
  echo "     停止：  launchctl bootout gui/\$UID/com.violation-bot"
  echo "     啟動：  launchctl bootstrap gui/\$UID $PLIST_PATH"
  echo "     重啟：  launchctl kickstart -k gui/\$UID/com.violation-bot"
  echo "     看 log：tail -f $LOG_DIR/stderr.log"
else
  echo "⏭  跳過 LaunchAgent；之後手動跑 npm run start:api 啟動"
fi

# ----------------------------------------------------------------------------
# 8) 顯示 LAN URL（讓手機可連）
# ----------------------------------------------------------------------------
echo
echo "═══════════════════════════════════════════════════════"
echo "                    ✅ 安裝完成"
echo "═══════════════════════════════════════════════════════"
echo
echo "📱 本機 Mac Mini 開啟："
echo "     http://127.0.0.1:8787/"
echo

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "未取得")
if [[ "$LAN_IP" != "未取得" ]]; then
  echo "📱 同 Wi-Fi / LAN 內手機或其他電腦開啟："
  echo "     http://$LAN_IP:8787/"
  echo
  echo "  （Mac Mini 必須開機 + 在同一 Wi-Fi）"
fi

echo
echo "═══════════════════════════════════════════════════════"
echo "若已安裝 LaunchAgent，服務目前正在背景跑。"
echo "若沒裝，請手動啟動：cd $PROJECT_DIR && npm run start:api"
echo "═══════════════════════════════════════════════════════"
