#!/usr/bin/env python3
"""Media intelligence CLI for Director Studio Pro.

Subcommands:
  - analyze-raw --video <path> --out-dir <dir> [--target-scenes 6]
  - analyze-inspiration --video <path> --out-dir <dir>
  - extract-brand [--logo <path>] [--doc <path>] [--text <str>]
  - transcribe --media <path> [--lang auto]
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path
from typing import Any

warnings.filterwarnings("ignore")

import cv2
import numpy as np
from PIL import Image

try:
    import pymupdf as fitz
except ImportError:
    import fitz


KNOWN_FONTS = [
    "Space Grotesk",
    "Plus Jakarta Sans",
    "Instrument Serif",
    "Playfair Display",
    "Clash Display",
    "Cabinet Grotesk",
    "JetBrains Mono",
    "IBM Plex Sans",
    "IBM Plex Mono",
    "General Sans",
    "Noto Sans Bengali",
    "Hind Siliguri",
    "Bebas Neue",
    "Open Sans",
    "Work Sans",
    "Fira Sans",
    "DM Sans",
    "Inter",
    "Sora",
    "Outfit",
    "Manrope",
    "Poppins",
    "Montserrat",
    "Roboto",
    "Lato",
    "Fraunces",
    "Satoshi",
    "Geist",
    "Syne",
    "Oswald",
    "Merriweather",
    "Lora",
    "Rubik",
    "Nunito",
    "Raleway",
]

TONE_VOCAB = [
    "confident",
    "modern",
    "editorial",
    "minimalist",
    "minimal",
    "bold",
    "cinematic",
    "luxury",
    "premium",
    "playful",
    "warm",
    "friendly",
    "energetic",
    "kinetic",
    "futuristic",
    "clean",
    "trustworthy",
    "organic",
    "technical",
    "authoritative",
    "vibrant",
    "brutalist",
    "elegant",
    "human",
    "professional",
]


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = (max(0, min(255, int(v))) for v in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    clean = hex_str.strip().lstrip("#")
    return (int(clean[0:2], 16), int(clean[2:4], 16), int(clean[4:6], 16))


def rgb_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return math.sqrt(sum((float(x) - float(y)) ** 2 for x, y in zip(a, b)))


def save_bgr_png_unicode_safe(bgr_frame: np.ndarray, out_path: Path) -> str:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    Image.fromarray(rgb).save(str(out_path), format="PNG")
    return str(out_path.resolve())


class SafeVideoReader:
    """Context manager opening OpenCV VideoCapture safely even on non-ASCII Windows paths."""

    def __init__(self, video_path: str) -> None:
        self.orig_path = str(Path(video_path).resolve())
        self.temp_copy: str | None = None
        self.cap: cv2.VideoCapture | None = None

    def __enter__(self) -> cv2.VideoCapture:
        if not os.path.isfile(self.orig_path):
            raise FileNotFoundError(f"Video file not found: {self.orig_path}")
        cap = cv2.VideoCapture(self.orig_path)
        if not cap.isOpened():
            ext = Path(self.orig_path).suffix or ".mp4"
            fd, tmp_name = tempfile.mkstemp(prefix="hf_vid_", suffix=ext)
            os.close(fd)
            shutil.copy2(self.orig_path, tmp_name)
            self.temp_copy = tmp_name
            cap = cv2.VideoCapture(tmp_name)
        if not cap.isOpened():
            raise RuntimeError(f"Could not decode video: {self.orig_path}")
        self.cap = cap
        return cap

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self.cap is not None:
            self.cap.release()
        if self.temp_copy and os.path.exists(self.temp_copy):
            try:
                os.remove(self.temp_copy)
            except OSError:
                pass


def quantize_pil_colors(pil_img: Image.Image, count: int = 5) -> list[tuple[tuple[int, int, int], int]]:
    rgba = pil_img.convert("RGBA")
    rgba.thumbnail((240, 240))
    arr = np.array(rgba)
    mask = arr[:, :, 3] >= 32
    opaque_pixels = arr[:, :, :3][mask]
    if opaque_pixels.size == 0:
        opaque_pixels = arr[:, :, :3].reshape(-1, 3)

    sample_side = max(1, int(math.sqrt(len(opaque_pixels))))
    trimmed = opaque_pixels[: sample_side * sample_side].reshape((sample_side, sample_side, 3))
    rgb_img = Image.fromarray(trimmed.astype(np.uint8), mode="RGB")

    quantized = rgb_img.quantize(colors=max(count * 2, 12), method=Image.Quantize.MEDIANCUT)
    palette_raw = quantized.getpalette() or []
    color_counts = quantized.getcolors() or []

    clusters: list[tuple[tuple[int, int, int], int]] = []
    for pix_count, pal_idx in sorted(color_counts, key=lambda item: item[0], reverse=True):
        base = pal_idx * 3
        if base + 2 >= len(palette_raw):
            continue
        rgb = (palette_raw[base], palette_raw[base + 1], palette_raw[base + 2])
        merged = False
        for idx, (existing_rgb, existing_cnt) in enumerate(clusters):
            if rgb_distance(rgb, existing_rgb) < 18.0:
                clusters[idx] = (existing_rgb, existing_cnt + int(pix_count))
                merged = True
                break
        if not merged:
            clusters.append((rgb, int(pix_count)))

    clusters.sort(key=lambda item: item[1], reverse=True)

    # Pad deterministically if image has fewer than `count` distinct colors (e.g. flat graphic)
    seed_rgb = clusters[0][0] if clusters else (30, 130, 76)
    h0, s0, v0 = colorsys.rgb_to_hsv(seed_rgb[0] / 255.0, seed_rgb[1] / 255.0, seed_rgb[2] / 255.0)
    pad_shifts = [
        (0.0, max(0.2, s0 * 0.8), min(0.95, v0 * 1.25 + 0.12)),
        ((h0 + 0.08) % 1.0, min(1.0, s0 * 1.1 + 0.15), min(0.92, v0 + 0.18)),
        ((h0 + 0.5) % 1.0, max(0.55, s0), 0.90),
        (h0, min(0.35, s0), 0.09),
        (h0, min(0.25, s0), 0.18),
    ]
    shift_i = 0
    while len(clusters) < count:
        nh, ns, nv = pad_shifts[shift_i % len(pad_shifts)]
        shift_i += 1
        rr, gg, bb = colorsys.hsv_to_rgb(nh, ns, nv)
        cand = (int(round(rr * 255)), int(round(gg * 255)), int(round(bb * 255)))
        if all(rgb_distance(cand, ex[0]) >= 10.0 for ex in clusters):
            clusters.append((cand, 1))
        else:
            clusters.append((((cand[0] + shift_i * 23) % 256, cand[1], cand[2]), 1))

    return clusters[: max(count, len(clusters))]


def dominant_hex_from_bgr_frames(frames: list[np.ndarray], count: int = 5) -> list[str]:
    if not frames:
        return ["#1E824C", "#2ECC71", "#F1C40F", "#0A1612", "#182C24"][:count]
    thumbs = []
    for f in frames:
        small = cv2.resize(f, (120, 90), interpolation=cv2.INTER_AREA)
        thumbs.append(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
    strip = np.concatenate(thumbs, axis=1)
    clusters = quantize_pil_colors(Image.fromarray(strip), count=count)
    return [rgb_to_hex(rgb) for rgb, _ in clusters[:count]]


def sample_video_metrics(
    cap: cv2.VideoCapture, sample_fps: float = 4.0
) -> tuple[dict[str, Any], list[dict[str, float]]]:
    raw_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    fps = raw_fps if (math.isfinite(raw_fps) and raw_fps > 0.5) else 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    step = max(1, int(round(fps / sample_fps)))
    samples: list[dict[str, float]] = []
    prev_hist: np.ndarray | None = None
    prev_gray: np.ndarray | None = None

    frame_idx = 0
    last_valid_idx = 0
    while True:
        if frame_idx % step == 0:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if width <= 0 or height <= 0:
                height, width = frame.shape[:2]

            last_valid_idx = frame_idx
            t_sec = frame_idx / fps
            scale_w = 240
            scale_h = max(60, int(round(height * (scale_w / max(1, width)))))
            small = cv2.resize(frame, (scale_w, scale_h), interpolation=cv2.INTER_AREA)

            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1, 2], None, [12, 8, 8], [0, 180, 0, 256, 0, 256])
            cv2.normalize(hist, hist)

            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            luma_mean = float(np.mean(gray))
            luma_std = float(np.std(gray))

            if prev_hist is not None and prev_gray is not None:
                hist_delta = float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA))
                motion_energy = float(np.mean(cv2.absdiff(prev_gray, gray)) / 255.0)
            else:
                hist_delta = 0.0
                motion_energy = 0.0

            prev_hist = hist
            prev_gray = gray
            samples.append(
                {
                    "frameIdx": float(frame_idx),
                    "time": t_sec,
                    "histDelta": hist_delta,
                    "motion": motion_energy,
                    "lumaMean": luma_mean,
                    "lumaStd": luma_std,
                }
            )
        else:
            if not cap.grab():
                break
            last_valid_idx = frame_idx
        frame_idx += 1

    est_from_count = (frame_count / fps) if frame_count > 0 else 0.0
    est_from_read = (last_valid_idx + 1) / fps if last_valid_idx > 0 else 0.0
    duration = max(est_from_count, est_from_read)
    if duration <= 0 and samples:
        duration = samples[-1]["time"] + (1.0 / sample_fps)

    meta = {
        "duration": round(float(duration), 2),
        "width": width,
        "height": height,
        "fps": round(float(fps), 2),
    }
    return meta, samples


def read_frame_at_time(cap: cv2.VideoCapture, t_sec: float, fps: float, duration: float) -> np.ndarray:
    clamped_t = max(0.0, min(max(0.0, duration - (1.0 / max(1.0, fps))), t_sec))
    target_frame = max(0, int(round(clamped_t * fps)))
    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
    ok, frame = cap.read()
    if ok and frame is not None:
        return frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    ok, frame = cap.read()
    if ok and frame is not None:
        return frame
    return np.zeros((360, 640, 3), dtype=np.uint8)


def detect_cut_times(
    samples: list[dict[str, float]],
    duration: float,
    min_gap: float = 0.45,
    hard_floor: float = 0.30,
) -> list[tuple[float, float]]:
    """Return list of (time_sec, strength) for hard visual cuts."""
    if len(samples) < 3:
        return []
    deltas = np.array([s["histDelta"] for s in samples[1:]], dtype=np.float64)
    mean_d = float(np.mean(deltas))
    std_d = float(np.std(deltas))
    threshold = max(hard_floor, min(0.55, mean_d + 1.85 * std_d))

    candidates: list[tuple[float, float]] = []
    for i in range(1, len(samples)):
        t = samples[i]["time"]
        d = samples[i]["histDelta"]
        if t < min_gap or t > (duration - min_gap):
            continue
        prev_d = samples[i - 1]["histDelta"]
        next_d = samples[i + 1]["histDelta"] if (i + 1) < len(samples) else 0.0
        if d >= threshold and d >= prev_d and d >= next_d:
            candidates.append((t, d))

    # Enforce min_gap keeping stronger peaks
    selected: list[tuple[float, float]] = []
    for t, strength in sorted(candidates, key=lambda x: x[1], reverse=True):
        if all(abs(t - st) >= min_gap for st, _ in selected):
            selected.append((t, strength))
    selected.sort(key=lambda x: x[0])
    return selected


def adaptive_motion_boundaries(
    samples: list[dict[str, float]],
    duration: float,
    desired_scenes: int,
) -> list[float]:
    if desired_scenes <= 1 or duration <= 0.5:
        return []
    if len(samples) < desired_scenes:
        return [round(duration * k / desired_scenes, 2) for k in range(1, desired_scenes)]

    weights = np.array(
        [0.25 + s["motion"] * 2.5 + s["histDelta"] * 1.5 for s in samples], dtype=np.float64
    )
    cum_w = np.cumsum(weights)
    total_w = float(cum_w[-1])
    min_gap = max(0.8, min(1.8, duration / (desired_scenes * 2.2)))

    boundaries: list[float] = []
    for k in range(1, desired_scenes):
        target_w = (total_w * k) / desired_scenes
        idx = int(np.searchsorted(cum_w, target_w))
        idx = max(1, min(len(samples) - 2, idx))

        # Search small neighborhood for cleanest visual transition or motion inflection
        win_lo = max(1, idx - 3)
        win_hi = min(len(samples) - 2, idx + 3)
        best_idx = idx
        best_score = -1.0
        for j in range(win_lo, win_hi + 1):
            t_cand = samples[j]["time"]
            prev_bound = boundaries[-1] if boundaries else 0.0
            remaining_scenes = desired_scenes - k
            if t_cand - prev_bound < min_gap:
                continue
            if (duration - t_cand) < remaining_scenes * min_gap * 0.75:
                continue
            motion_inflection = abs(samples[j + 1]["motion"] - samples[j - 1]["motion"])
            score = samples[j]["histDelta"] * 2.0 + motion_inflection
            if score > best_score:
                best_score = score
                best_idx = j

        t_pick = samples[best_idx]["time"]
        prev_bound = boundaries[-1] if boundaries else 0.0
        if t_pick - prev_bound < min_gap:
            t_pick = prev_bound + min_gap
        max_allowed = duration - (desired_scenes - k) * min_gap * 0.75
        t_pick = min(t_pick, max_allowed)
        boundaries.append(round(float(t_pick), 2))

    return sorted(set(b for b in boundaries if 0.2 < b < duration - 0.2))


def cmd_analyze_raw(args: argparse.Namespace) -> dict[str, Any]:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    target_scenes = max(1, int(args.target_scenes or 6))

    with SafeVideoReader(args.video) as cap:
        meta, samples = sample_video_metrics(cap, sample_fps=4.0)
        duration = meta["duration"]
        fps = meta["fps"]

        min_scene_gap = 1.2 if duration >= 6.0 else max(0.5, duration / 4.0)
        hard_cuts = detect_cut_times(samples, duration, min_gap=min_scene_gap, hard_floor=0.32)

        if len(hard_cuts) >= target_scenes:
            # Keep strongest target_scenes - 1 cut points
            top_cuts = sorted(hard_cuts, key=lambda x: x[1], reverse=True)[: target_scenes - 1]
            cut_times = sorted(round(t, 2) for t, _ in top_cuts)
        else:
            cut_times = [round(t, 2) for t, _ in hard_cuts]

        if duration >= 6.0 and target_scenes >= 3 and (len(cut_times) + 1) < 3:
            desired = min(target_scenes, max(3, int(round(duration / 2.2))))
            desired = max(3, min(target_scenes, desired))
            cut_times = adaptive_motion_boundaries(samples, duration, desired)
        elif duration < 6.0 and len(cut_times) == 0 and duration >= 3.0 and target_scenes >= 2:
            cut_times = adaptive_motion_boundaries(samples, duration, min(target_scenes, 2))

        # Subdivide any single continuous span exceeding 58% of video when scene budget remains
        edges = [0.0, *cut_times, duration]
        while (len(edges) - 1) < target_scenes and duration >= 8.0:
            spans = [(edges[i + 1] - edges[i], i) for i in range(len(edges) - 1)]
            longest_dur, longest_idx = max(spans, key=lambda x: x[0])
            if longest_dur <= max(10.0, duration * 0.58):
                break
            seg_start = edges[longest_idx]
            seg_end = edges[longest_idx + 1]
            sub_samples = [
                {**s, "time": s["time"] - seg_start}
                for s in samples
                if seg_start <= s["time"] <= seg_end
            ]
            rel_splits = adaptive_motion_boundaries(sub_samples, seg_end - seg_start, 2)
            if not rel_splits:
                mid = round((seg_start + seg_end) / 2.0, 2)
                rel_splits = [mid - seg_start]
            new_cut = round(seg_start + rel_splits[0], 2)
            if new_cut <= seg_start + 0.5 or new_cut >= seg_end - 0.5:
                break
            edges = sorted(set([*edges, new_cut]))
        scenes: list[dict[str, Any]] = []

        for idx in range(len(edges) - 1):
            scene_num = idx + 1
            s_time = round(float(edges[idx]), 2)
            e_time = round(float(edges[idx + 1]), 2)
            s_dur = round(max(0.05, e_time - s_time), 2)

            in_range = [s for s in samples if s_time <= s["time"] <= e_time]
            if in_range:
                mean_motion = float(np.mean([s["motion"] for s in in_range]))
                peak_sample = max(in_range, key=lambda s: s["motion"] + 0.5 * s["histDelta"])
                peak_t = float(peak_sample["time"])
            else:
                mean_motion = 0.0
                peak_t = (s_time + e_time) / 2.0

            pad = min(0.15, s_dur * 0.12)
            start_t = min(e_time - 0.02, s_time + pad)
            end_t = max(s_time + 0.02, e_time - pad)
            peak_t = max(start_t, min(end_t, peak_t))

            f_start = read_frame_at_time(cap, start_t, fps, duration)
            f_peak = read_frame_at_time(cap, peak_t, fps, duration)
            f_end = read_frame_at_time(cap, end_t, fps, duration)

            p_start = save_bgr_png_unicode_safe(f_start, out_dir / f"scene_{scene_num:02d}_start.png")
            p_peak = save_bgr_png_unicode_safe(f_peak, out_dir / f"scene_{scene_num:02d}_peak.png")
            p_end = save_bgr_png_unicode_safe(f_end, out_dir / f"scene_{scene_num:02d}_end.png")

            dom_colors = dominant_hex_from_bgr_frames([f_start, f_peak, f_end], count=5)

            scenes.append(
                {
                    "index": scene_num,
                    "startTime": s_time,
                    "endTime": e_time,
                    "duration": s_dur,
                    "motionScore": round(mean_motion * 100.0, 2),
                    "dominantColors": dom_colors,
                    "keyframes": {
                        "start": p_start,
                        "peak": p_peak,
                        "end": p_end,
                    },
                }
            )

    return {
        "ok": True,
        "duration": meta["duration"],
        "width": meta["width"],
        "height": meta["height"],
        "fps": meta["fps"],
        "scenes": scenes,
    }


def cmd_analyze_inspiration(args: argparse.Namespace) -> dict[str, Any]:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    with SafeVideoReader(args.video) as cap:
        meta, samples = sample_video_metrics(cap, sample_fps=8.0)
        duration = max(0.1, meta["duration"])
        fps = meta["fps"]

        cuts = detect_cut_times(samples, duration, min_gap=0.35, hard_floor=0.28)
        cut_timestamps = [round(t, 2) for t, _ in cuts]
        cut_count = len(cut_timestamps)
        shot_count = cut_count + 1
        avg_shot_length = round(duration / max(1, shot_count), 2)
        cuts_per_minute = round((cut_count / duration) * 60.0, 2)

        if avg_shot_length < 2.5:
            pacing = "fast-kinetic"
        elif avg_shot_length <= 5.5:
            pacing = "rhythmic-editorial"
        else:
            pacing = "calm-cinematic"

        if samples:
            mean_luma = float(np.mean([s["lumaMean"] for s in samples]))
            mean_std = float(np.mean([s["lumaStd"] for s in samples]))
        else:
            mean_luma = 127.5
            mean_std = 40.0

        brightness = round(max(0.0, min(100.0, (mean_luma / 255.0) * 100.0)), 2)
        contrast = round(max(0.0, min(100.0, (mean_std / 127.5) * 100.0)), 2)

        shot_edges = [0.0, *cut_timestamps, duration]
        shot_midpoints = [
            (shot_edges[i] + shot_edges[i + 1]) / 2.0 for i in range(len(shot_edges) - 1)
        ]

        max_frames = 6
        if len(shot_midpoints) >= max_frames:
            idxs = np.linspace(0, len(shot_midpoints) - 1, max_frames, dtype=int)
            style_times = [shot_midpoints[int(i)] for i in idxs]
        elif len(shot_midpoints) > 1:
            style_times = list(shot_midpoints)
            while len(style_times) < min(max_frames, max(3, int(duration // 1.0))):
                extra_t = duration * (len(style_times) + 0.5) / max_frames
                style_times.append(min(duration - 0.05, extra_t))
            style_times = sorted(style_times)[:max_frames]
        else:
            num_pick = min(max_frames, max(1, int(round(duration / 1.0))))
            style_times = [
                duration * (k + 0.5) / num_pick for k in range(num_pick)
            ]

        style_frames: list[str] = []
        bgr_list: list[np.ndarray] = []
        for idx, t_sec in enumerate(style_times[:max_frames], start=1):
            frame = read_frame_at_time(cap, t_sec, fps, duration)
            bgr_list.append(frame)
            saved = save_bgr_png_unicode_safe(frame, out_dir / f"insp_{idx:02d}.png")
            style_frames.append(saved)

        dominant_colors = dominant_hex_from_bgr_frames(bgr_list, count=5)

    return {
        "ok": True,
        "duration": meta["duration"],
        "width": meta["width"],
        "height": meta["height"],
        "fps": meta["fps"],
        "cutTimestamps": cut_timestamps,
        "cutCount": cut_count,
        "avgShotLength": avg_shot_length,
        "cutsPerMinute": cuts_per_minute,
        "pacing": pacing,
        "brightness": brightness,
        "contrast": contrast,
        "dominantColors": dominant_colors,
        "styleFrames": style_frames,
    }


def rank_brand_palette(rgb_candidates: list[tuple[tuple[int, int, int], int]]) -> dict[str, str]:
    total_cnt = max(1, sum(c for _, c in rgb_candidates))
    scored = []
    for rgb, cnt in rgb_candidates:
        h, s, v = colorsys.rgb_to_hsv(rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0)
        ratio = cnt / total_cnt
        vibrancy = s * 0.65 + ratio * 0.35 if (0.12 < v < 0.98 and s > 0.14) else ratio * 0.25
        scored.append({"rgb": rgb, "hex": rgb_to_hex(rgb), "h": h, "s": s, "v": v, "vibrancy": vibrancy})

    by_vibrancy = sorted(scored, key=lambda x: x["vibrancy"], reverse=True)
    primary_item = by_vibrancy[0]

    secondary_candidates = [
        item for item in by_vibrancy[1:] if rgb_distance(item["rgb"], primary_item["rgb"]) >= 24.0
    ]
    secondary_item = secondary_candidates[0] if secondary_candidates else by_vibrancy[min(1, len(by_vibrancy) - 1)]

    accent_candidates = sorted(
        [
            item
            for item in scored
            if item["hex"] not in (primary_item["hex"], secondary_item["hex"])
        ],
        key=lambda x: (x["s"] * 0.6 + x["v"] * 0.4),
        reverse=True,
    )
    accent_item = accent_candidates[0] if accent_candidates else secondary_item

    dark_candidates = sorted(scored, key=lambda x: (x["v"] + x["s"] * 0.25))
    if dark_candidates and dark_candidates[0]["v"] <= 0.32:
        bg_hex = dark_candidates[0]["hex"]
        bg_rgb = dark_candidates[0]["rgb"]
    else:
        rr, gg, bb = colorsys.hsv_to_rgb(primary_item["h"], min(0.35, primary_item["s"]), 0.08)
        bg_rgb = (int(round(rr * 255)), int(round(gg * 255)), int(round(bb * 255)))
        bg_hex = rgb_to_hex(bg_rgb)

    surface_candidates = [
        item
        for item in dark_candidates
        if item["hex"] != bg_hex and 14.0 <= rgb_distance(item["rgb"], bg_rgb) <= 120.0
    ]
    if surface_candidates:
        surface_hex = surface_candidates[0]["hex"]
    else:
        rr, gg, bb = colorsys.hsv_to_rgb(primary_item["h"], min(0.28, primary_item["s"]), 0.15)
        surface_hex = rgb_to_hex((int(round(rr * 255)), int(round(gg * 255)), int(round(bb * 255))))

    return {
        "primary": primary_item["hex"],
        "secondary": secondary_item["hex"],
        "accent": accent_item["hex"],
        "background": bg_hex,
        "surface": surface_hex,
    }


def read_brand_document_text(doc_path: str) -> str:
    p = Path(doc_path)
    if not p.is_file():
        raise FileNotFoundError(f"Brand document not found: {doc_path}")
    ext = p.suffix.lower()
    if ext == ".pdf":
        doc = fitz.open(str(p))
        pages_text = [page.get_text("text") for page in doc]
        doc.close()
        return "\n".join(pages_text)
    raw = p.read_text(encoding="utf-8", errors="replace")
    if ext == ".json":
        try:
            obj = json.loads(raw)
            return json.dumps(obj, indent=2, ensure_ascii=False)
        except json.JSONDecodeError:
            return raw
    return raw


def load_logo_pil(logo_path: str) -> Image.Image:
    p = Path(logo_path)
    if not p.is_file():
        raise FileNotFoundError(f"Brand logo not found: {logo_path}")
    if p.suffix.lower() == ".svg":
        doc = fitz.open(str(p))
        pix = doc[0].get_pixmap(alpha=True)
        img = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
        doc.close()
        return img
    return Image.open(str(p)).convert("RGBA")


def cmd_extract_brand(args: argparse.Namespace) -> dict[str, Any]:
    combined_chunks: list[str] = []
    if args.doc:
        combined_chunks.append(read_brand_document_text(args.doc))
    if args.text:
        combined_chunks.append(str(args.text))

    raw_text = "\n".join(c for c in combined_chunks if c.strip())

    # Hex codes (#RRGGBB)
    hex_codes: list[str] = []
    for match in re.findall(r"#[0-9A-Fa-f]{6}\b", raw_text):
        up = match.upper()
        if up not in hex_codes:
            hex_codes.append(up)

    # Font mentions
    font_mentions: list[str] = []
    heading_font: str | None = None
    body_font: str | None = None

    h_match = re.search(
        r"(?:heading|display|title)\s*font\s*[:=\-]\s*[\"']?([A-Za-z][A-Za-z0-9 \-]{1,30})",
        raw_text,
        flags=re.IGNORECASE,
    )
    if h_match:
        cand = h_match.group(1).strip()
        heading_font = cand
        font_mentions.append(cand)

    b_match = re.search(
        r"(?:body|copy|text)\s*font\s*[:=\-]\s*[\"']?([A-Za-z][A-Za-z0-9 \-]{1,30})",
        raw_text,
        flags=re.IGNORECASE,
    )
    if b_match:
        cand = b_match.group(1).strip()
        body_font = cand
        if cand not in font_mentions:
            font_mentions.append(cand)

    for known in KNOWN_FONTS:
        pattern = r"(?<![A-Za-z0-9])" + re.escape(known) + r"(?![A-Za-z0-9])"
        if re.search(pattern, raw_text, flags=re.IGNORECASE):
            if not any(f.lower() == known.lower() for f in font_mentions):
                font_mentions.append(known)

    if not heading_font and font_mentions:
        heading_font = font_mentions[0]
    if not body_font:
        body_font = font_mentions[1] if len(font_mentions) >= 2 else (heading_font or "Inter")
    heading_font = heading_font or "Inter"

    # Tone keywords
    tone_keywords: list[str] = []
    lower_text = raw_text.lower()
    for kw in TONE_VOCAB:
        if re.search(r"\b" + re.escape(kw) + r"\b", lower_text):
            tone_keywords.append(kw)

    if len(tone_keywords) >= 2:
        tone_label = f"{tone_keywords[0].capitalize()} & {tone_keywords[1].capitalize()}"
    elif len(tone_keywords) == 1:
        tone_label = f"{tone_keywords[0].capitalize()} & Modern"
    else:
        tone_label = "Confident & Modern"

    # Logo color extraction (or fallback to doc hex codes)
    if args.logo:
        logo_img = load_logo_pil(args.logo)
        clusters = quantize_pil_colors(logo_img, count=6)
        ranked = rank_brand_palette(clusters)
    elif hex_codes:
        doc_clusters = [(hex_to_rgb(hx), max(1, 10 - i)) for i, hx in enumerate(hex_codes)]
        # Ensure at least 5 candidates
        seed_img = Image.new("RGB", (20, 20), doc_clusters[0][0])
        padded = doc_clusters + quantize_pil_colors(seed_img, count=5)
        ranked = rank_brand_palette(padded)
    else:
        ranked = {
            "primary": "#1E824C",
            "secondary": "#2ECC71",
            "accent": "#F1C40F",
            "background": "#0A1612",
            "surface": "#14261E",
        }

    clean_lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw_text.splitlines()]
    summary = "\n".join(ln for ln in clean_lines if ln)[:2000]

    extracted_palette = [
        ranked["primary"],
        ranked["secondary"],
        ranked["accent"],
        ranked["background"],
        ranked["surface"],
    ]

    return {
        "ok": True,
        "colors": ranked,
        "primary": ranked["primary"],
        "secondary": ranked["secondary"],
        "accent": ranked["accent"],
        "background": ranked["background"],
        "surface": ranked["surface"],
        "extractedPalette": extracted_palette,
        "hexCodes": hex_codes,
        "fonts": {
            "heading": heading_font,
            "body": body_font,
        },
        "fontMentions": font_mentions,
        "tone": tone_label,
        "toneKeywords": tone_keywords,
        "summary": summary,
        "guidelinesText": summary,
    }


def cmd_transcribe(args: argparse.Namespace) -> dict[str, Any]:
    media_path = str(Path(args.media).resolve())
    if not os.path.isfile(media_path):
        raise FileNotFoundError(f"Media file not found: {media_path}")

    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-select_streams",
            "a",
            media_path,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    has_audio_stream = False
    if probe.returncode == 0 and probe.stdout.strip():
        try:
            data = json.loads(probe.stdout)
            has_audio_stream = len(data.get("streams") or []) > 0
        except json.JSONDecodeError:
            has_audio_stream = False

    if not has_audio_stream:
        return {"ok": True, "hasSpeech": False, "segments": []}

    # Check if audio stream is completely silent/muted
    vol_check = subprocess.run(
        [
            "ffmpeg",
            "-t",
            "30",
            "-i",
            media_path,
            "-af",
            "volumedetect",
            "-vn",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    max_vol_match = re.search(r"max_volume:\s*([-\d.]+)\s*dB", vol_check.stderr or "")
    if max_vol_match:
        try:
            if float(max_vol_match.group(1)) <= -70.0:
                return {"ok": True, "hasSpeech": False, "segments": []}
        except ValueError:
            pass

    # Attempt faster_whisper strictly with local_files_only=True so we never hang offline
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return {"ok": True, "hasSpeech": True, "modelCached": False, "segments": []}

    model = None
    for candidate_size in ("base", "small", "tiny"):
        try:
            model = WhisperModel(
                candidate_size,
                device="cpu",
                compute_type="int8",
                local_files_only=True,
            )
            break
        except Exception:
            continue

    if model is None:
        return {"ok": True, "hasSpeech": True, "modelCached": False, "segments": []}

    # Decode 16kHz mono PCM via ffmpeg to bypass PyAV Python 3.14 compatibility issues
    pcm_proc = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "quiet",
            "-i",
            media_path,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "-",
        ],
        capture_output=True,
    )
    if pcm_proc.returncode != 0 or not pcm_proc.stdout:
        return {"ok": True, "hasSpeech": False, "segments": []}

    audio_np = np.frombuffer(pcm_proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if audio_np.size == 0:
        return {"ok": True, "hasSpeech": False, "segments": []}

    lang_arg = None if (not args.lang or args.lang == "auto") else args.lang
    try:
        try:
            seg_iter, info = model.transcribe(audio_np, language=lang_arg, vad_filter=True)
            raw_segments = list(seg_iter)
        except Exception:
            seg_iter, info = model.transcribe(audio_np, language=lang_arg, vad_filter=False)
            raw_segments = list(seg_iter)
    except Exception:
        return {"ok": True, "hasSpeech": True, "modelCached": False, "segments": []}

    segments = []
    for seg in raw_segments:
        txt = (seg.text or "").strip()
        if txt:
            segments.append(
                {
                    "start": round(float(seg.start), 2),
                    "end": round(float(seg.end), 2),
                    "text": txt,
                }
            )

    return {
        "ok": True,
        "hasSpeech": len(segments) > 0,
        "modelCached": True,
        "language": getattr(info, "language", lang_arg or "auto"),
        "segments": segments,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Director Studio Pro Media Intelligence")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    p_raw = sub.add_parser("analyze-raw")
    p_raw.add_argument("--video", required=True)
    p_raw.add_argument("--out-dir", required=True)
    p_raw.add_argument("--target-scenes", type=int, default=6)

    p_insp = sub.add_parser("analyze-inspiration")
    p_insp.add_argument("--video", required=True)
    p_insp.add_argument("--out-dir", required=True)

    p_brand = sub.add_parser("extract-brand")
    p_brand.add_argument("--logo", default=None)
    p_brand.add_argument("--doc", default=None)
    p_brand.add_argument("--text", default=None)

    p_tx = sub.add_parser("transcribe")
    p_tx.add_argument("--media", required=True)
    p_tx.add_argument("--lang", default="auto")

    return parser


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.subcommand == "analyze-raw":
            payload = cmd_analyze_raw(args)
        elif args.subcommand == "analyze-inspiration":
            payload = cmd_analyze_inspiration(args)
        elif args.subcommand == "extract-brand":
            payload = cmd_extract_brand(args)
        elif args.subcommand == "transcribe":
            payload = cmd_transcribe(args)
        else:
            raise ValueError(f"Unknown subcommand: {args.subcommand}")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
