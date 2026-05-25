"""
智慧分流調度器（Smart Dispatcher）
====================================
根據 context_type 與輸入特性自動路由到最佳辨識器。
支援自動偵測、fallback 鏈、批次調度、與成本意識路由。

設計重點：
  • 路由表可在執行期覆寫（register_route）
  • Fallback 鏈：主路由失敗時依序嘗試次選，全部失敗才回傳 ERROR
  • Lazy init：辨識器只在第一次被 dispatch 命中時才載入權重
  • Recognizer 統計：可供未來做 load-aware 路由與成本配額
"""
from __future__ import annotations

import logging
from enum import Enum
from typing import Optional

from .base import BaseRecognizer, DispatcherError, RecognitionStatus, RecognitionResult
from .recognizers import (
    CrnnCtcRecognizer,
    FotsRecognizer,
    KanRecognizer,
    ParseqRecognizer,
    VlmRecognizer,
)

logger = logging.getLogger("digit_engine.dispatcher")


class ContextType(str, Enum):
    """調度器接受的內建情境類型。應用層只需傳這些字串。"""

    REALTIME = "realtime"        # 高頻次低延遲（單據號、身分證）→ CRNN+CTC
    BLURRY = "blurry"            # 場景文本 / 模糊 / 扭曲       → PARSeq
    INVOICE = "invoice"          # 複雜單據結構化             → VLM
    VIDEO_FRAME = "video_frame"  # 影片幀 / 動態追蹤           → FOTS
    EMBEDDED = "embedded"        # 端側 / 單字元              → KAN
    AUTO = "auto"                # 由系統依輸入特性自動選擇


# 預設路由表（key 為 ContextType 值；value 為 recognizers 字典中的 key）
DEFAULT_ROUTES: dict[ContextType, str] = {
    ContextType.REALTIME: "crnn",
    ContextType.BLURRY: "parseq",
    ContextType.INVOICE: "vlm",
    ContextType.VIDEO_FRAME: "fots",
    ContextType.EMBEDDED: "kan",
}

# Fallback 鏈：當主路由失敗時依序嘗試的次選
# 設計原則：API 類失敗 → 退回最強的本地模型（PARSeq）
DEFAULT_FALLBACK: dict[str, list[str]] = {
    "crnn": ["parseq"],
    "parseq": ["crnn"],
    "vlm": ["parseq"],
    "fots": ["parseq"],
    "kan": ["crnn"],
}


class SmartDispatcher:
    """
    智慧分流調度器。

    職責：
      1. 維護所有 Recognizer 實例的註冊表（lazy init）
      2. 根據 context_type 路由到對應辨識器
      3. context=auto 時做自動偵測
      4. 主路由失敗時走 fallback 鏈
      5. 統計與成本追蹤（all_stats）
    """

    def __init__(self, recognizers: Optional[dict[str, BaseRecognizer]] = None) -> None:
        # 預設五大辨識器，可由建構子注入自訂版本（mock / 替換實作）
        self._recognizers: dict[str, BaseRecognizer] = recognizers or {
            "parseq": ParseqRecognizer(),
            "crnn": CrnnCtcRecognizer(),
            "vlm": VlmRecognizer(),
            "fots": FotsRecognizer(),
            "kan": KanRecognizer(),
        }
        self._routes: dict[ContextType, str] = dict(DEFAULT_ROUTES)
        self._fallback: dict[str, list[str]] = dict(DEFAULT_FALLBACK)

    # ----- 路由表管理 -----

    def register_route(self, context: ContextType, recognizer_key: str) -> None:
        """允許運行時覆寫路由（例：把 invoice 切到本地 Qwen2.5-VL-7B）。"""
        if recognizer_key not in self._recognizers:
            raise DispatcherError(f"未知 recognizer: {recognizer_key}")
        self._routes[context] = recognizer_key

    def register_fallback(self, primary_key: str, fallback_keys: list[str]) -> None:
        """設定主路由失敗時的次選清單。"""
        for k in [primary_key, *fallback_keys]:
            if k not in self._recognizers:
                raise DispatcherError(f"未知 recognizer: {k}")
        self._fallback[primary_key] = list(fallback_keys)

    def route_for(
        self, context_type: str, image_path: Optional[str] = None
    ) -> str:
        """回傳 context 對應之 recognizer key。auto 走 _auto_select。"""
        try:
            ctx = ContextType(context_type)
        except ValueError as e:
            raise DispatcherError(f"未知 context_type: {context_type}") from e
        if ctx == ContextType.AUTO:
            return self._auto_select(image_path)
        return self._routes[ctx]

    def _auto_select(self, image_path: Optional[str] = None) -> str:
        """
        自動偵測最佳辨識器。

        未來可加入：
          • 圖片尺寸 / 內容偵測（輕量 CNN classifier 判斷單據 vs 場景 vs 影片幀）
          • 系統當前負載（避開過載的 recognizer）
          • 成本預算（cap 每日 VLM 呼叫次數）

        Skeleton 預設回傳 PARSeq（覆蓋面最廣的本地模型）。
        """
        return "parseq"

    # ----- 推論主流程（含 fallback） -----

    def dispatch(
        self, image_path: str, context_type: str = "auto"
    ) -> RecognitionResult:
        """同步推論。會自動嘗試 fallback 鏈。"""
        primary_key = self.route_for(context_type, image_path)
        recognizer = self._recognizers[primary_key]
        result = recognizer.predict(image_path)

        if result.status != RecognitionStatus.ERROR:
            return result

        # Fallback chain
        for fallback_key in self._fallback.get(primary_key, []):
            logger.warning(
                "%s 失敗，fallback 到 %s：%s",
                primary_key,
                fallback_key,
                result.metadata.get("error"),
            )
            fallback_recog = self._recognizers[fallback_key]
            result = fallback_recog.predict(image_path)
            result.metadata["used_fallback_from"] = primary_key
            if result.status != RecognitionStatus.ERROR:
                return result

        return result  # 所有都失敗，回傳最後一個 error result

    async def dispatch_async(
        self, image_path: str, context_type: str = "auto"
    ) -> RecognitionResult:
        """非同步推論。會自動嘗試 fallback 鏈。"""
        primary_key = self.route_for(context_type, image_path)
        recognizer = self._recognizers[primary_key]
        result = await recognizer.predict_async(image_path)

        if result.status != RecognitionStatus.ERROR:
            return result

        for fallback_key in self._fallback.get(primary_key, []):
            logger.warning("[async] %s 失敗，fallback 到 %s", primary_key, fallback_key)
            result = await self._recognizers[fallback_key].predict_async(image_path)
            result.metadata["used_fallback_from"] = primary_key
            if result.status != RecognitionStatus.ERROR:
                return result

        return result

    # ----- 監控 -----

    def all_stats(self) -> dict:
        """回傳所有辨識器的呼叫統計，可餵給 Prometheus / Grafana。"""
        return {key: rec.stats() for key, rec in self._recognizers.items()}

    @property
    def recognizers(self) -> dict[str, BaseRecognizer]:
        """暴露註冊表（唯讀視角；引擎層 warmup_all 會用到）。"""
        return self._recognizers
