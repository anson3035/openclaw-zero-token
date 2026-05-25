"""
DigitRecognitionEngine 使用範例
=================================
此檔不依賴任何深度學習框架（recognizers 全部以 skeleton 模式運作），
可直接 `python3 usage_example.py` 跑起來看路由 / 輸出格式。
"""
import asyncio
import logging
import sys
from pathlib import Path

# 加入 package 路徑以便直接執行
sys.path.insert(0, str(Path(__file__).parent))

from digit_engine import (
    ContextType,
    DigitRecognitionEngine,
    RecognitionStatus,
    SmartDispatcher,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
)


def sync_example() -> None:
    """同步使用範例：最簡用法。"""
    print("\n========== 同步推論示範 ==========")
    engine = DigitRecognitionEngine()

    cases = [
        ("realtime", "invoice_number.jpg", "即時單據號 → CRNN+CTC"),
        ("blurry", "blurry_plate.jpg", "模糊車牌 → PARSeq"),
        ("invoice", "receipt.jpg", "複雜發票 → VLM"),
        ("video_frame", "frame_0042.jpg", "影片幀 → FOTS"),
        ("embedded", "digit_7.png", "單字元 → KAN"),
    ]
    for ctx, path, desc in cases:
        r = engine.dispatch(path, context_type=ctx)
        print(f"\n[{ctx}] {desc}")
        print(
            f"  status     = {r.status.value}\n"
            f"  text       = {r.text!r}\n"
            f"  confidence = {r.confidence:.2f}\n"
            f"  latency    = {r.latency_ms:.1f} ms\n"
            f"  recognizer = {r.metadata.get('recognizer')}"
        )
        if "structured_output" in r.metadata:
            print(f"  json       = {r.metadata['structured_output']}")
        if "all_instances" in r.metadata:
            print(f"  instances  = {len(r.metadata['all_instances'])} detected")


def stats_example() -> None:
    """監控示範：取出所有辨識器的呼叫統計。"""
    print("\n========== 健康檢查與統計 ==========")
    engine = DigitRecognitionEngine()
    # 跑幾次製造統計數據
    for _ in range(3):
        engine.dispatch("foo.jpg", "realtime")
    for _ in range(2):
        engine.dispatch("bar.jpg", "blurry")

    health = engine.health_check()
    print(f"Engine state: {health['engine']}")
    for key, stats in health["recognizers"].items():
        print(f"  {key:8s} loaded={stats['loaded']!s:5s} "
              f"calls={stats['call_count']} "
              f"avg_latency={stats['avg_latency_ms']:.2f}ms")


async def async_example() -> None:
    """非同步並行批次：高吞吐場景。"""
    print("\n========== 非同步並行批次示範 ==========")
    engine = DigitRecognitionEngine()
    images = [f"frame_{i:04d}.jpg" for i in range(20)]
    results = await engine.batch_dispatch_async(
        images, context_type="video_frame", concurrency=8
    )
    success = sum(1 for r in results if r.status == RecognitionStatus.SUCCESS)
    avg_lat = sum(r.latency_ms for r in results) / len(results)
    print(f"處理 {len(results)} 張影格，成功 {success} 張，平均延遲 {avg_lat:.1f} ms")


def custom_dispatcher_example() -> None:
    """進階：自訂路由表（例：把所有 blurry 案件改走 VLM）。"""
    print("\n========== 自訂路由示範 ==========")
    dispatcher = SmartDispatcher()
    dispatcher.register_route(ContextType.BLURRY, "vlm")
    engine = DigitRecognitionEngine(dispatcher=dispatcher)
    r = engine.dispatch("blurry.jpg", "blurry")
    print(f"blurry now routes to: {r.metadata.get('recognizer')}")


if __name__ == "__main__":
    sync_example()
    stats_example()
    asyncio.run(async_example())
    custom_dispatcher_example()
