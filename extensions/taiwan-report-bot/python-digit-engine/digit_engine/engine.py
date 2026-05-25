"""
DigitRecognitionEngine — 對外 facade
======================================
單一進入點，封裝 SmartDispatcher 與所有辨識器。
應用層只需 `from digit_engine import DigitRecognitionEngine` 即可。

設計重點：
  • 公開穩定 API：dispatch / dispatch_async / batch_*
  • 內部組件（Dispatcher / Recognizers）可被注入或替換
  • health_check 給 k8s liveness probe 使用
  • warmup_all 給服務啟動時降低首呼延遲
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from .base import RecognitionResult
from .dispatcher import SmartDispatcher

logger = logging.getLogger("digit_engine.engine")


class DigitRecognitionEngine:
    """
    對外 API facade。

    範例用法：
        from digit_engine import DigitRecognitionEngine

        engine = DigitRecognitionEngine(warmup=False)

        # 同步單張
        result = engine.dispatch("invoice.jpg", "invoice")
        print(result.text, result.confidence, result.latency_ms)

        # 同步批次
        results = engine.batch_dispatch(["a.jpg", "b.jpg"], "realtime")

        # 非同步單張
        result = await engine.dispatch_async("frame.jpg", "video_frame")

        # 非同步並行批次（受 semaphore 控制最大並發數）
        results = await engine.batch_dispatch_async(paths, "video_frame", concurrency=16)
    """

    def __init__(
        self,
        dispatcher: Optional[SmartDispatcher] = None,
        warmup: bool = False,
    ) -> None:
        self.dispatcher = dispatcher or SmartDispatcher()
        if warmup:
            self.warmup_all()

    # ----- 同步 API -----

    def dispatch(
        self, image_path: str | Path, context_type: str = "auto"
    ) -> RecognitionResult:
        """主要對外介面。回傳統一格式的 RecognitionResult。"""
        return self.dispatcher.dispatch(str(image_path), context_type)

    def batch_dispatch(
        self,
        image_paths: list[str | Path],
        context_type: str = "auto",
    ) -> list[RecognitionResult]:
        """同步批次。簡單迴圈，高吞吐建議改用 batch_dispatch_async。"""
        return [self.dispatch(p, context_type) for p in image_paths]

    # ----- 非同步 API -----

    async def dispatch_async(
        self, image_path: str | Path, context_type: str = "auto"
    ) -> RecognitionResult:
        return await self.dispatcher.dispatch_async(str(image_path), context_type)

    async def batch_dispatch_async(
        self,
        image_paths: list[str | Path],
        context_type: str = "auto",
        concurrency: int = 8,
    ) -> list[RecognitionResult]:
        """並行批次處理，受 semaphore 控制最大並發數。"""
        sem = asyncio.Semaphore(concurrency)

        async def one(p: str | Path) -> RecognitionResult:
            async with sem:
                return await self.dispatch_async(p, context_type)

        return await asyncio.gather(*[one(p) for p in image_paths])

    # ----- 生命週期 -----

    def warmup_all(self) -> None:
        """暖機所有辨識器，避免首次呼叫的冷啟動延遲。"""
        for key, rec in self.dispatcher.recognizers.items():
            try:
                rec.warmup()
                logger.info("✅ %s 暖機完成", key)
            except Exception as exc:  # noqa: BLE001
                logger.warning("⚠ %s 暖機失敗：%s", key, exc)

    def health_check(self) -> dict:
        """健康檢查端點。回傳引擎狀態 + 各 recognizer 統計。"""
        return {
            "engine": "healthy",
            "recognizers": self.dispatcher.all_stats(),
        }

    def shutdown(self) -> None:
        """釋放 GPU / API client 資源。"""
        # 真實實作：torch.cuda.empty_cache(), 關閉 httpx AsyncClient 等
        logger.info("DigitRecognitionEngine 已關閉")
