#!/usr/bin/env bash
# ============================================================================
# Mobile www/ 建置腳本
# ============================================================================
# 從 ../web 複製 web UI，注入 Capacitor 整合，產出 mobile/www/
# 之後 npx cap sync 把 www/ 同步到 ios/ 與 android/
# ============================================================================
set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SRC="$ROOT/../web"
DST="$ROOT/www"

echo "→ 清空 $DST/"
rm -rf "$DST"
mkdir -p "$DST"

echo "→ 複製 web/ → www/"
cp -r "$SRC"/* "$DST/"

# Capacitor 6+ 自動把 capacitor.js 注入 index.html，不需手動加 script tag。
# 但我們需要把 mobile-specific JS 額外加入。

echo "→ 注入 mobile-bridge.js 到 index.html"
# 在 </body> 前插入 mobile-bridge.js (放 app.js 之前以便覆寫 fetch wrapper)
python3 - <<EOF
import re
from pathlib import Path
html = Path("$DST/index.html").read_text()
# 把 <script src="/app.js"></script> 換成 mobile-bridge.js + app.js
html = html.replace(
    '<script src="/app.js"></script>',
    '<script src="/mobile-bridge.js"></script>\n  <script src="/app.js"></script>'
)
# 把 viewport 改成 mobile-friendly
html = re.sub(
    r'<meta name="viewport"[^>]*>',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />',
    html,
)
Path("$DST/index.html").write_text(html)
EOF

# 複製 mobile-specific bridge JS
cp "$ROOT/scripts/mobile-bridge.js" "$DST/mobile-bridge.js"

echo "✅ 建置完成：$DST"
echo "   下一步：npx cap sync 或 npx cap open ios / android"
