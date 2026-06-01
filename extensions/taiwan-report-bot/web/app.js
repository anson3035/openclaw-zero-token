(() => {
  const TOKEN_KEY = "trb.token";
  const API = (path, opts = {}) => {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = { ...opts.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, { ...opts, headers }).then(async (r) => {
      const text = await r.text();
      const data = text ? JSON.parse(text) : {};
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    });
  };

  // ---------- Auth view ----------
  const authView = document.getElementById("authView");
  const appView = document.getElementById("appView");
  const userBar = document.getElementById("userBar");
  const userLabel = document.getElementById("userLabel");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const authError = document.getElementById("authError");

  function showError(msg) {
    authError.textContent = msg;
    authError.classList.remove("hidden");
  }
  function clearError() {
    authError.classList.add("hidden");
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.remove("bg-blue-600", "text-white");
        b.classList.add("bg-slate-100", "text-slate-700");
      });
      btn.classList.add("bg-blue-600", "text-white");
      btn.classList.remove("bg-slate-100", "text-slate-700");
      loginForm.classList.toggle("hidden", tab !== "login");
      registerForm.classList.toggle("hidden", tab !== "register");
      clearError();
    });
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const fd = new FormData(loginForm);
    try {
      const { token, user } = await API("/api/login", {
        method: "POST",
        body: { username: fd.get("username"), password: fd.get("password") },
      });
      localStorage.setItem(TOKEN_KEY, token);
      enterApp(user);
    } catch (err) {
      showError(err.message);
    }
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const fd = new FormData(registerForm);
    const nationalIdLast4 = fd.get("nationalIdLast4");
    try {
      const { token, user } = await API("/api/register", {
        method: "POST",
        body: {
          username: fd.get("username"),
          password: fd.get("password"),
          name: fd.get("name"),
          contact: fd.get("contact"),
          ...(nationalIdLast4 ? { nationalId: nationalIdLast4 } : {}),
        },
      });
      localStorage.setItem(TOKEN_KEY, token);
      enterApp(user);
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await API("/api/logout", { method: "POST" });
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  function enterApp(user) {
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    userBar.classList.remove("hidden");
    userLabel.textContent = `${user.identity.name}（${user.username}）`;
    loadCurrentSession();
  }

  // ---------- Upload & analyze ----------
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const uploadStatus = document.getElementById("uploadStatus");
  const captionEl = document.getElementById("caption");
  let pickedFiles = [];

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("bg-slate-100");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("bg-slate-100"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("bg-slate-100");
    pickedFiles = Array.from(e.dataTransfer.files);
    syncPicked();
  });
  fileInput.addEventListener("change", () => {
    pickedFiles = Array.from(fileInput.files || []);
    syncPicked();
  });
  function syncPicked() {
    analyzeBtn.disabled = pickedFiles.length === 0;
    dropZone.querySelector("p").textContent =
      pickedFiles.length === 0
        ? "將檔案拖曳至此，或點此選擇"
        : `已選 ${pickedFiles.length} 個檔案：${pickedFiles.map((f) => f.name).join(", ")}`;
  }

  // ---------- 手機 native 功能（透過 MobileBridge） ----------
  const mobileActions = document.getElementById("mobileActions");
  const cameraBtn = document.getElementById("cameraBtn");
  const geolocBtn = document.getElementById("geolocBtn");
  if (window.MobileBridge) {
    mobileActions.classList.remove("hidden");
    cameraBtn?.addEventListener("click", async () => {
      try {
        const file = await window.MobileBridge.takePhoto();
        pickedFiles.push(file);
        syncPicked();
      } catch (err) {
        alert("相機操作失敗：" + (err.message || err));
      }
    });
    geolocBtn?.addEventListener("click", async () => {
      try {
        const pos = await window.MobileBridge.getCurrentPosition();
        const txt = captionEl.value.trim();
        const geo = `（裝置定位：${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}，精度 ±${Math.round(pos.accuracy)}m）`;
        captionEl.value = txt ? `${txt}\n${geo}` : geo;
        alert(`✅ 已加入裝置定位至補充說明：\n${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}`);
      } catch (err) {
        alert("定位失敗：" + (err.message || err));
      }
    });
  }

  analyzeBtn.addEventListener("click", async () => {
    analyzeBtn.disabled = true;
    uploadStatus.textContent = "📥 上傳並分析中…（10–20 秒）";
    uploadStatus.classList.remove("hidden", "text-red-600");
    const fd = new FormData();
    pickedFiles.forEach((f) => fd.append("files", f));
    if (captionEl.value.trim()) fd.append("caption", captionEl.value.trim());
    try {
      const { artifact } = await API("/api/upload", { method: "POST", body: fd });
      uploadStatus.textContent = "✅ 分析完成";
      showReport(artifact);
      pickedFiles = [];
      fileInput.value = "";
      syncPicked();
    } catch (err) {
      uploadStatus.textContent = `❌ ${err.message}`;
      uploadStatus.classList.add("text-red-600");
    } finally {
      analyzeBtn.disabled = false;
    }
  });

  // ---------- Report ----------
  const reportCard = document.getElementById("reportCard");
  const reportMd = document.getElementById("reportMd");
  const complianceBanner = document.getElementById("complianceBanner");

  function showReport(artifact) {
    reportCard.classList.remove("hidden");
    reportMd.textContent = artifact.markdown;
    if (artifact.compliance.ok) {
      complianceBanner.className = "mb-3 p-3 rounded text-sm compliance-ok";
      complianceBanner.innerHTML = "✅ 已通過送件前合規檢查。";
    } else {
      complianceBanner.className = "mb-3 p-3 rounded text-sm compliance-warn";
      complianceBanner.innerHTML =
        "⚠ <b>尚未通過送件前合規檢查</b>，無法代寄：<ul class='list-disc ml-5 mt-1'>" +
        artifact.compliance.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("") +
        "</ul>";
    }
    reportCard.scrollIntoView({ behavior: "smooth" });
  }

  function escapeHtml(s) {
    return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  document.getElementById("recategorizeBtn").addEventListener("click", async () => {
    const cat = prompt("請輸入新類別：traffic / environment / building / condominium");
    if (!cat) return;
    try {
      const { artifact } = await API("/api/session/category", {
        method: "POST",
        body: { category: cat },
      });
      showReport(artifact);
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("setAddressBtn").addEventListener("click", async () => {
    const addr = prompt("請輸入完整地址（例：台北市中正區忠孝東路一段1號）");
    if (!addr) return;
    try {
      const { artifact } = await API("/api/session/address", {
        method: "POST",
        body: { address: addr },
      });
      showReport(artifact);
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("draftBtn").addEventListener("click", async () => {
    const { session } = await API("/api/session");
    if (!session) return alert("尚無進行中之檢舉");
    const text = `收件：${session.artifact.recipients.join(", ")}\n主旨：${session.artifact.emailSubject}\n\n${session.artifact.emailBody}`;
    try {
      await navigator.clipboard.writeText(text);
      alert("✅ email 草稿已複製到剪貼簿");
    } catch {
      prompt("請手動複製：", text);
    }
  });

  document.getElementById("smsBtn").addEventListener("click", async () => {
    try {
      const { sms } = await API("/api/sms");
      if (window.confirm(`📱 將開啟簡訊 App\n\n發送至：${sms.number}\n內容：${sms.body}\n\n是否繼續？`)) {
        window.location.href = sms.deepLink;
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Send (two-step) ----------
  const confirmModal = document.getElementById("confirmModal");
  const confirmPreview = document.getElementById("confirmPreview");
  const confirmSendBtn = document.getElementById("confirmSendBtn");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");

  document.getElementById("sendBtn").addEventListener("click", async () => {
    try {
      const r = await API("/api/send", { method: "POST", body: {} });
      if (r.pending) {
        confirmPreview.innerHTML = `
          <div><b>收件者</b>：${escapeHtml(r.preview.to)}</div>
          <div><b>主旨</b>：${escapeHtml(r.preview.subject)}</div>
          <div><b>附件數</b>：${r.preview.attachmentCount}</div>
        `;
        confirmModal.classList.remove("hidden");
      }
    } catch (err) {
      alert(err.message);
    }
  });

  confirmCancelBtn.addEventListener("click", () => confirmModal.classList.add("hidden"));
  confirmSendBtn.addEventListener("click", async () => {
    confirmSendBtn.disabled = true;
    try {
      const r = await API("/api/send", { method: "POST", body: { confirm: true } });
      alert(`✅ 已寄出\nMessage-ID: ${r.messageId}`);
      confirmModal.classList.add("hidden");
      reportCard.classList.add("hidden");
    } catch (err) {
      alert(`❌ ${err.message}`);
    } finally {
      confirmSendBtn.disabled = false;
    }
  });

  document.getElementById("cancelBtn").addEventListener("click", async () => {
    if (!confirm("確定取消本次檢舉？")) return;
    await API("/api/session/cancel", { method: "POST" });
    reportCard.classList.add("hidden");
  });

  // ---------- Bootstrap ----------
  async function loadCurrentSession() {
    try {
      const { session } = await API("/api/session");
      if (session) showReport(session.artifact);
    } catch {
      /* not logged in */
    }
  }

  async function bootstrap() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const { user } = await API("/api/me");
      enterApp(user);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  bootstrap();
})();
