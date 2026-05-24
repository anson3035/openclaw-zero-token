"""
Taiwan Violation Reporting — Case Review Console
A Bloomberg Terminal–style dark GUI for reviewing a single violation case
and its full evidence chain.

Run:
    pip install customtkinter
    python3 case_review.py
"""
from __future__ import annotations

import math
import tkinter as tk
from dataclasses import dataclass
from typing import Literal

try:
    import customtkinter as ctk
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "CustomTkinter is required.\n"
        "Install with:  pip install customtkinter\n"
        f"Underlying error: {exc}"
    )


# =============================================================================
# Palette  (Bloomberg-inspired dark terminal)
# =============================================================================
BG_PRIMARY     = "#121212"   # window background
BG_CARD        = "#1E1E1E"   # card / panel background
BG_SUNKEN      = "#0A0A0A"   # inset canvases
BG_HOVER       = "#2A2A2A"

TEXT_PRIMARY   = "#EEEEEE"
TEXT_SECONDARY = "#9E9E9E"
TEXT_DIM       = "#5C5C5C"

BORDER         = "#333333"
BORDER_BRIGHT  = "#4A4A4A"

ACCENT_ORANGE  = "#FF8C00"
ACCENT_AMBER   = "#FFB300"
ACCENT_RED     = "#FF3B30"
ACCENT_GREEN   = "#00C853"
ACCENT_CYAN    = "#00B8D9"

# Fonts — Tk falls back gracefully if the family is missing.
MONO_S = ("Consolas", 9)
MONO   = ("Consolas", 11)
MONO_M = ("Consolas", 13)
MONO_L = ("Consolas", 22, "bold")

SANS_S = ("Segoe UI", 9)
SANS   = ("Segoe UI", 11)
SANS_M = ("Segoe UI", 12, "bold")
SANS_L = ("Segoe UI", 14, "bold")
SANS_T = ("Segoe UI", 22, "bold")


# =============================================================================
# Helpers
# =============================================================================
def lerp_color(c1: str, c2: str, t: float) -> str:
    """Linear-interpolate two #RRGGBB hex colors (t in 0..1)."""
    t = max(0.0, min(1.0, t))
    r1, g1, b1 = int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16)
    r2, g2, b2 = int(c2[1:3], 16), int(c2[3:5], 16), int(c2[5:7], 16)
    r = int(r1 + (r2 - r1) * t)
    g = int(g1 + (g2 - g1) * t)
    b = int(b1 + (b2 - b1) * t)
    return f"#{r:02x}{g:02x}{b:02x}"


# =============================================================================
# Glowing warning badge (animated)
# =============================================================================
class GlowingWarning(tk.Canvas):
    """Pulsing orange warning glow with an exclamation mark."""

    def __init__(self, parent, size: int = 26, bg: str = BG_PRIMARY):
        super().__init__(parent, width=size, height=size, bg=bg,
                         highlightthickness=0, bd=0)
        self.size = size
        self.bg = bg
        self.phase = 0.0
        self._tick()

    def _tick(self) -> None:
        self.delete("all")
        s = self.size
        cx = cy = s / 2
        pulse = (math.sin(self.phase) + 1) / 2  # 0..1
        intensity = 0.55 + 0.45 * pulse

        rings = 7
        for i in range(rings, 0, -1):
            t = i / rings
            radius = (s / 2 - 1) * t
            ring_alpha = (1 - t) * intensity * 0.9
            color = lerp_color(self.bg, ACCENT_ORANGE, ring_alpha)
            self.create_oval(cx - radius, cy - radius,
                             cx + radius, cy + radius,
                             fill=color, outline="")

        core = (s / 2 - 1) * 0.45
        self.create_oval(cx - core, cy - core, cx + core, cy + core,
                         fill=ACCENT_ORANGE, outline=ACCENT_AMBER, width=1)
        self.create_text(cx, cy, text="!", fill="#1A0F00",
                         font=("Segoe UI", int(s * 0.5), "bold"))

        self.phase += 0.18
        if self.phase > math.tau:
            self.phase -= math.tau
        self.after(70, self._tick)


# =============================================================================
# Vertical timeline
# =============================================================================
TimelineStatus = Literal["done", "current", "pending"]


@dataclass
class TimelineEvent:
    timestamp: str
    actor: str
    title: str
    detail: str
    status: TimelineStatus = "done"


class _TimelineRow(ctk.CTkFrame):
    def __init__(self, parent, event: TimelineEvent, is_first: bool, is_last: bool):
        super().__init__(parent, fg_color="transparent")
        self.event = event
        self.is_first = is_first
        self.is_last = is_last

        # marker column
        self.marker = tk.Canvas(self, width=28, bg=BG_CARD,
                                highlightthickness=0, bd=0)
        self.marker.pack(side="left", fill="y", padx=(6, 0))
        self.marker.bind("<Configure>", lambda _e: self._paint_marker())

        # content card
        card = ctk.CTkFrame(self, fg_color=BG_SUNKEN, corner_radius=3,
                            border_width=1, border_color=BORDER)
        card.pack(side="left", fill="x", expand=True, padx=(6, 8), pady=4)

        meta = ctk.CTkFrame(card, fg_color="transparent")
        meta.pack(fill="x", padx=12, pady=(8, 0))
        ctk.CTkLabel(meta, text=event.timestamp, font=MONO,
                     text_color=TEXT_SECONDARY).pack(side="left")
        actor_color = ACCENT_AMBER if event.status == "current" else TEXT_SECONDARY
        ctk.CTkLabel(meta, text=event.actor, font=MONO,
                     text_color=actor_color).pack(side="right")

        ctk.CTkLabel(card, text=event.title, font=SANS_M,
                     text_color=TEXT_PRIMARY, anchor="w").pack(
            fill="x", padx=12, pady=(2, 0))
        ctk.CTkLabel(card, text=event.detail, font=SANS,
                     text_color=TEXT_SECONDARY, anchor="w",
                     justify="left", wraplength=360).pack(
            fill="x", padx=12, pady=(2, 10))

    def _paint_marker(self) -> None:
        c = self.marker
        c.delete("all")
        w, h = c.winfo_width(), c.winfo_height()
        if w < 4 or h < 4:
            return
        cx = w // 2
        dot_y = 24

        if not self.is_first:
            c.create_line(cx, 0, cx, dot_y - 7, fill=BORDER_BRIGHT, width=1)
        if not self.is_last:
            c.create_line(cx, dot_y + 7, cx, h, fill=BORDER_BRIGHT, width=1)

        if self.event.status == "done":
            fill, outline = ACCENT_GREEN, ACCENT_GREEN
        elif self.event.status == "current":
            fill, outline = ACCENT_ORANGE, ACCENT_AMBER
        else:
            fill, outline = BG_SUNKEN, TEXT_DIM

        r = 6
        c.create_oval(cx - r, dot_y - r, cx + r, dot_y + r,
                      fill=fill, outline=outline, width=1)

        if self.event.status == "current":
            for i in range(3):
                rr = r + 3 + i * 3
                color = lerp_color(BG_CARD, ACCENT_ORANGE, 0.5 - i * 0.15)
                c.create_oval(cx - rr, dot_y - rr, cx + rr, dot_y + rr,
                              outline=color, width=1)


class VerticalTimeline(ctk.CTkFrame):
    def __init__(self, parent, events: list[TimelineEvent]):
        super().__init__(parent, fg_color=BG_CARD, corner_radius=4,
                         border_width=1, border_color=BORDER)
        self.events = events

        header = ctk.CTkFrame(self, fg_color="transparent", height=36)
        header.pack(fill="x", padx=14, pady=(10, 4))
        header.pack_propagate(False)
        ctk.CTkLabel(header, text="案件處置時間軸", font=SANS_L,
                     text_color=TEXT_PRIMARY, anchor="w").pack(side="left")
        ctk.CTkLabel(header, text=f"{len(events)} EVENTS", font=MONO_S,
                     text_color=TEXT_DIM).pack(side="right")

        ctk.CTkFrame(self, fg_color=BORDER, height=1).pack(fill="x", padx=14)

        body = ctk.CTkScrollableFrame(
            self, fg_color="transparent",
            scrollbar_button_color=BORDER,
            scrollbar_button_hover_color=BORDER_BRIGHT,
        )
        body.pack(fill="both", expand=True, padx=4, pady=(6, 10))

        for i, ev in enumerate(events):
            row = _TimelineRow(body, ev,
                               is_first=(i == 0),
                               is_last=(i == len(events) - 1))
            row.pack(fill="x")


# =============================================================================
# Photo / evidence panel
# =============================================================================
class PhotoPanel(ctk.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent, fg_color=BG_CARD, corner_radius=4,
                         border_width=1, border_color=BORDER)

        header = ctk.CTkFrame(self, fg_color="transparent", height=36)
        header.pack(fill="x", padx=14, pady=(10, 4))
        header.pack_propagate(False)
        ctk.CTkLabel(header, text="現場證據影像", font=SANS_L,
                     text_color=TEXT_PRIMARY, anchor="w").pack(side="left")
        ctk.CTkLabel(header, text="EVIDENCE · 3 FRAMES", font=MONO_S,
                     text_color=TEXT_DIM).pack(side="right")

        ctk.CTkFrame(self, fg_color=BORDER, height=1).pack(fill="x", padx=14)

        self.canvas = tk.Canvas(self, bg=BG_SUNKEN, highlightthickness=0, bd=0)
        self.canvas.pack(fill="both", expand=True, padx=10, pady=(6, 6))
        self.canvas.bind("<Configure>", lambda _e: self._draw())

        footer = ctk.CTkFrame(self, fg_color="transparent", height=28)
        footer.pack(fill="x", padx=14, pady=(0, 10))
        footer.pack_propagate(False)
        ctk.CTkLabel(footer,
                     text="SHA-256  a8f3…b912  ·  EXIF ok  ·  GPS ok",
                     font=MONO_S, text_color=TEXT_DIM,
                     anchor="w").pack(side="left")
        ctk.CTkLabel(footer, text="2026-05-12  14:32:08 +0800",
                     font=MONO_S, text_color=TEXT_DIM,
                     anchor="e").pack(side="right")

    def _draw(self) -> None:
        c = self.canvas
        c.delete("all")
        w, h = c.winfo_width(), c.winfo_height()
        if w < 20 or h < 20:
            return

        # subtle scan-line pattern
        for y in range(0, h, 4):
            c.create_line(0, y, w, y, fill="#0F0F0F")

        # photo frame
        pad = 14
        c.create_rectangle(pad, pad, w - pad, h - pad,
                           outline=BORDER, fill="#171717")

        # asphalt
        c.create_rectangle(pad + 1, h // 2, w - pad - 1, h - pad - 1,
                           fill="#1B1B1B", outline="")
        # road dashed yellow line
        ny = int(h * 0.72)
        for x in range(pad + 20, w - pad - 20, 30):
            c.create_line(x, ny, x + 16, ny, fill="#665522", width=1)
        # two parked vehicles
        cy = int(h * 0.58)
        c.create_rectangle(pad + 28, cy, pad + 108, cy + 26,
                           fill="#1F1F26", outline="#333")
        c.create_rectangle(pad + 148, cy, pad + 228, cy + 26,
                           fill="#1F1F26", outline="#333")
        # offending obstruction
        ox, oy = w // 2 - 32, h // 2 - 24
        c.create_rectangle(ox, oy, ox + 64, oy + 48,
                           fill="#3A1010", outline=ACCENT_RED, width=2)
        # bounding box + label
        c.create_rectangle(ox - 6, oy - 6, ox + 70, oy + 54,
                           outline=ACCENT_ORANGE, dash=(4, 3))
        c.create_text(ox + 32, oy - 14, text="OBSTRUCTION  conf 0.94",
                      font=MONO_S, fill=ACCENT_ORANGE)
        # crosshair
        c.create_line(w // 2 - 12, h // 2, w // 2 + 12, h // 2,
                      fill=ACCENT_RED)
        c.create_line(w // 2, h // 2 - 12, w // 2, h // 2 + 12,
                      fill=ACCENT_RED)
        # CCTV-style overlays
        c.create_text(pad + 10, pad + 14, anchor="w",
                      text="REC ●  14:32:08", font=MONO_S, fill=ACCENT_RED)
        c.create_text(w - pad - 10, pad + 14, anchor="e",
                      text="CAM-NW · TWN", font=MONO_S, fill=TEXT_DIM)
        c.create_text(pad + 10, h - pad - 10, anchor="sw",
                      text="25.0478°N  121.5319°E", font=MONO_S,
                      fill=TEXT_DIM)
        c.create_text(w - pad - 10, h - pad - 10, anchor="se",
                      text="1920×1080 · JPG", font=MONO_S, fill=TEXT_DIM)


# =============================================================================
# Map panel
# =============================================================================
class MapPanel(ctk.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent, fg_color=BG_CARD, corner_radius=4,
                         border_width=1, border_color=BORDER)

        header = ctk.CTkFrame(self, fg_color="transparent", height=36)
        header.pack(fill="x", padx=14, pady=(10, 4))
        header.pack_propagate(False)
        ctk.CTkLabel(header, text="地理位置  ·  GPS", font=SANS_L,
                     text_color=TEXT_PRIMARY, anchor="w").pack(side="left")
        ctk.CTkLabel(header, text="EXIF · NOMINATIM", font=MONO_S,
                     text_color=TEXT_DIM).pack(side="right")

        ctk.CTkFrame(self, fg_color=BORDER, height=1).pack(fill="x", padx=14)

        self.canvas = tk.Canvas(self, bg=BG_SUNKEN, highlightthickness=0, bd=0)
        self.canvas.pack(fill="both", expand=True, padx=10, pady=(6, 6))
        self.canvas.bind("<Configure>", lambda _e: self._draw())

        readout = ctk.CTkFrame(self, fg_color="transparent")
        readout.pack(fill="x", padx=14, pady=(0, 10))

        for label, value, color in [
            ("LAT", "25.047800°N", ACCENT_CYAN),
            ("LON", "121.531900°E", ACCENT_CYAN),
            ("DISTRICT", "台北市中正區", TEXT_PRIMARY),
            ("ACCURACY", "±5 m", ACCENT_GREEN),
        ]:
            cell = ctk.CTkFrame(readout, fg_color="transparent")
            cell.pack(side="left", expand=True, fill="x")
            ctk.CTkLabel(cell, text=label, font=MONO_S,
                         text_color=TEXT_DIM, anchor="w").pack(anchor="w")
            ctk.CTkLabel(cell, text=value, font=MONO_M, text_color=color,
                         anchor="w").pack(anchor="w")

        self._pulse_phase = 0.0
        self._pulse()

    def _draw(self) -> None:
        c = self.canvas
        c.delete("map")
        w, h = c.winfo_width(), c.winfo_height()
        if w < 20 or h < 20:
            return

        step = 30
        for x in range(0, w, step):
            c.create_line(x, 0, x, h, fill="#171717", tags="map")
        for y in range(0, h, step):
            c.create_line(0, y, w, y, fill="#171717", tags="map")

        # primary roads (intersection near centre)
        rx = int(w * 0.42)
        ry = int(h * 0.50)
        c.create_line(0, ry, w, ry, fill="#2A2A2A", width=8, tags="map")
        c.create_line(rx, 0, rx, h, fill="#2A2A2A", width=8, tags="map")
        c.create_line(0, ry, w, ry, fill="#3A3A3A", width=1, tags="map")
        c.create_line(rx, 0, rx, h, fill="#3A3A3A", width=1, tags="map")

        # secondary
        c.create_line(0, ry - 80, w, ry - 50, fill="#222", width=3, tags="map")
        c.create_line(0, ry + 90, w, ry + 60, fill="#222", width=3, tags="map")

        # building footprints
        for (x, y, ww, hh) in [
            (40, 50, 110, 70),
            (180, 70, 80, 55),
            (rx + 30, 40, 100, 75),
            (rx + 150, 60, 70, 60),
            (40, ry + 25, 100, 80),
            (170, ry + 50, 110, 60),
            (rx + 50, ry + 30, 80, 90),
            (rx + 170, ry + 50, 100, 70),
        ]:
            if x + ww >= w or y + hh >= h:
                continue
            c.create_rectangle(x, y, x + ww, y + hh,
                               outline=BORDER, fill="#161616", tags="map")

        # north arrow
        c.create_polygon(w - 30, 18, w - 24, 38, w - 30, 32, w - 36, 38,
                         fill=TEXT_SECONDARY, outline="", tags="map")
        c.create_text(w - 30, 50, text="N", font=MONO_S,
                      fill=TEXT_SECONDARY, tags="map")

        # scale bar
        sx, sy = 20, h - 22
        c.create_line(sx, sy, sx + 80, sy, fill=TEXT_SECONDARY, tags="map")
        c.create_line(sx, sy - 4, sx, sy + 4, fill=TEXT_SECONDARY, tags="map")
        c.create_line(sx + 80, sy - 4, sx + 80, sy + 4,
                      fill=TEXT_SECONDARY, tags="map")
        c.create_text(sx + 40, sy - 12, text="50 m", font=MONO_S,
                      fill=TEXT_SECONDARY, tags="map")

        self._marker = (rx, ry)

    def _pulse(self) -> None:
        c = self.canvas
        c.delete("pulse")
        if hasattr(self, "_marker"):
            cx, cy = self._marker
            pulse = (math.sin(self._pulse_phase) + 1) / 2
            for i in range(3):
                rr = 8 + i * 6 + pulse * 4
                color = lerp_color(BG_SUNKEN, ACCENT_RED, 0.6 - i * 0.18)
                c.create_oval(cx - rr, cy - rr, cx + rr, cy + rr,
                              outline=color, tags="pulse")
            r = 5
            c.create_oval(cx - r, cy - r, cx + r, cy + r,
                          fill=ACCENT_RED, outline=ACCENT_AMBER, width=1,
                          tags="pulse")
        self._pulse_phase += 0.15
        if self._pulse_phase > math.tau:
            self._pulse_phase -= math.tau
        self.after(80, self._pulse)


# =============================================================================
# Main application
# =============================================================================
class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("dark")
        self.title("Taiwan Violation Reporting — Case Review Console")
        self.geometry("1440x900")
        self.minsize(1100, 720)
        self.configure(fg_color=BG_PRIMARY)

        self._build_header()
        self._build_body()
        self._build_statusbar()

    # ------------------------------- header ----------------------------------
    def _build_header(self) -> None:
        bar = ctk.CTkFrame(self, fg_color=BG_PRIMARY, height=64)
        bar.pack(fill="x", side="top", padx=18, pady=(14, 0))
        bar.pack_propagate(False)

        # left: app name + case id + glowing warning
        left = ctk.CTkFrame(bar, fg_color="transparent")
        left.pack(side="left", fill="y")
        ctk.CTkLabel(left, text="VIOLATION  REVIEW  CONSOLE",
                     font=SANS_M, text_color=TEXT_SECONDARY).pack(anchor="w")

        idrow = ctk.CTkFrame(left, fg_color="transparent")
        idrow.pack(anchor="w", pady=(2, 0))
        ctk.CTkLabel(idrow, text="CASE", font=SANS_S,
                     text_color=TEXT_DIM).pack(side="left", padx=(0, 6))
        ctk.CTkLabel(idrow, text="#TPE-2026-0512-00184",
                     font=MONO_L, text_color=TEXT_PRIMARY).pack(side="left")
        GlowingWarning(idrow, size=24, bg=BG_PRIMARY).pack(
            side="left", padx=(10, 0))
        ctk.CTkLabel(idrow, text="HIGH RISK", font=SANS_S,
                     text_color=ACCENT_ORANGE).pack(side="left", padx=(6, 0))

        # right: KPI strip
        right = ctk.CTkFrame(bar, fg_color="transparent")
        right.pack(side="right", fill="y")
        for label, value, color in [
            ("STATUS", "處置中", ACCENT_ORANGE),
            ("SEVERITY", "S2", ACCENT_AMBER),
            ("EVIDENCE", "3 FILES", TEXT_PRIMARY),
            ("ELAPSED", "01:12:46", ACCENT_CYAN),
        ]:
            cell = ctk.CTkFrame(right, fg_color="transparent")
            cell.pack(side="left", padx=18)
            ctk.CTkLabel(cell, text=label, font=SANS_S,
                         text_color=TEXT_DIM).pack(anchor="e")
            ctk.CTkLabel(cell, text=value, font=MONO_M,
                         text_color=color).pack(anchor="e")

        ctk.CTkFrame(self, fg_color=BORDER, height=1).pack(
            fill="x", padx=18, pady=(10, 0))

    # -------------------------------- body -----------------------------------
    def _build_body(self) -> None:
        body = ctk.CTkFrame(self, fg_color=BG_PRIMARY)
        body.pack(fill="both", expand=True, padx=18, pady=12)
        body.grid_columnconfigure(0, weight=1, uniform="cols")
        body.grid_columnconfigure(1, weight=1, uniform="cols")
        body.grid_rowconfigure(0, weight=1)

        # LEFT — evidence
        left = ctk.CTkFrame(body, fg_color="transparent")
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        left.grid_rowconfigure(0, weight=3, uniform="lrows")
        left.grid_rowconfigure(1, weight=2, uniform="lrows")
        left.grid_columnconfigure(0, weight=1)
        PhotoPanel(left).grid(row=0, column=0, sticky="nsew", pady=(0, 8))
        MapPanel(left).grid(row=1, column=0, sticky="nsew")

        # RIGHT — case detail
        right = ctk.CTkFrame(body, fg_color="transparent")
        right.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        right.grid_columnconfigure(0, weight=1)
        right.grid_rowconfigure(2, weight=1)

        # warning title card
        title_card = ctk.CTkFrame(right, fg_color=BG_CARD, corner_radius=4,
                                  border_width=1, border_color=BORDER)
        title_card.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        inner = ctk.CTkFrame(title_card, fg_color="transparent")
        inner.pack(fill="x", padx=18, pady=14)
        tags = ctk.CTkFrame(inner, fg_color="transparent")
        tags.pack(anchor="w", pady=(0, 6))
        for txt, color in [
            ("【違章路障】", ACCENT_ORANGE),
            ("公共安全", ACCENT_RED),
            ("消防通道", ACCENT_AMBER),
        ]:
            chip = ctk.CTkFrame(tags, fg_color=BG_SUNKEN, corner_radius=2,
                                border_width=1, border_color=color)
            chip.pack(side="left", padx=(0, 6))
            ctk.CTkLabel(chip, text=txt, font=SANS_S,
                         text_color=color).pack(padx=8, pady=2)

        ctk.CTkLabel(inner, text="佔用既成道路  ·  阻塞消防通道",
                     font=SANS_T, text_color=TEXT_PRIMARY,
                     anchor="w").pack(fill="x")
        ctk.CTkLabel(inner,
                     text="台北市中正區忠孝東路一段 1 號  ·  道交條例 §82 · 消防法 §21",
                     font=SANS, text_color=TEXT_SECONDARY,
                     anchor="w").pack(fill="x", pady=(2, 0))

        # facts strip
        facts = ctk.CTkFrame(right, fg_color=BG_CARD, corner_radius=4,
                             border_width=1, border_color=BORDER)
        facts.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        for label, value, color in [
            ("檢舉人", "王小明  ·  0912-345…", TEXT_PRIMARY),
            ("受理單位", "台北市政府工務局", TEXT_PRIMARY),
            ("處置進度", "派員勘查完成", ACCENT_GREEN),
            ("預計裁決", "T+5 工作日", ACCENT_AMBER),
        ]:
            cell = ctk.CTkFrame(facts, fg_color="transparent")
            cell.pack(side="left", expand=True, fill="x", padx=16, pady=10)
            ctk.CTkLabel(cell, text=label, font=MONO_S,
                         text_color=TEXT_DIM, anchor="w").pack(anchor="w")
            ctk.CTkLabel(cell, text=value, font=SANS, text_color=color,
                         anchor="w").pack(anchor="w")

        # timeline
        events = [
            TimelineEvent(
                timestamp="2026-05-12 14:32",
                actor="民眾 / @anson",
                title="提交檢舉",
                detail=("透過 Telegram Bot 上傳現場照片 3 張，"
                        "含 EXIF GPS 25.0478, 121.5319；SHA-256 已記錄。"),
            ),
            TimelineEvent(
                timestamp="2026-05-12 14:35",
                actor="系統 / AI",
                title="自動分析完成",
                detail=("GPT-4o 視覺辨識：金屬路障佔用既成道路約 1.8 m。"
                        "違規類型「違章路障」，信心 0.94。"),
            ),
            TimelineEvent(
                timestamp="2026-05-12 15:02",
                actor="市府 / 工務局",
                title="收文編列",
                detail=("受文號 TPE-1141-00845。指派承辦：第二區隊。"
                        "因占用消防通道，優先級調升至 HIGH。"),
            ),
            TimelineEvent(
                timestamp="2026-05-12 15:48",
                actor="現場 / 督察員 陳○○",
                title="派員勘查",
                detail=("到場確認違規屬實。已對所有人發出 30 分鐘自行移除"
                        "通告（NTC-2026-00184）。"),
                status="current",
            ),
            TimelineEvent(
                timestamp="—  ETA 16:18",
                actor="市府 / 工務局",
                title="勒令拆除",
                detail=("若 30 分鐘內未自行移除，將由市府委外廠商拆除，"
                        "並依《道交條例》§82 處 1,200–2,400 元罰鍰。"),
                status="pending",
            ),
        ]
        VerticalTimeline(right, events).grid(row=2, column=0, sticky="nsew")

        # action row
        actions = ctk.CTkFrame(right, fg_color="transparent")
        actions.grid(row=3, column=0, sticky="ew", pady=(8, 0))

        def mk(parent, text, base, hover, fg):
            return ctk.CTkButton(
                parent, text=text, fg_color=base, hover_color=hover,
                text_color=fg, font=SANS_M, height=38, corner_radius=4,
                border_width=1, border_color=BORDER,
            )

        mk(actions, "✓  核准處置", ACCENT_GREEN, "#00E676", "#0A1F0A"
           ).pack(side="left", expand=True, fill="x", padx=(0, 4))
        mk(actions, "✎  補件 / 退回", BG_CARD, BG_HOVER, TEXT_PRIMARY
           ).pack(side="left", expand=True, fill="x", padx=4)
        mk(actions, "↗  轉送其他單位", BG_CARD, BG_HOVER, TEXT_PRIMARY
           ).pack(side="left", expand=True, fill="x", padx=4)
        mk(actions, "✕  結案", BG_CARD, "#3A1E1E", ACCENT_RED
           ).pack(side="left", expand=True, fill="x", padx=(4, 0))

    # ----------------------------- status bar --------------------------------
    def _build_statusbar(self) -> None:
        ctk.CTkFrame(self, fg_color=BORDER, height=1).pack(fill="x", padx=18)
        bar = ctk.CTkFrame(self, fg_color=BG_PRIMARY, height=26)
        bar.pack(fill="x", padx=18, pady=(4, 8))
        bar.pack_propagate(False)
        ctk.CTkLabel(bar, text="● ONLINE", font=MONO_S,
                     text_color=ACCENT_GREEN).pack(side="left", padx=(0, 18))
        ctk.CTkLabel(bar, text="user: anson@tpe.gov.tw",
                     font=MONO_S, text_color=TEXT_SECONDARY).pack(
            side="left", padx=(0, 18))
        ctk.CTkLabel(bar, text="store: ok · audit: ok · smtp: ok",
                     font=MONO_S, text_color=TEXT_DIM).pack(side="left")
        ctk.CTkLabel(bar, text="v0.3 · build 2026.05",
                     font=MONO_S, text_color=TEXT_DIM).pack(side="right")


if __name__ == "__main__":
    ctk.set_appearance_mode("dark")
    App().mainloop()
