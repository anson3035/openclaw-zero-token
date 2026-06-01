/**
 * Mobile Bridge — 把 Capacitor native plugins 接到既有 web app.js
 *
 * 此檔在 app.js 之前載入，會：
 *   1. 重寫 fetch() 加上設定中的 API base URL
 *   2. 增 window.MobileBridge API 給 app.js 呼叫 native plugins
 *   3. 提供 settings UI（齒輪圖示）讓使用者設定 API 端點
 *
 * 若不在 Capacitor 環境（純瀏覽器開啟）：bridge 不啟用，app.js 行為照舊
 */
(function () {
  const isNative =
    typeof window.Capacitor !== "undefined" &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform();

  // ============================================================================
  // 1. API base URL 配置（從 localStorage 讀，可由 settings UI 修改）
  // ============================================================================
  const DEFAULT_API = isNative ? "" : window.location.origin;
  // 從持久化儲存讀（native 用 Preferences，web 用 localStorage）
  let apiBase = localStorage.getItem("trb.apiBase") || DEFAULT_API;

  // 重寫 fetch — 把 /api/... 自動加上 apiBase 前綴
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string" && input.startsWith("/api/") && apiBase) {
      return origFetch(apiBase + input, init);
    }
    return origFetch(input, init);
  };

  // ============================================================================
  // 2. Settings UI — 齒輪圖示，可改 API base URL
  // ============================================================================
  function buildSettingsButton() {
    const btn = document.createElement("button");
    btn.id = "trb-settings-btn";
    btn.setAttribute(
      "style",
      "position:fixed;top:10px;right:10px;z-index:999;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;",
    );
    btn.textContent = "⚙";
    btn.title = "設定 API 端點";
    btn.addEventListener("click", openSettings);
    document.body.appendChild(btn);
  }

  function openSettings() {
    const current = apiBase || "（未設定）";
    const next = prompt(
      `設定 API 端點\n\n目前：${current}\n\n` +
        "範例：\n" +
        "  • 本機 LAN：http://192.168.1.100:8787\n" +
        "  • Tailscale：http://mac-mini.your-tailnet.ts.net:8787\n" +
        "  • 雲端：https://your-api.example.com\n\n" +
        "輸入新端點（清空則用預設）：",
      apiBase,
    );
    if (next === null) return;
    apiBase = next.trim();
    if (apiBase) {
      localStorage.setItem("trb.apiBase", apiBase);
    } else {
      localStorage.removeItem("trb.apiBase");
    }
    alert(`✅ API 端點已設定為：${apiBase || "預設"}\n\n畫面將重新整理。`);
    location.reload();
  }

  // 等 DOM ready 再加按鈕
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildSettingsButton);
  } else {
    buildSettingsButton();
  }

  // ============================================================================
  // 3. MobileBridge API — 給 app.js 用的 native 接口
  // ============================================================================
  const MobileBridge = {
    isNative,
    apiBase: () => apiBase,

    /**
     * 用相機拍照，回傳 File 物件供上傳。
     * native：用 Capacitor Camera plugin
     * web：fallback 到 <input type="file" capture="camera">
     */
    async takePhoto() {
      if (isNative && window.Capacitor.Plugins.Camera) {
        const { Camera, CameraResultType, CameraSource } =
          window.Capacitor.Plugins;
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: "base64",
          source: "CAMERA",
          saveToGallery: true,
        });
        // base64 → Blob → File
        const bin = atob(photo.base64String);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], { type: `image/${photo.format || "jpeg"}` });
        return new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type });
      }
      // Web fallback
      return new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = "environment";
        input.onchange = () => {
          if (input.files && input.files[0]) resolve(input.files[0]);
          else reject(new Error("No file selected"));
        };
        input.click();
      });
    },

    /**
     * 取得目前位置（lat/lon），用於自動填入違規地點。
     */
    async getCurrentPosition() {
      if (isNative && window.Capacitor.Plugins.Geolocation) {
        const { Geolocation } = window.Capacitor.Plugins;
        const perm = await Geolocation.requestPermissions();
        if (perm.location !== "granted") {
          throw new Error("使用者拒絕定位權限");
        }
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
        });
        return {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      }
      // Web fallback
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("此裝置不支援定位"));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 10000 },
        );
      });
    },

    /**
     * 用 native share sheet 分享 PDF / URL
     */
    async share(opts) {
      if (isNative && window.Capacitor.Plugins.Share) {
        const { Share } = window.Capacitor.Plugins;
        return await Share.share(opts);
      }
      // Web Share API fallback
      if (navigator.share) {
        return await navigator.share(opts);
      }
      // 都不支援
      throw new Error("此裝置不支援分享功能");
    },

    /**
     * Native preferences（比 localStorage 安全；token 應存這裡）
     */
    async setSecure(key, value) {
      if (isNative && window.Capacitor.Plugins.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        return await Preferences.set({ key, value: String(value) });
      }
      localStorage.setItem(key, String(value));
    },

    async getSecure(key) {
      if (isNative && window.Capacitor.Plugins.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        const { value } = await Preferences.get({ key });
        return value;
      }
      return localStorage.getItem(key);
    },

    async removeSecure(key) {
      if (isNative && window.Capacitor.Plugins.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        return await Preferences.remove({ key });
      }
      localStorage.removeItem(key);
    },

    /**
     * 連線狀態（離線時可提示使用者）
     */
    async getNetworkStatus() {
      if (isNative && window.Capacitor.Plugins.Network) {
        const { Network } = window.Capacitor.Plugins;
        return await Network.getStatus();
      }
      return { connected: navigator.onLine, connectionType: "unknown" };
    },
  };

  window.MobileBridge = MobileBridge;

  // ============================================================================
  // 4. 啟動時的 native 整合（status bar、splash 自動 hide）
  // ============================================================================
  if (isNative) {
    document.addEventListener("DOMContentLoaded", async () => {
      try {
        if (window.Capacitor.Plugins.StatusBar) {
          const { StatusBar } = window.Capacitor.Plugins;
          await StatusBar.setBackgroundColor({ color: "#121212" });
          await StatusBar.setStyle({ style: "Dark" });
        }
        if (window.Capacitor.Plugins.SplashScreen) {
          const { SplashScreen } = window.Capacitor.Plugins;
          await SplashScreen.hide();
        }
      } catch (err) {
        console.error("[mobile-bridge] native init failed:", err);
      }

      // 提示如果 API 還沒設定
      if (!apiBase) {
        setTimeout(() => {
          alert(
            "⚙ 首次使用提示：\n\n" +
              "請按右上角齒輪設定 API 端點，指向您的 Mac Mini。\n" +
              "範例：http://192.168.1.100:8787",
          );
        }, 1000);
      }
    });
  }
})();
