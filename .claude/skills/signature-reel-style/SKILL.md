---
name: signature-reel-style
description: Use when editing, animating, or building a vertical short-form video or reel (9:16, 1080x1920) in the user's signature inspiration style, or when asked for signature-reel-style, blur-morph chest captions, numbered step trackers, frosted glass callout pills, neon-flicker chapter cards, or 3D perspective phone showcase beats over talking-head or voiceover media.
metadata:
  internal: true
---

# Signature Reel Style (`signature-reel-style`)

Turns raw talking-head footage, voiceover, or a short-form script into a `1080x1920` (`30 fps`) high-retention vertical HyperFrames reel built from the exact visual, typographic, and frame-level motion DNA reverse-engineered from the 3 reference reels.

**Load first, non-negotiable:** `/hyperframes` (plus `motion-doctrine` and `captions-overlay` when present in the workspace). This skill defines the exact visual system, beat architecture, coordinates, and GSAP curves; `/hyperframes` enforces the deterministic rendering contract.

---

## Execution Pipeline (Follow in Order)

### 0 · Bootstrap from `examples/master-skeleton.html` — Non-Negotiable

Copy `<SKILL_DIR>/examples/master-skeleton.html` into the target project as `index.html` **before** authoring any scene markup:

```bash
mkdir -p <project>/assets
cp "<SKILL_DIR>/examples/master-skeleton.html" "<project>/index.html"
```

Then read **both** reference files end-to-end (do not skim):

1. `references/style-spec.md` — exact `1080x1920` coordinates, `#hex` palette presets (`lime-noir`, `violet-studio`, `crimson-editorial`), font scales, frame durations, audio loudness targets, and the `BANNED` anti-pattern list.
2. `references/gsap-recipes.md` — lint-clean HTML/CSS + GSAP `fromTo` implementations for all 8 signature motion primitives.

Never write a blank `index.html` from scratch or copy an unrelated project's styles; skipping the scaffold causes generic centered-subtitle drift.

### 1 · Probe Media & Extract Frame-Accurate Speech Clock

1. Run `ffprobe` on the input video or voiceover to record exact `width`, `height`, `r_frame_rate`, and `duration`. Clamp root `data-duration` to the media's real `ffprobe` duration.
2. Extract word-level timestamps (`npx hyperframes transcribe <media> --json` or TTS `--words`).
3. Convert every cut and cue to exact frame time: `Math.floor(frameIndex) / 30` (6 decimal places, e.g., frame `84` at `30 fps` = `2.800000`). Drop Whisper hallucinations over trailing silence (`silencedetect=noise=-35dB:d=0.6`).

### 2 · Pick One Palette Mode & Plan the Beat Ledger

Select **one** palette mode from `references/style-spec.md` (`lime-noir` default, `violet-studio`, `crimson-editorial`, or a single user-specified brand accent over `#09060c` dark studio ground). Never mix multiple competing neon accents in one reel unless a white chapter card introduces a specific product's brand mark.

Map every `1.8s–3.2s` spoken stretch onto the **5 Signature Beat Archetypes** so no stretch exceeds `3.0s` without a staged reveal, wrapper punch-in, or UI action:

| Beat Archetype                              | When to Use                                    | Core Visual Mechanics                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 · Hook Stack (`0.0s–3.0s`)**           | Opening claim / listicle promise               | Start motion at `0.067s–0.133s` (`f2–f4`, never static at `0.0s`). Choose: (a) Giant gradient numeral (`260px`) + 3D-tilted frosted glass app badges rising from behind subject shoulders, (b) 3 drop-bounce glowing glass number orbs (`1, 2, 3`) over chest (`7 frames` per orb), or (c) Tight close-up (`1.12x`) + chest blur-morph hook question.                                                                                                                      |
| **B2 · Chest Blur-Morph Ladder**            | Core talking-head argument / emotional punch   | 1–4 tightly stacked lines in the chest optical zone (`y = 1040px–1260px`, `line-height: 0.94`). Each line enters via `6-frame (0.20s)` optical blur-morph (`blur(14px) -> 0px`, `y: 18 -> 0`). Promote the peak word to Italic Serif (`Playfair Display 700i`) or `1.45x` accent glow + `8-frame` SVG underline/oval draw.                                                                                                                                                 |
| **B3 · Step Tracker / Neon Chapter**        | List transitions (`#1`, `#2`, `#3`)            | Choose: (a) Top `(1)—2—3` luminous tracker (`y = 220px`) where active step blooms white->accent + left `260px` faded numeral + vertical `Trick` capsule pill (`132x230px`), or (b) Full-bleed `#ffffff` chapter card with `6-frame` neon-tube flicker numeral (`3x` 1-frame strobes) + `blur(12px)` foreground brand mark on right edge.                                                                                                                                   |
| **B4 · 3D Device / Split-Slot Glass Pills** | Product demo, tutorial steps, feature list     | Choose: (a) Dark `24px` dotted-matrix stage + radial top glow + top `52px` caption (`y = 260px`) + `820px`-tall iPhone mockup (`y: +210 -> 0` in `8 frames`) that swings in 3D (`perspective(1400px) rotateY(±16deg)` in `10 frames`) with `3px` glowing highlight boxes around target UI rows, or (b) Stacked frosted dark glass pills (`620x136px`, `border-radius: 34px`) over torso with counter-vertical split-slot text reveal (`y: +56 / -56 -> 0` in `12 frames`). |
| **B5 · Punch-In Micro-CTA**                 | Early retention save (`~3.0s`) or outro follow | Hard wrapper zoom cut (`scale: 1.24` or `1.42` via instant `tl.set`) + either left `4px` vertical accent bar with bookmark Save prompt, or chest frosted glass `@handle` pill + SVG comic burst rays around CTA headline.                                                                                                                                                                                                                                                  |

### 3 · Author Deterministic HyperFrames Markup & GSAP

1. **Wrapper Isolation & Studio Structure Rule**:
   - **Standalone `< 15s` reels (`index.html` <= 300 structural lines)**: Keep top-level `<div id="beat-..." class="slide clip" data-start="..." data-duration="..." data-track-index="1|2">` (ping-pong tracks `1` and `2`) and build inner layout with styled `<span style="display:flex|block; ...">` and `<svg>` tags (exactly as in `examples/master-skeleton.html`), OR
   - **Multi-scene `15s+` reels**: Mount one sub-composition per beat (`data-composition-src="compositions/beat-1.html"`) where `<div id="root">` inside `<template>` holds full `<div>` trees. Putting nested `<div>` elements directly inside a timed clip in `index.html` triggers `nested_structure_needs_subcomposition` (a warning in CLI and an error in Studio).
   - **Never** target a `.clip` element with GSAP (`gsap_animates_clip_element`), and **never** put CSS `transform` on an element GSAP animates (`gsap_css_transform_conflict`).
2. **Adaptive Contrast Ink**: Check background luminance behind chest text. Over dark backgrounds/dark shirts (`luma < 150`), primary ink is `#ffffff`. Over white knit shirts or `#ffffff` chapter cards (`luma > 175`), switch non-accent primary ink to `#111115` so WCAG AA contrast (`>= 4.5:1`) holds on every frame.
3. **Deterministic Tweens Only**: Use `tl.fromTo(..., { immediateRender: false })` and `tl.set(...)` on a single paused timeline registered at `window.__timelines["main"] = tl`. End every transient caption/ladder group with `tl.set(el, { opacity: 0, visibility: "hidden" }, endSec)` so stale text never leaks.
4. **Audio & SFX Mix**: Normalize integrated mix to `-14.2 LUFS` (`True Peak <= -1.0 dBFS`). Keep primary voice at `data-volume="1.0"`, duck BGM to `data-volume="0.14"`, and place discrete `<audio id="sfx-...">` hits on major cuts/reveals (whip whoosh on 3D flips/chapter cuts, soft low-pass pop on glass pills/orbs, crisp click/chime on neon box & step tracker).

### 4 · Verification Gate (Mandatory Before Preview or Render)

Run all three checks and resolve every error and warning before declaring completion:

```bash
npx hyperframes lint
npx hyperframes check --json
npx hyperframes snapshot --at 0.5,2.0,4.5,7.5,10.5
```

Inspect the rendered PNGs in `.hyperframes/artifacts/snapshots/` visually to confirm:

- No text overlaps a speaker's eyes/mouth or clips at container edges.
- Every frame sits inside the vertical safe band (`y: 192px..1728px`, `x: 108px..972px` for readable copy).
- Optical blur clears cleanly to `blur(0px)` on settled holds.

---

## Red Flags — Stop and Fix Immediately

| Shortcut Temptation                                               | Why It Breaks `signature-reel-style`                                              | Required Fix                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Putting subtitles at `bottom: 80px` in yellow/black CapCut style  | Fights platform UI chrome and destroys the chest-focal editorial look             | Place talking-head ladders at `y = 1040px–1260px` (chest zone) or `y = 240px–340px` above device mockups                  |
| Using `0.5s–0.8s` `power2.out` fade+slide-up on every text block  | Reads as slow, generated AI template motion                                       | Use `6-frame (0.20s)` `power3.out` optical blur-morph (`blur(14px) -> 0px`, `y: 18 -> 0`) or `12-frame` split-slot reveal |
| Leaving a talking-head shot untouched for `5+` seconds            | Viewer retention collapses after `3s` without visual progression                  | Add an accumulated ladder line, wrapper punch-in (`1.00 -> 1.24`), or frosted glass callout pill every `1.8s–3.0s`        |
| Adding idle floating/breathing loops (`yoyo: true, repeat: -1`)   | Non-deterministic or screams "video is waiting" (`motion-doctrine` violation)     | Hold landed titles dead still; put continuous motion into `1.00 -> 1.06` camera wrapper creep or active UI steps          |
| Animating `.clip` directly or combining CSS `transform` with GSAP | Triggers `gsap_animates_clip_element` / `gsap_css_transform_conflict` lint errors | Keep `.clip` unstyled for transforms; animate inner `.swrap` or child elements via `gsap.fromTo`                          |
