"""
數字辨識引擎（Digit Recognition Engine）
========================================
五大頂尖技術整合的統一後端服務：

  1. PARSeq      (ViT-CNN 混合)        — 場景文本、模糊扭曲、特殊字體
  2. CRNN+CTC    (PaddleOCR PP-OCRv5)  — 工業級高頻、極致速度
  3. VLM         (Qwen2.5-VL / Gemini) — 複雜不規則單據 → 結構化 JSON
  4. FOTS        (端到端 Text Spotting)— 動態影片幀、傾斜追蹤
  5. KAN         (Kolmogorov-Arnold)   — 嵌入式端側、單字元高精度

公開穩定 API：
  • DigitRecognitionEngine — 應用層 facade
  • RecognitionResult / RecognitionStatus — 統一輸出型別
  • ContextType — 內建情境枚舉
  • SmartDispatcher — 進階使用者直接操作調度器
"""
from .base import (
    BaseRecognizer,
    DispatcherError,
    InferenceError,
    ModelNotLoadedError,
    RateLimitError,
    RecognitionResult,
    RecognitionStatus,
    RecognizerError,
    with_retry,
    with_retry_async,
)
from .dispatcher import ContextType, SmartDispatcher
from .engine import DigitRecognitionEngine

__version__ = "0.1.0"
__all__ = [
    "DigitRecognitionEngine",
    "RecognitionResult",
    "RecognitionStatus",
    "ContextType",
    "SmartDispatcher",
    "BaseRecognizer",
    "RecognizerError",
    "ModelNotLoadedError",
    "InferenceError",
    "RateLimitError",
    "DispatcherError",
    "with_retry",
    "with_retry_async",
]
