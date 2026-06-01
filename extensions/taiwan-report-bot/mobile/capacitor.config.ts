import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 違規檢舉 — iOS/Android 設定
 *
 * appId 採反向 DNS。請改成您自有的 domain（避免與他人衝突）。
 * webDir 指向 build-www.sh 產出的目錄。
 */
const config: CapacitorConfig = {
  appId: "tw.violation.reporter",
  appName: "違規檢舉",
  webDir: "www",
  // 開發時可開啟 server.url 直連 Mac Mini API（避免每次改 web UI 都重 build）
  // server: {
  //   url: "http://192.168.1.100:8787",
  //   cleartext: true,
  // },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#121212",
  },
  android: {
    backgroundColor: "#121212",
    allowMixedContent: true, // 允許 LAN 上 HTTP（無 HTTPS 憑證時）
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: "#121212",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
    },
    Camera: {
      // 預設請求權限的字串（iOS Info.plist 必填）
      cameraDescription: "本 App 需要相機權限以拍攝違規證據",
      photosDescription: "本 App 需要相簿權限以選擇違規證據照片",
    },
    Geolocation: {
      locationDescription: "本 App 需要定位權限以自動填入違規地點",
    },
  },
};

export default config;
