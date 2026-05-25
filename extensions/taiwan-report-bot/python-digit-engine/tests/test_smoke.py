"""
Smoke 測試：驗證骨架能編譯、路由表正確、輸出格式統一。
不需要任何深度學習依賴；CI 可以直接跑 `python -m unittest tests.test_smoke`。
"""
import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from digit_engine import (  # noqa: E402
    ContextType,
    DigitRecognitionEngine,
    DispatcherError,
    RecognitionStatus,
    SmartDispatcher,
)


class RoutingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = DigitRecognitionEngine()

    def test_realtime_routes_to_crnn(self) -> None:
        r = self.engine.dispatch("dummy.jpg", "realtime")
        self.assertEqual(r.status, RecognitionStatus.SUCCESS)
        self.assertIn("CRNN", r.metadata.get("recognizer", ""))

    def test_blurry_routes_to_parseq(self) -> None:
        r = self.engine.dispatch("dummy.jpg", "blurry")
        self.assertIn("PARSeq", r.metadata.get("recognizer", ""))

    def test_invoice_routes_to_vlm(self) -> None:
        r = self.engine.dispatch("dummy.jpg", "invoice")
        self.assertEqual(r.metadata.get("model_family"), "vlm")
        self.assertIn("structured_output", r.metadata)

    def test_video_frame_routes_to_fots(self) -> None:
        r = self.engine.dispatch("dummy.jpg", "video_frame")
        self.assertIn("FOTS", r.metadata.get("recognizer", ""))
        self.assertGreaterEqual(r.metadata.get("instances_detected", 0), 1)

    def test_embedded_routes_to_kan(self) -> None:
        r = self.engine.dispatch("dummy.jpg", "embedded")
        self.assertIn("KAN", r.metadata.get("recognizer", ""))

    def test_auto_routes_to_default_parseq(self) -> None:
        r = self.engine.dispatch("dummy.jpg", "auto")
        self.assertIn("PARSeq", r.metadata.get("recognizer", ""))

    def test_unknown_context_raises_dispatcher_error(self) -> None:
        with self.assertRaises(DispatcherError):
            self.engine.dispatch("dummy.jpg", "no_such_context")


class UnifiedFormatTest(unittest.TestCase):
    def test_result_has_all_required_keys(self) -> None:
        engine = DigitRecognitionEngine()
        r = engine.dispatch("dummy.jpg", "blurry")
        d = r.to_dict()
        for key in ("status", "text", "confidence", "latency_ms", "metadata"):
            self.assertIn(key, d, f"missing key: {key}")
        self.assertIsInstance(d["status"], str)
        self.assertIsInstance(d["confidence"], float)
        self.assertGreaterEqual(d["confidence"], 0.0)
        self.assertLessEqual(d["confidence"], 1.0)
        self.assertGreater(d["latency_ms"], 0.0)


class AsyncDispatchTest(unittest.TestCase):
    def test_dispatch_async(self) -> None:
        async def run() -> None:
            engine = DigitRecognitionEngine()
            r = await engine.dispatch_async("dummy.jpg", "realtime")
            self.assertEqual(r.status, RecognitionStatus.SUCCESS)

        asyncio.run(run())

    def test_batch_dispatch_async(self) -> None:
        async def run() -> None:
            engine = DigitRecognitionEngine()
            paths = [f"f{i}.jpg" for i in range(12)]
            results = await engine.batch_dispatch_async(
                paths, "video_frame", concurrency=4
            )
            self.assertEqual(len(results), 12)
            for r in results:
                self.assertEqual(r.status, RecognitionStatus.SUCCESS)

        asyncio.run(run())


class CustomRoutingTest(unittest.TestCase):
    def test_register_route_overrides_default(self) -> None:
        dispatcher = SmartDispatcher()
        dispatcher.register_route(ContextType.BLURRY, "vlm")
        engine = DigitRecognitionEngine(dispatcher=dispatcher)
        r = engine.dispatch("dummy.jpg", "blurry")
        self.assertEqual(r.metadata.get("model_family"), "vlm")

    def test_register_route_rejects_unknown_recognizer(self) -> None:
        dispatcher = SmartDispatcher()
        with self.assertRaises(DispatcherError):
            dispatcher.register_route(ContextType.BLURRY, "nonexistent_key")


class HealthCheckTest(unittest.TestCase):
    def test_health_check_lists_all_recognizers(self) -> None:
        engine = DigitRecognitionEngine()
        h = engine.health_check()
        self.assertEqual(h["engine"], "healthy")
        for key in ("parseq", "crnn", "vlm", "fots", "kan"):
            self.assertIn(key, h["recognizers"])

    def test_stats_increments_after_dispatch(self) -> None:
        engine = DigitRecognitionEngine()
        engine.dispatch("a.jpg", "realtime")
        engine.dispatch("b.jpg", "realtime")
        h = engine.health_check()
        self.assertEqual(h["recognizers"]["crnn"]["call_count"], 2)


if __name__ == "__main__":
    unittest.main()
