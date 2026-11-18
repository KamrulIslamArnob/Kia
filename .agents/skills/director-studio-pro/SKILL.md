---
name: director-studio-pro
description: Orchestrate the 6-Agent Director Studio Pro video production crew on Gemini 4 Carbon ($0 Antigravity subscription guard) — processing Studio Hub tickets, Higgsfield shot storyboards, Google Images design plates, Google Flow generative video clips, neural voiceovers, and zero-error HyperFrames MP4 compilation.
---

# Director Studio Pro — 6-Agent Production Crew

Use this skill whenever the user clicks an AI action in **Director Studio Pro** (`http://localhost:4400`), asks to process pending Studio Hub tickets, wants shot-by-shot storyboard direction, generative plates/B-roll, or end-to-end HyperFrames video compilation.

## Zero-Cost (`$0`) Subscription Law

1. **Included Antigravity Subscription Only**: Run all reasoning and sub-agents on the active Antigravity model (`gemini-4-carbon-high` / `model="inherit"`). Never call paid external APIs unless the user explicitly disables `zeroCostGuard` in `studio-hub/.provider-settings.json`.
2. **Sanctioned Media Backends**:
   - **Design Plates (`frame-designer`)**: Antigravity's built-in `image-generator` / Google Images reference workflow + headless Chrome HTML/SVG capture (`chrome-headless-shell.exe`).
   - **Generative Video (`google-flow-video`)**: Antigravity's `browser` tool driving Google Flow (`https://labs.google/fx/tools/flow`) on the user's signed-in session, or local FFmpeg slicing/speed-ramping of raw footage. Never bypass authentication or CAPTCHA challenges — if Google Flow prompts for sign-in or verification, pause and ask the user to complete it in the visible browser window.
   - **Audio & Transcription (`audio-director`)**: Local `edge-tts` neural voices, cached `faster-whisper` (`local_files_only=True`), and FFmpeg `adelay` + `amix` + `alimiter`.

---

## The 6-Agent Crew Roster

| Agent ID              | Role                                                               | Primary Tools & Modules                                                                                           |
| --------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `brand-analyst`       | Extracts palette, fonts, tone & reference cut pacing               | `studio-hub/media_intelligence.py` (`extract-brand`, `analyze-inspiration`, `analyze-raw`)                        |
| `storyboard-director` | Plans shots, Higgsfield motion presets, speed ramps & VO copy      | `studio-hub/storyboard.mjs` (`generateStoryboard`, `regenerateFrame`, `updateFrame`)                              |
| `frame-designer`      | Creates 1080p background plates & clean/HUD storyboard frames      | Antigravity `image-generator` / Google Images + `storyboard.mjs`                                                  |
| `google-flow-video`   | Generates cinematic B-roll clips in Google Flow or preps raw takes | Antigravity `browser` -> `https://labs.google/fx/tools/flow`                                                      |
| `audio-director`      | Calibrates `edge-tts` voiceover pacing, Whisper sync, SFX & BGM    | `edge-tts`, `faster-whisper`, `ffmpeg` (`atempo`, `adelay`, `amix`)                                               |
| `hyperframes-qa`      | Compiles modular scenes, enforces `hyperframes check`, renders MP4 | `studio-hub/video-compiler.mjs`, `npx hyperframes lint`, `npx hyperframes check --json`, `npx hyperframes render` |

---

## Live Ticket Queue & SSE Bridge (`studio-hub/agent-bridge.mjs`)

Studio Hub persists UI-triggered requests in `projects/<slug>/.studio/agent-queue/tickets.json` and streams real-time crew status to open browsers over SSE.

```bash
# 1. Inspect pending tickets across all projects (or one project)
node studio-hub/agent-bridge.mjs --list-pending
node studio-hub/agent-bridge.mjs --list-pending --slug krishop-promo

# 2. Claim a ticket & light up the agent badge in Studio Hub UI
node studio-hub/agent-bridge.mjs --claim <slug> <ticketId> storyboard-director

# 3. Stream live status updates while working
node studio-hub/agent-bridge.mjs --agent-status frame-designer working "Rendering frame_02 clean + HUD plates"

# 4. Complete (or fail) a ticket with JSON result
node studio-hub/agent-bridge.mjs --complete <slug> <ticketId> '{"ok":true,"outputRelPath":"output/demo_draft.mp4"}'
```

### Handling Ticket Types

1. **`ai_storyboard_direct`**:
   Run `media_intelligence.py` on raw/inspiration/brand inputs, then call `generateStoryboard(...)` in `studio-hub/storyboard.mjs` (`preserveLocked: true` so user-locked shots are never overwritten).
2. **`ai_regenerate_frame`**:
   Call `regenerateFrame({ slug, frameId, prompt, motionPreset, layout, overrides })` in `studio-hub/storyboard.mjs` to create a new version (`v1 -> v2 -> v3`) with updated clean + HUD PNGs.
3. **`ai_generate_image_plate`**:
   Use `image-generator` to create a 1080p brand-matched visual plate in `projects/<slug>/assets/images/plate_<frameId>.png`, then attach `aiBackgroundPlate` via `regenerateFrame` / `updateFrame`.
4. **`ai_google_flow_video`**:
   Open `https://labs.google/fx/tools/flow` in the `browser` tool, submit the shot's motion prompt, save the resulting MP4 into `projects/<slug>/assets/clips/flow_<frameId>.mp4`, and link `sourceClip` on the storyboard frame.
5. **`ai_full_video_edit`**:
   Launch the full 6-agent pipeline via `run_workflow`:
   ```python
   run_workflow(
       ScriptPath="d:/B-2 -- Book PDF Buisness/antigravity video/studio-hub/workflows/director_crew.py",
       Args={"slug": "<slug>", "ticketId": "<ticketId>", "quality": "draft"},
       Description="Run 6-Agent Director Studio Pro video edit",
   )
   ```
   Or invoke `compileProjectVideo` in `studio-hub/video-compiler.mjs` directly when `STORYBOARD.json` is already approved.

---

## HyperFrames Quality Gate (Mandatory Before Delivery)

Every compiled project in `projects/<slug>` **must** pass both gates with **0 errors**:

```bash
npx hyperframes lint projects/<slug>
npx hyperframes check --json projects/<slug>
```

- Keep every timed video `<video muted playsinline>` with `class="clip"`, `data-start`, and `data-duration`.
- Never place CSS `transform` on an element animated by GSAP (`tl.fromTo(...)` only).
- Never use `Date.now()`, `Math.random()`, or leading `/` asset paths (`assets/...` only).
- Keep primary copy inside the 80% title-safe box on high-contrast `#0A1612` surfaces (`#FFFFFF` / `#E2E8F0` text) so WCAG AA contrast passes cleanly on every sampled frame.
