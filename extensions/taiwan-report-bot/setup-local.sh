#!/usr/bin/env bash
# ============================================================================
# 台灣違規檢舉系統 — 本機部署助手
# ============================================================================
# 使用：
#   bash setup-local.sh                 # 互動式
#   bash setup-local.sh --reinstall     # 強制重裝 node_modules
#   bash setup-local.sh --non-interactive  # CI / 跳過所有提問
# ============================================================================
set -e

# 切到腳本所在目錄
cd "$(dirname "$0")"

REINSTALL=0
INTERACTIVE=1
for arg in "$@"; do
  case "$arg" in
    --reinstall) REINSTALL=1 ;;
    --non-interactive) INTERACTIVE=0 ;;
  esac
done

# cross-platform sed -i
sedi() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

echo "╔════════════════════════════════════════════════════╗"
echo "║   台灣違規檢舉系統 — 本機部署助手 (Setup Local)   ║"
echo "╚════════════════════════════════════════════════════╝"
echo

# ----------------------------------------------------------------------------
# 1) Node 檢查
# ----------------------------------------------------------------------------
if ! command -v node &> /dev/null; then
  echo "❌ 未安裝 Node.js"
  echo "   請從 https://nodejs.org/ 下載 Node 22 LTS"
  exit 1
fi
NODE_VER=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_VER" -lt 20 ]; then
  echo "❌ Node 版本太舊：$(node -v)（需要 ≥ 20）"
  exit 1
fi
echo "✅ Node $(node -v)"

if ! command -v npm &> /dev/null; then
  echo "❌ 未安裝 npm"; exit 1
fi
echo "✅ npm $(npm -v)"

# ----------------------------------------------------------------------------
# 2) npm install
# ----------------------------------------------------------------------------
if [ ! -d "node_modules" ] || [ "$REINSTALL" = "1" ]; then
  echo
  echo "→ 安裝依賴（1–3 分鐘）..."
  npm install --loglevel=error --no-audit --no-fund
fi
echo "✅ 依賴已安裝 ($(ls node_modules 2>/dev/null | wc -l | tr -d ' ') packages)"

# ----------------------------------------------------------------------------
# 3) .env 設定
# ----------------------------------------------------------------------------
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo
  echo "→ 已建立 .env（從 .env.example 複製）"

  if [ "$INTERACTIVE" = "1" ]; then
    echo
    echo "─────────────────────────────────────────────────────"
    echo "本系統至少需要 OPENAI_API_KEY 才能進行影像分析（gpt-4o vision）。"
    echo "取得：https://platform.openai.com/api-keys"
    echo "─────────────────────────────────────────────────────"
    read -p "請貼上 OPENAI_API_KEY (sk-...): " OPENAI_KEY
    if [ -n "$OPENAI_KEY" ]; then
      sedi "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$OPENAI_KEY|" .env
    fi

    echo
    echo "（選填）GEMINI_API_KEY — 啟用跨引擎投票，大幅提升車牌辨識精度。"
    echo "取得：https://aistudio.google.com/app/apikey （免費）"
    read -p "GEMINI_API_KEY（按 Enter 跳過）: " GEMINI_KEY
    if [ -n "$GEMINI_KEY" ]; then
      sedi "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=$GEMINI_KEY|" .env
    fi

    echo
    echo "（選填）TELEGRAM_BOT_TOKEN — 啟用 Telegram 聊天機器人介面。"
    echo "向 Telegram 上 @BotFather 註冊取得。"
    read -p "TELEGRAM_BOT_TOKEN（按 Enter 跳過，只跑 Web/Desktop）: " TG_TOKEN
    if [ -n "$TG_TOKEN" ]; then
      sedi "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TG_TOKEN|" .env
    else
      # 給個 placeholder 讓 config 驗證過關（web-only 模式不會用到）
      sedi "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=0000000000:placeholder_web_only|" .env
    fi

    echo
    echo "（選填）SMTP 設定 — 啟用「由系統代寄」功能。"
    echo "建議用 Gmail 應用程式密碼："
    echo "  https://support.google.com/accounts/answer/185833"
    read -p "SMTP_USER（Email，按 Enter 跳過）: " SMTP_U
    if [ -n "$SMTP_U" ]; then
      read -s -p "SMTP_PASS（應用程式密碼）: " SMTP_P
      echo
      sedi "s|^SMTP_USER=.*|SMTP_USER=$SMTP_U|" .env
      sedi "s|^SMTP_PASS=.*|SMTP_PASS=$SMTP_P|" .env
    fi
  fi
fi
echo "✅ .env 已就緒"

# ----------------------------------------------------------------------------
# 4) 健康檢查
# ----------------------------------------------------------------------------
echo
echo "→ 跑 TypeScript typecheck..."
if npx tsc --noEmit > /tmp/trb-tsc.log 2>&1; then
  echo "✅ Typecheck 通過"
else
  echo "⚠ Typecheck 有問題（前 20 行）："
  head -20 /tmp/trb-tsc.log
fi

# ----------------------------------------------------------------------------
# 5) 完成訊息
# ----------------------------------------------------------------------------
cat <<EOF

╔════════════════════════════════════════════════════╗
║                  ✅ 設定完成！                    ║
╚════════════════════════════════════════════════════╝

接下來請從以下擇一啟動：

  📱 網頁版（推薦首次嘗試）
     npm run start:api
     瀏覽器開 → http://127.0.0.1:8787/

  🖥  桌面版（Electron 視窗）
     npm run desktop

  💬 Telegram bot（需 TELEGRAM_BOT_TOKEN）
     RUN=bot npm start

  🚀 全部一起跑（bot + web）
     npm start

  🧪 跑測試（162 個 unit tests）
     npm test

  📚 完整文件：
     README.md

═══════════════════════════════════════════════════════
若遇問題，常見排查：
  • Node 版本：node --version 應 ≥ 20
  • 確認 .env 內 OPENAI_API_KEY 有值
  • Port 8787 被占用 → HTTP_PORT=8788 npm run start:api
  • macOS 首次跑 Electron 會問安全性，到「系統設定 → 隱私
    與安全性」按「強制開啟」
═══════════════════════════════════════════════════════
EOF
