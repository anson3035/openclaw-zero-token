"""
基礎抽象層
============
定義所有辨識器（Recognizer）必須遵循的抽象介面、統一輸出型別、
共用例外與重試 / 非同步輔助函式。

設計原則：
  • 低耦合：BaseRecognizer 不依賴任何特定深度學習框架
  • 高內聚：所有辨識器都產出相同的 RecognitionResult
  • 可測試：純抽象方法 + 明確契約
  • 可優化：保留 ONNX / TensorRT 匯出 hook
"""
from __future__ import annotations

import asyncio
import functools
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional, TypeVar

logger = logging.getLogger("digit_engine")


# =============================================================================
# 統一輸出型別
# =============================================================================

class RecognitionStatus(str, Enum):
    """辨識狀態枚舉。子類使用 .value 即可序列化為字串。"""

    SUCCESS = "success"
    LOW_CONFIDENCE = "low_confidence"
    ERROR = "error"
    TIMEOUT = "timeout"


@dataclass
class RecognitionResult:
    """
    統一辨識輸出格式。

    所有 Recognizer.predict() 必須回傳此型別。下游消費者只依賴此契約，
    不需要知道實際是哪個模型產出，達成「呼叫端 0 變更」的擴充性。

    欄位：
      status      — RecognitionStatus 枚舉
      text        — 辨識出的數字 / 文字字串
      confidence  — 0.0–1.0 的信心分數
      latency_ms  — 本次推論延遲（毫秒）
      metadata    — 任意附加資訊（如：推論引擎名、bbox、原始 logits…）
    """

    status: RecognitionStatus
    text: str
    confidence: float
    latency_ms: float
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """轉成可 JSON 序列化的字典（status 自動轉成字串）。"""
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @classmethod
    def from_error(
        cls,
        message: str,
        latency_ms: float = 0.0,
        **meta: Any,
    ) -> "RecognitionResult":
        """便利建構式：產生表示「失敗」的 RecognitionResult。"""
        return cls(
            status=RecognitionStatus.ERROR,
            text="",
            confidence=0.0,
            latency_ms=latency_ms,
            metadata={"error": message, **meta},
        )


# =============================================================================
# 例外體系
# =============================================================================

class RecognizerError(Exception):
    """所有辨識器自定例外的根類別。"""


class ModelNotLoadedError(RecognizerError):
    """模型尚未載入即被呼叫。"""


class InferenceError(RecognizerError):
    """推論期間發生不可恢復的錯誤。"""


class RateLimitError(RecognizerError):
    """API 速率限制（觸發指數退避重試）。"""


class DispatcherError(Exception):
    """調度器層的例外（無對應 recognizer / 路由失敗）。"""


# =============================================================================
# 重試裝飾器（指數退避）
# =============================================================================

T = TypeVar("T")


def with_retry(
    max_attempts: int = 3,
    initial_backoff_s: float = 1.0,
    max_backoff_s: float = 30.0,
    backoff_multiplier: float = 2.0,
    retryable: tuple[type[Exception], ...] = (
        RateLimitError,
        ConnectionError,
        TimeoutError,
    ),
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """
    指數退避重試裝飾器（同步版本）。

    可重試的例外類型由 `retryable` 指定；其餘例外直接拋出，不重試。
    """

    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            attempt = 0
            backoff = initial_backoff_s
            last_exc: Optional[Exception] = None
            while attempt < max_attempts:
                try:
                    return fn(*args, **kwargs)
                except retryable as exc:
                    last_exc = exc
                    attempt += 1
                    if attempt >= max_attempts:
                        break
                    logger.warning(
                        "%s 觸發可重試例外 (attempt %d/%d, backoff=%.1fs)：%s",
                        fn.__name__,
                        attempt,
                        max_attempts,
                        backoff,
                        exc,
                    )
                    time.sleep(backoff)
                    backoff = min(max_backoff_s, backoff * backoff_multiplier)
            assert last_exc is not None
            raise last_exc

        return wrapper

    return decorator


def with_retry_async(
    max_attempts: int = 3,
    initial_backoff_s: float = 1.0,
    max_backoff_s: float = 30.0,
    backoff_multiplier: float = 2.0,
    retryable: tuple[type[Exception], ...] = (
        RateLimitError,
        ConnectionError,
        TimeoutError,
        asyncio.TimeoutError,
    ),
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """指數退避重試裝飾器（非同步版本）。"""

    def decorator(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            attempt = 0
            backoff = initial_backoff_s
            last_exc: Optional[Exception] = None
            while attempt < max_attempts:
                try:
                    return await fn(*args, **kwargs)
                except retryable as exc:
                    last_exc = exc
                    attempt += 1
                    if attempt >= max_attempts:
                        break
                    logger.warning(
                        "%s 觸發可重試例外 (attempt %d/%d, backoff=%.1fs)：%s",
                        fn.__name__,
                        attempt,
                        max_attempts,
                        backoff,
                        exc,
                    )
                    await asyncio.sleep(backoff)
                    backoff = min(max_backoff_s, backoff * backoff_multiplier)
            assert last_exc is not None
            raise last_exc

        return wrapper

    return decorator


# =============================================================================
# 抽象基類：所有 Recognizer 必須繼承
# =============================================================================

class BaseRecognizer(ABC):
    """
    辨識器抽象基類。

    具體子類**必須**實作：
      • _load()        — 載入權重 / 建立 session
      • _predict_impl(image_path) → (text, confidence, metadata)

    本基類負責：
      • 統一計時與包裝（將 _predict_impl 結果包成 RecognitionResult）
      • 同步 / 非同步雙介面
      • 例外捕獲與轉成 status=ERROR
      • 呼叫統計（給 dispatcher 做負載決策）
      • ONNX / TensorRT 匯出 hook（子類可選擇覆寫）

    子類可選覆寫：
      • warmup()                    — 暖機策略
      • _predict_async_native()     — API 類使用原生 async IO
      • export_onnx() / export_tensorrt()
    """

    # 子類應覆寫
    name: str = "BaseRecognizer"
    # API 類辨識器設為 True；本地模型保持 False（走 thread pool）
    supports_async_native: bool = False

    def __init__(
        self,
        model_path: Optional[str] = None,
        device: str = "cpu",
        config: Optional[dict] = None,
    ) -> None:
        self.model_path = model_path
        self.device = device
        self.config = config or {}
        self._loaded = False
        self._call_count = 0
        self._total_latency_ms = 0.0

    # ----- 生命週期 -----

    def load(self) -> None:
        """載入權重 / 建立 session。idempotent，重複呼叫不會重新載入。"""
        if self._loaded:
            return
        self._load()
        self._loaded = True
        logger.info("%s 已載入 (device=%s)", self.name, self.device)

    @abstractmethod
    def _load(self) -> None: ...

    def warmup(self, n: int = 1) -> None:
        """暖機：跑 n 次假輸入推論避免冷啟動延遲。子類可選擇覆寫。"""
        self.load()

    # ----- 推論主介面 -----

    def predict(self, image: str | Path) -> RecognitionResult:
        """
        同步推論。

        失敗會回傳 status=ERROR 的 RecognitionResult，**不會拋例外**。
        這是為了讓 dispatcher 可以平滑 fallback 而不需要 try/except。
        """
        start = time.perf_counter()
        try:
            if not self._loaded:
                self.load()
            text, confidence, meta = self._predict_impl(str(image))
            latency_ms = (time.perf_counter() - start) * 1000
            self._call_count += 1
            self._total_latency_ms += latency_ms
            status = (
                RecognitionStatus.LOW_CONFIDENCE
                if confidence < self.config.get("low_conf_threshold", 0.7)
                else RecognitionStatus.SUCCESS
            )
            return RecognitionResult(
                status=status,
                text=text,
                confidence=confidence,
                latency_ms=latency_ms,
                metadata={"recognizer": self.name, **meta},
            )
        except Exception as exc:  # noqa: BLE001 — 包裝為錯誤結果回傳
            latency_ms = (time.perf_counter() - start) * 1000
            logger.exception("%s 推論失敗", self.name)
            return RecognitionResult.from_error(
                str(exc),
                latency_ms=latency_ms,
                recognizer=self.name,
                exc_type=type(exc).__name__,
            )

    async def predict_async(self, image: str | Path) -> RecognitionResult:
        """
        非同步推論。

        本地模型：走 asyncio.to_thread（IO/GPU 不阻塞 event loop）。
        API 類：覆寫 _predict_async_native() 使用 httpx.AsyncClient 等。
        """
        if self.supports_async_native:
            return await self._predict_async_native(image)
        return await asyncio.to_thread(self.predict, image)

    async def _predict_async_native(self, image: str | Path) -> RecognitionResult:
        """API 類辨識器覆寫此方法以使用原生 async IO。預設退回同步。"""
        return await asyncio.to_thread(self.predict, image)

    @abstractmethod
    def _predict_impl(self, image_path: str) -> tuple[str, float, dict]:
        """
        子類實作的純推論邏輯。

        Returns:
          (text, confidence_0_to_1, metadata_dict)
        """

    # ----- 優化匯出 hook -----

    def export_onnx(self, output_path: str, opset: int = 17) -> None:
        """匯出 ONNX 模型。本地 PyTorch 模型可覆寫；API 類保留 NotImplementedError。"""
        raise NotImplementedError(f"{self.name} 不支援 ONNX 匯出")

    def export_tensorrt(
        self, onnx_path: str, output_path: str, fp16: bool = True
    ) -> None:
        """從 ONNX 進一步建構 TensorRT engine。"""
        raise NotImplementedError(f"{self.name} 不支援 TensorRT 匯出")

    # ----- 監控 -----

    def stats(self) -> dict:
        """回傳呼叫統計（給 dispatcher 做負載決策、給 Prometheus 採樣）。"""
        return {
            "name": self.name,
            "loaded": self._loaded,
            "call_count": self._call_count,
            "avg_latency_ms": (
                self._total_latency_ms / self._call_count if self._call_count else 0.0
            ),
        }
