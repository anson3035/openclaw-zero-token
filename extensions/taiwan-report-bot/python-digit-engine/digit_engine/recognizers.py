"""
五大辨識器骨架實作
====================
每個類別都實作 BaseRecognizer 介面。實際模型推論的部分留為 TODO 註解，
僅提供方法簽章、輸入/輸出契約、與該技術的最佳實踐與部署建議。

  1. ParseqRecognizer    — ViT-CNN 混合（場景文本、模糊、扭曲）
  2. CrnnCtcRecognizer   — CRNN+CTC（極致速度、低延遲）
  3. VlmRecognizer       — 多模態 VLM（複雜單據 → 結構化 JSON）
  4. FotsRecognizer      — 端到端 Text Spotting（影片幀）
  5. KanRecognizer       — Kolmogorov-Arnold Networks（嵌入式端側）
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

from .base import (
    BaseRecognizer,
    ModelNotLoadedError,
    RateLimitError,
    RecognitionResult,
    with_retry,
    with_retry_async,
)

logger = logging.getLogger("digit_engine.recognizers")


# =============================================================================
# 1. PARSeq — ViT-CNN 混合，場景文本/模糊/扭曲首選
# =============================================================================

class ParseqRecognizer(BaseRecognizer):
    """
    PARSeq (Permuted AutoRegressive Sequence) 辨識器。

    架構特性：
      • ViT 編碼器擷取全局上下文 + CNN patch embedding 處理局部紋理
      • Permuted training 解決 AR / NAR 的權衡
      • 對「場景文本（街景招牌、車牌、模糊扭曲文字）」最佳

    部署建議：
      • PyTorch checkpoint → ONNX → TensorRT，可加速 3–5×
      • 標準輸入：128×32 灰階或 RGB
      • Charset 可動態切換（純數字 / 英數混合 / 中文）

    依賴：torch, torchvision, timm（ViT backbone）
    參考：https://github.com/baudm/parseq
    """

    name = "PARSeq (ViT-CNN)"
    supports_async_native = False  # 本地 GPU 推論

    def __init__(
        self,
        model_path: str = "weights/parseq.pt",
        charset: str = "0123456789",
        device: str = "cuda",
        input_size: tuple[int, int] = (32, 128),  # (H, W)
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(model_path=model_path, device=device, config=config)
        self.charset = charset
        self.input_size = input_size
        self._model: object | None = None
        self._transform: object | None = None

    def _load(self) -> None:
        # 真實實作：
        #   import torch
        #   self._model = torch.hub.load("baudm/parseq", "parseq", pretrained=True)
        #   self._model.eval().to(self.device)
        #   self._transform = build_transform(self.input_size)
        logger.info("[skeleton] 載入 PARSeq from %s on %s", self.model_path, self.device)
        self._model = "<PARSEQ_MODEL_PLACEHOLDER>"

    def _predict_impl(self, image_path: str) -> tuple[str, float, dict]:
        if self._model is None:
            raise ModelNotLoadedError("PARSeq 模型未載入")

        # 真實實作：
        #   from PIL import Image
        #   img = Image.open(image_path).convert("RGB")
        #   img_t = self._transform(img).unsqueeze(0).to(self.device)
        #   with torch.no_grad():
        #       logits = self._model(img_t)
        #       pred, confidence_per_char = self._model.tokenizer.decode(logits)
        #   text = pred[0]
        #   confidence = float(confidence_per_char[0].mean())

        # Skeleton 回傳：
        text = "1234567"
        confidence = 0.93
        metadata = {
            "model_family": "vit-cnn-hybrid",
            "input_size": self.input_size,
            "charset_size": len(self.charset),
        }
        return text, confidence, metadata

    def export_onnx(self, output_path: str, opset: int = 17) -> None:
        # 真實實作：
        #   dummy = torch.randn(1, 3, *self.input_size).to(self.device)
        #   torch.onnx.export(
        #       self._model, dummy, output_path,
        #       opset_version=opset, dynamic_axes={"input": {0: "batch"}}, ...
        #   )
        logger.info("[skeleton] 匯出 PARSeq ONNX → %s (opset=%d)", output_path, opset)


# =============================================================================
# 2. CRNN + CTC (PaddleOCR PP-OCRv5) — 工業級極致速度
# =============================================================================

class CrnnCtcRecognizer(BaseRecognizer):
    """
    CRNN + CTC 辨識器（基於 PaddleOCR PP-OCRv5）。

    架構特性：
      • CNN backbone（MobileNetV3 / PP-LCNet）→ BiLSTM → CTC decoder
      • 極致輕量：模型 < 5 MB，CPU 推論 < 20 ms / image
      • 標準連續數字串（身分證號、單據號、車牌等）首選

    部署建議：
      • Paddle inference model 可直接轉 ONNX（paddle2onnx）
      • 啟用 MKL-DNN 加速 CPU 推論
      • 批次推論線性擴展 throughput

    依賴：paddleocr or paddlepaddle
    """

    name = "CRNN+CTC (PP-OCRv5)"
    supports_async_native = False

    def __init__(
        self,
        model_path: str = "weights/ppocrv5_rec.pdmodel",
        device: str = "cpu",
        use_mkldnn: bool = True,
        rec_image_shape: tuple[int, int, int] = (3, 48, 320),  # (C, H, W)
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(model_path=model_path, device=device, config=config)
        self.use_mkldnn = use_mkldnn
        self.rec_image_shape = rec_image_shape
        self._ocr: object | None = None

    def _load(self) -> None:
        # 真實實作：
        #   from paddleocr import PaddleOCR
        #   self._ocr = PaddleOCR(
        #       use_angle_cls=False,
        #       lang="en",
        #       rec_model_dir=os.path.dirname(self.model_path),
        #       use_gpu=(self.device == "cuda"),
        #       enable_mkldnn=self.use_mkldnn,
        #   )
        logger.info("[skeleton] 載入 PaddleOCR PP-OCRv5 (mkldnn=%s)", self.use_mkldnn)
        self._ocr = "<PADDLEOCR_PLACEHOLDER>"

    def _predict_impl(self, image_path: str) -> tuple[str, float, dict]:
        if self._ocr is None:
            raise ModelNotLoadedError("PaddleOCR 模型未載入")

        # 真實實作：
        #   result = self._ocr.ocr(image_path, cls=False, det=False)
        #   text, conf = result[0][0][1]

        text = "A123456789"
        confidence = 0.98
        metadata = {
            "model_family": "crnn-ctc",
            "engine": "paddle-inference",
            "rec_image_shape": self.rec_image_shape,
            "mkldnn": self.use_mkldnn,
        }
        return text, confidence, metadata

    def export_onnx(self, output_path: str, opset: int = 17) -> None:
        # 實際使用 paddle2onnx：
        #   paddle2onnx --model_dir ... --save_file output.onnx --opset_version 17
        logger.info("[skeleton] 匯出 PP-OCRv5 ONNX → %s", output_path)


# =============================================================================
# 3. VLM (Qwen2.5-VL / Gemini) — 複雜單據 → 結構化 JSON
# =============================================================================

class VlmRecognizer(BaseRecognizer):
    """
    多模態視覺語言模型辨識器。

    架構特性：
      • 端到端理解整張單據佈局（不需 detection → recognition → reconstruction 三段）
      • 直接輸出結構化 JSON（如：發票號、日期、金額、品項列表）
      • 對「複雜不規則財稅單據、有邏輯推理需求」場景無可替代

    成本 / 延遲：
      • API 呼叫延遲 1–5 秒，比本地模型高 10–100×
      • 按 token 計費，單張單據約 $0.001–0.01
      • 本地部署 Qwen2.5-VL-7B 需 ~16 GB VRAM

    依賴：dashscope（Qwen）/ google-generativeai（Gemini）/ openai（OpenAI-compat）
    """

    name = "VLM (Qwen2.5-VL / Gemini)"
    supports_async_native = True  # API 類，原生 async

    DEFAULT_SCHEMA = {
        "type": "object",
        "properties": {
            "document_type": {"type": "string"},
            "fields": {"type": "object"},
        },
        "required": ["document_type", "fields"],
    }

    def __init__(
        self,
        provider: str = "qwen",  # "qwen" | "gemini" | "openai"
        model_id: str = "qwen2.5-vl-72b-instruct",
        api_key_env: str = "DASHSCOPE_API_KEY",
        output_schema: Optional[dict] = None,
        timeout_s: int = 30,
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(device="api", config=config)
        self.provider = provider
        self.model_id = model_id
        self.api_key_env = api_key_env
        self.output_schema = output_schema or self.DEFAULT_SCHEMA
        self.timeout_s = timeout_s
        self._client: object | None = None

    def _load(self) -> None:
        api_key = os.environ.get(self.api_key_env)
        if not api_key:
            # Skeleton 模式：允許未設 key（測試環境），但記錄警告
            logger.warning(
                "環境變數 %s 未設定，VLM 將以 skeleton 模式運作", self.api_key_env
            )
        # 真實實作：
        #   if self.provider == "qwen":
        #       import dashscope
        #       dashscope.api_key = api_key
        #       self._client = dashscope.MultiModalConversation
        #   elif self.provider == "gemini":
        #       import google.generativeai as genai
        #       genai.configure(api_key=api_key)
        #       self._client = genai.GenerativeModel(self.model_id)
        logger.info(
            "[skeleton] VLM 客戶端初始化 (provider=%s, model=%s)",
            self.provider,
            self.model_id,
        )
        self._client = f"<{self.provider}_CLIENT_PLACEHOLDER>"

    def _build_prompt(self) -> str:
        return (
            "你是商業單據結構化辨識引擎。請從影像中擷取所有關鍵欄位，"
            "依以下 JSON schema 輸出，不要包 markdown：\n"
            f"{self.output_schema}\n"
            "若某欄位無法辨識，請用 null 而不要省略。"
        )

    @with_retry(max_attempts=3, retryable=(RateLimitError, ConnectionError, TimeoutError))
    def _predict_impl(self, image_path: str) -> tuple[str, float, dict]:
        if self._client is None:
            raise ModelNotLoadedError("VLM 客戶端未初始化")

        prompt = self._build_prompt()
        # 真實實作（dashscope/Qwen 範例）：
        #   import dashscope
        #   from dashscope import MultiModalConversation
        #   response = MultiModalConversation.call(
        #       model=self.model_id,
        #       messages=[{
        #           "role": "user",
        #           "content": [
        #               {"image": f"file://{image_path}"},
        #               {"text": prompt},
        #           ],
        #       }],
        #       response_format={"type": "json_object"},
        #       timeout=self.timeout_s,
        #   )
        #   if response.status_code == 429:
        #       raise RateLimitError(response.message)
        #   parsed = json.loads(response.output.choices[0].message.content)

        parsed = {
            "document_type": "invoice",
            "fields": {
                "invoice_number": "AB12345678",
                "date": "2026-06-12",
                "total": "1234",
                "vendor": "示範商號股份有限公司",
            },
        }
        # VLM 的 "text" 通常是「主鍵」欄位（如發票號），完整解析在 metadata
        primary = parsed.get("fields", {}).get("invoice_number", "")
        # VLM 通常無明確 token-level confidence，使用 heuristic
        confidence = 0.91
        metadata = {
            "model_family": "vlm",
            "provider": self.provider,
            "model_id": self.model_id,
            "structured_output": parsed,
            "prompt_used": prompt[:120] + "…",
        }
        return primary, confidence, metadata

    @with_retry_async()
    async def _predict_async_native(self, image: str) -> RecognitionResult:
        """
        原生 async：用 httpx.AsyncClient 對 VLM API 發出非同步呼叫。
        Skeleton 簡化為 to_thread。
        """
        return await asyncio.to_thread(self.predict, image)


# =============================================================================
# 4. FOTS — 端到端 Text Spotting（檢測 + 辨識一步到位，影片幀首選）
# =============================================================================

class FotsRecognizer(BaseRecognizer):
    """
    FOTS (Fast Oriented Text Spotting) 辨識器。

    架構特性：
      • ResNet + FPN backbone → shared features
      • 兩個 head：text detection（EAST-style）+ recognition（RoIRotate + LSTM）
      • 端到端訓練：偵測與辨識共用特徵，整體延遲 < 50 ms / frame
      • RoIRotate 自動校正傾斜文字，適合「動態影片、斜角拍攝、車牌追蹤」

    部署建議：
      • CUDA + TensorRT 可達 30 fps @ 720p
      • 支援多文字實例同時辨識（一張影格可能有多個目標）

    依賴：torch, opencv-python, shapely（多邊形 NMS）
    """

    name = "FOTS (Text Spotting)"
    supports_async_native = False

    def __init__(
        self,
        model_path: str = "weights/fots.pth",
        device: str = "cuda",
        score_threshold: float = 0.7,
        nms_threshold: float = 0.2,
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(model_path=model_path, device=device, config=config)
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self._model: object | None = None

    def _load(self) -> None:
        # 真實實作：載入 PyTorch checkpoint，建立 detection + recognition heads
        logger.info("[skeleton] 載入 FOTS from %s on %s", self.model_path, self.device)
        self._model = "<FOTS_MODEL_PLACEHOLDER>"

    def _predict_impl(self, image_path: str) -> tuple[str, float, dict]:
        if self._model is None:
            raise ModelNotLoadedError("FOTS 模型未載入")

        # 真實實作：
        #   image = cv2.imread(image_path)
        #   detections = self._model.detect(image)            # 多邊形 list
        #   spotted = []
        #   for poly in detections:
        #       cropped = roi_rotate(image, poly)
        #       text, conf = self._model.recognize(cropped)
        #       if conf > self.score_threshold:
        #           spotted.append({"text": text, "conf": conf, "poly": poly.tolist()})

        spotted = [
            {
                "text": "BGM-9090",
                "conf": 0.93,
                "poly": [[100, 200], [200, 200], [200, 250], [100, 250]],
            },
            {
                "text": "ABC-1234",
                "conf": 0.88,
                "poly": [[300, 200], [400, 200], [400, 250], [300, 250]],
            },
        ]
        primary = max(spotted, key=lambda x: x["conf"])
        text = str(primary["text"])
        confidence = float(primary["conf"])
        metadata = {
            "model_family": "end-to-end-text-spotter",
            "instances_detected": len(spotted),
            "all_instances": spotted,
            "score_threshold": self.score_threshold,
        }
        return text, confidence, metadata


# =============================================================================
# 5. KAN — Kolmogorov-Arnold Networks，嵌入式端側單字元/符號分類
# =============================================================================

class KanRecognizer(BaseRecognizer):
    """
    KAN (Kolmogorov-Arnold Networks) 衍生辨識器。

    架構特性：
      • 以可學習的 spline 啟動函式取代固定的 ReLU；參數量極小
      • 對「單一字元 / 數字符號」分類任務有極高精度與可解釋性
      • 適合 STM32 / Raspberry Pi / 工業 PLC 等嵌入式裝置

    部署建議：
      • 模型 < 100 KB（量化後）
      • 可匯出為純 C 程式碼或 TFLite-micro
      • 不適合長序列辨識（限定單字元場景，需與 detector 搭配）

    依賴：pykan / efficient-kan
    參考：https://github.com/KindXiaoming/pykan
    """

    name = "KAN (edge classifier)"
    supports_async_native = False

    def __init__(
        self,
        model_path: str = "weights/kan_digit.pt",
        device: str = "cpu",
        input_size: tuple[int, int] = (28, 28),
        num_classes: int = 10,
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(model_path=model_path, device=device, config=config)
        self.input_size = input_size
        self.num_classes = num_classes
        self._model: object | None = None

    def _load(self) -> None:
        # 真實實作：
        #   from kan import KAN
        #   self._model = KAN(width=[28*28, 16, 10], grid=5, k=3)
        #   self._model.load_state_dict(torch.load(self.model_path, map_location=self.device))
        #   self._model.eval().to(self.device)
        logger.info(
            "[skeleton] 載入 KAN from %s (input=%s, classes=%d)",
            self.model_path,
            self.input_size,
            self.num_classes,
        )
        self._model = "<KAN_MODEL_PLACEHOLDER>"

    def _predict_impl(self, image_path: str) -> tuple[str, float, dict]:
        if self._model is None:
            raise ModelNotLoadedError("KAN 模型未載入")

        # 真實實作：
        #   from PIL import Image
        #   img = Image.open(image_path).convert("L").resize(self.input_size)
        #   tensor = torch.tensor(np.array(img) / 255.).float().flatten().unsqueeze(0)
        #   with torch.no_grad():
        #       logits = self._model(tensor)
        #       probs = torch.softmax(logits, dim=-1)
        #       cls = int(probs.argmax(dim=-1))
        #       conf = float(probs[0, cls])

        cls = 7
        conf = 0.99
        text = str(cls)
        metadata = {
            "model_family": "kan",
            "input_size": self.input_size,
            "num_classes": self.num_classes,
            "footprint_kb": 95,  # 預估量化後大小
        }
        return text, conf, metadata

    def export_onnx(self, output_path: str, opset: int = 17) -> None:
        # KAN 可匯出 ONNX；建議再轉 TFLite-micro 部署到 MCU
        logger.info("[skeleton] 匯出 KAN ONNX → %s", output_path)
