# `@hyperframes/studio-hub` — Local-First AI Video Production Studio (V4)

`studio-hub/` is the self-contained **Director Studio Pro (V4)** application inside [`KamrulIslamArnob/Kia`](https://github.com/KamrulIslamArnob/Kia): a local-first, `$0`-subscription-guarded 5-step video studio with a React 19 White-Mode frontend, Node.js HTTP/SSE server, Python + FFmpeg media intelligence, Headless Chrome 1080p storyboard design frames, interactive draw-on-frame regional regeneration, dynamic local `SKILL.md` compliance scoring, multilingual neural voice & character lip-sync, spatial node-whiteboard scene stitching, and pre-publish ad creative retention analytics.

> For new-machine installation, OS-specific prerequisites (`winget` / `brew` / `apt`), and Git `origin`/`upstream` maintenance, see **[`../STUDIO_SETUP.md`](../STUDIO_SETUP.md)**.

---

## Quick Commands

```bash
# Run cross-OS dependency check, scaffold folders & build React 19 UI
node studio-hub/setup.mjs

# Rebuild React 19 UI bundle (studio-hub/ui-src/** -> studio-hub/public/*)
node studio-hub/build-ui.mjs

# Start Studio Hub HTTP + SSE server at http://localhost:4400
node studio-hub/server.mjs

# Run all 35 automated test suites (154+ tests)
node --test studio-hub/tests/*.test.mjs

# Format & lint Studio Hub source
npx oxfmt studio-hub/
npx oxlint studio-hub/*.mjs studio-hub/presets studio-hub/templates studio-hub/tests studio-hub/ui-src
```

_(Or from inside `studio-hub/`: `bun run setup`, `bun run build`, `bun run start`, `bun run test`.)_

---

## Directory Layout

```text
studio-hub/
├── package.json                  # @hyperframes/studio-hub scripts (setup, build, start, test)
├── setup.mjs                     # Cross-OS toolchain verifier, folder scaffolder & UI builder
├── build-ui.mjs                  # Offline esbuild bundler (ui-src/main.jsx -> public/app.js)
├── server.mjs                    # Main HTTP/1.1 + Range media + SSE server (default port 4400)
├── routes-pro.mjs                # Pro catalog, SFX preview, color grade, captions & Google Flow plan routes
├── routes-v2.mjs                 # V2 dynamic skills, video rating, 15MB regional canvas regen & saved vault
├── routes-v3.mjs                 # V3 voices/lip-sync, node whiteboard, ad analytics, rea-video & PM insights routes
├── routes-v4.mjs                 # V4 beat-quantize, subject-matte, smart-reframe, subtitles, A/B thumbnails, batch & bundles
├── lib.mjs                       # Cross-OS PATH/Python/Chrome discovery, FFprobe cache, manifest sync
├── folder-ingest.mjs             # Non-destructive external folder scan/import + Python CLI runner
├── media_intelligence.py         # OpenCV scene cuts, Pillow palette extraction, PyMuPDF & faster-whisper
├── rea-inspiration.mjs           # Deep inspiration animation/editing style decomposition via rea-video
├── cli-ingest.mjs                # CLI intake helper (--status, --file, --url)
├── storyboard.mjs                # 1080p Clean & Blueprint HUD frame generator + prompt parser
├── skills-registry.mjs           # Dynamic 4-scope local SKILL.md discovery, installer & directive compiler
├── skill-bundles.mjs             # Portable .studioskills.json preset pack exporter & importer
├── video-rating.mjs              # Whole-Video Quality Scorer (0-100, S..C, WCAG contrast, 1-click fixes)
├── frame-inpaint.mjs             # Draw-on-Frame zone analyzer, regional regeneration & Saved Frames Vault
├── voice-lipsync.mjs             # Bengali/English/Hindi Edge-TTS, original voice sync & OpenCV lip-sync
├── whiteboard-graph.mjs          # Footage + Note -> Scene graph compiler (dead-air trim + concat/xfade)
├── ad-analytics.mjs              # 3s Hook score, retention curve, sound-off, safe zones & A/B hook variants
├── beat-quantizer.mjs            # Music BPM/onset beat grid cut snapping & kinetic text stagger alignment
├── subject-matte.mjs             # Local OpenCV GrabCut speaker foreground RGBA matte extractor
├── smart-reframe.mjs             # Multi-aspect (9:16, 1:1, 4:5, 16:9) focal-aware crop planner & FFmpeg renderer
├── delta-cache.mjs               # SHA-256 per-scene content-addressable render cache (.studio/scene-cache/)
├── subtitle-exporter.mjs         # Broadcast-valid .srt, .vtt & styled karaoke .ass sidecar exporter
├── thumbnail-ab-gen.mjs          # 3-variant High-CTR A/B/C YouTube/Reels PNG cover generator
├── local-batch-runner.mjs        # Multi-language (en/bn/hi) x multi-aspect localized HyperFrames variant builder
├── video-compiler.mjs            # 5-stage HyperFrames composition builder, browser check gate & MP4 encoder
├── captions-engine.mjs           # Word-timed phrase choreographer & HyperFrames caption sub-compositions
├── sound-engine.mjs              # Procedural WAV SFX synthesizer, onset beat detector & ducked BGM mixer
├── color-grade.mjs               # 10 cinema FFmpeg color looks & preview/clip grading engine
├── google-flow-playbook.mjs      # $0 Antigravity Google Images + Google Flow shot manifest generator
├── agent-bridge.mjs              # 6-Agent crew roster, $0 zeroCostGuard, ticket queue CLI & SSE hub
├── presets/
│   └── camera-rigs.mjs           # Camera bodies, lenses (14mm-85mm), apertures & 24 DoP motion rigs
├── templates/
│   ├── pack-device-spotlight.mjs # 3D device showcase & oversized cursor spotlight scene templates
│   ├── pack-editorial-bento.mjs  # Split editorial & modular bento feature grid scene templates
│   ├── pack-cinema-statement.mjs # Fullbleed cinema & kinetic statement card scene templates
│   ├── pack-wipe-metrics.mjs     # Before/after wipe & animated metric counter wall templates
│   ├── pack-behind-speaker.mjs   # Depth-of-Text behind-speaker & parallax 3-layer sandwich templates
│   └── pack-social-hooks.mjs     # Viral hook question & proof-quote card templates
├── workflows/
│   ├── director_crew.py          # 6-Agent end-to-end production workflow orchestrator
│   └── google_media_crew.py      # Google Images plate + Google Flow generative clip workflow
├── ui-src/                       # React 19 source (bundled to public/ via build-ui.mjs)
│   ├── main.jsx                  # Mounts <StudioProvider><App /></StudioProvider>
│   ├── App.jsx                   # 2-column Studio shell, Step 1..5 router, drawers & modals
│   ├── api.js                    # Fetch wrapper, XHR upload progress & /media/:slug URL resolver
│   ├── store.jsx                 # Reactive Studio state, SSE /api/events client, Icons & V2/V3/V4 actions
│   ├── styles/studio.css         # White-Mode minimalist design tokens & dark appearance override
│   └── components/
│       ├── Sidebar.jsx           # Project switcher, 5-step progress rail, summary pills & theme switch
│       ├── StepsOneToThree.jsx   # Step 1 Raw footage, Step 2 Inspiration, Step 3 Brand & goal
│       ├── StepFourStoryboard.jsx# Step 4 1080p Design frames grid, Whiteboard tab, ProToolsBelt & Skills/Rating
│       ├── StepFiveExport.jsx    # Step 5 Export config, ProToolsBelt, 5-stage checklist & Master MP4 player
│       ├── ProToolsBelt.jsx      # V4 Power-Tools belt (Beat Snap, Matte, Reframe, Subtitles, A/B Covers, Batch, Bundles)
│       ├── FrameCanvasEditor.jsx # Interactive HTML5 canvas mask/box/arrow/pin regional studio
│       ├── SkillsAndRatingPanel.jsx # Local SKILL.md selector/installer & 0-100 Video Rating card
│       ├── SavedFramesDrawer.jsx # Permanent bookmarked PNG snapshots vault
│       ├── VoiceAndLipSyncCard.jsx # Original voice auto-sync vs Bengali/English/Hindi AI lip-sync
│       ├── WhiteboardCanvas.jsx  # Spatial dotted-grid Footage + Note -> Scene node editor
│       ├── AdAnalyticsPanel.jsx  # 3s Hook, SVG retention curve, platform safe zones & A/B hooks
│       └── AgentsDrawer.jsx      # 6-Agent crew status, $0 guard toggle & 1-click task queue
├── docs/
│   ├── PRODUCT_SPEC_V2.md        # Product positioning, White-Mode UX rules & rating rubric
│   ├── ARCHITECTURE_CONTRACTS.md # V2 TypeScript/JSDoc & REST JSON contracts
│   ├── V3_CONTRACTS.md           # V3/V4 Voice, Whiteboard, Ad Analytics, rea-video & Power-Tools contracts
│   ├── PM_CONTINUOUS_RESEARCH.md # Continuous PM research & competitive roadmap
│   ├── PM_ROADMAP_V4.md          # V4 shipped feature telemetry & V5 next-horizon roadmap
│   └── pm-insights.json          # Live JSON feed served by GET /api/pm-insights
└── tests/                        # 35 automated test suites (node:test + node:assert/strict)
```

---

## Complete HTTP & SSE API Reference (`http://localhost:4400`)

### Core Server Routes (`server.mjs`)

| Method & Path                                                    | Purpose                                                                                                                                      |
| :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/events`                                                | Real-time SSE stream (`connected`, `storyboard_updated`, `compile_progress`, `job_updated`, `ticket_updated`, `agent-status`).               |
| `GET /api/status`                                                | FFmpeg/FFprobe/yt-dlp/Edge-TTS/HyperFrames health, active project, loose root videos, crew & `$0` provider settings.                         |
| `GET` / `POST /api/provider-settings`                            | Read or update `$0` `zeroCostGuard` provider settings (`antigravity-subscription` / `gemini-free-tier`).                                     |
| `GET` / `POST /api/projects`                                     | List all projects in `projects/` or create & activate a new project (`{ title, aspectRatio, durationSeconds, language }`).                   |
| `GET /api/projects/:slug`                                        | Full project bundle (`project`, `rawAnalysis`, decorated `storyboard`, `motionPresets`, `layoutArchetypes`, `jobs`, `tickets`, `agentCrew`). |
| `POST /api/projects/:slug/activate`                              | Set `CURRENT_PROJECT.json` active project slug.                                                                                              |
| `POST /api/projects/:slug/brief`                                 | Merge updates into `PROJECT_BRIEF.json` and regenerate `AI_READY_PROMPT.md`.                                                                 |
| `POST /api/projects/:slug/upload`                                | Binary stream upload (`?category=raw-video\|inspiration\|references\|images\|brand\|audio&filename=...`).                                    |
| `POST /api/projects/:slug/ingest-url`                            | Download media via `yt-dlp`/direct fetch or record reference link.                                                                           |
| `POST /api/projects/:slug/import-root-file`                      | Non-destructively copy (or move) a loose workspace video into the project.                                                                   |
| `POST /api/projects/:slug/scan-folder`                           | Scan any local disk folder (e.g. CapCut/OBS exports) without modifying source files.                                                         |
| `POST /api/projects/:slug/import-folder`                         | Copy selected files from an external folder into `inbox/<category>/`.                                                                        |
| `DELETE /api/projects/:slug/file`                                | Confined deletion inside `inbox/`, `assets/`, `output/`, or `renders/`.                                                                      |
| `DELETE /api/projects/:slug/reference-link`                      | Remove a saved reference URL from `PROJECT_BRIEF.json`.                                                                                      |
| `POST /api/projects/:slug/tts`                                   | Synthesize neural voiceover MP3 locally via `edge-tts`.                                                                                      |
| `POST /api/projects/:slug/analyze-raw`                           | Run OpenCV scene cut & motion-peak keyframe extraction (`scene_XX_{start,peak,end}.png`).                                                    |
| `POST /api/projects/:slug/analyze-inspiration`                   | Measure cut rhythm (`avgShotLength`, `cutsPerMinute`, `pacing`) & 5 quantized style swatches.                                                |
| `POST /api/projects/:slug/extract-brand`                         | Extract brand colors, typography & guidelines from uploaded logo/PDF/brief text.                                                             |
| `GET /api/projects/:slug/storyboard`                             | Load decorated `STORYBOARD.json` with `/media/:slug/...` URLs.                                                                               |
| `POST /api/projects/:slug/storyboard/generate`                   | Generate 1080p Clean + Blueprint HUD PNGs across scenes (honoring `preserveLocked` & active `selectedSkills`).                               |
| `POST /api/projects/:slug/storyboard/frames/:frameId/regenerate` | Regenerate a shot (`vN -> vN+1`) from natural-language prompt/layout/preset overrides.                                                       |
| `PATCH /api/projects/:slug/storyboard/frames/:frameId`           | Lock/approve, fine-tune copy/camera/timing, or restore any historical version (`{ revertToVersion }`).                                       |
| `POST /api/projects/:slug/storyboard/approve-all`                | Approve and lock all storyboard frames in one click.                                                                                         |
| `GET` / `POST /api/projects/:slug/agent-queue`                   | List or enqueue `$0`-guarded 6-Agent tasks (`tickets.json`).                                                                                 |
| `POST /api/projects/:slug/action`                                | Run `npx hyperframes` `lint`, `check`, `render-draft`, or `render-final` background job.                                                     |
| `POST /api/projects/:slug/generate-video`                        | Start the 5-stage `video-compiler.mjs` job (`202 Accepted` + live SSE progress).                                                             |
| `GET /api/jobs/:jobId`                                           | Poll background compilation or HyperFrames CLI job status & console log.                                                                     |
| `GET /media/:slug/*`                                             | Path-confined HTTP Range (`206 Partial Content`) media server for project videos, PNGs & audio.                                              |

### Pro Specialist Routes (`routes-pro.mjs`)

| Method & Path                                     | Purpose                                                                                                             |
| :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------ |
| `GET /api/catalog/presets`                        | Returns camera bodies, lenses, apertures, 24 camera presets, 10 color looks, caption styles, 12 SFX & 8 archetypes. |
| `POST /api/projects/:slug/preview-sfx`            | Synthesizes/previews a procedural WAV sound effect (`cinema-whoosh`, `ui-pop`, etc.).                               |
| `POST /api/projects/:slug/color-grade`            | Applies an FFmpeg cinema color look to a frame or video clip.                                                       |
| `POST /api/projects/:slug/captions/generate`      | Generates word-timed HyperFrames `<template>` caption sub-compositions.                                             |
| `POST /api/projects/:slug/google-multimodal-plan` | Generates `$0` Antigravity Google Images + Google Flow shot execution manifest.                                     |

### V2 Skills, Rating, Canvas Inpaint & Vault Routes (`routes-v2.mjs`)

| Method & Path                                                           | Purpose                                                                                                      |
| :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| `GET /api/skills` (`?slug=`)                                            | Dynamically discovers local `SKILL.md` packs across workspace, project & `~/.gemini/config/skills`.          |
| `POST /api/skills/install`                                              | Installs a local skill from library, local folder path, or custom authored Markdown.                         |
| `POST /api/projects/:slug/skills`                                       | Persists `selectedSkills` (`.studio/selected-skills.json` + `AI_READY_PROMPT.md`) & compiles `stagingHints`. |
| `GET` / `POST /api/projects/:slug/rating`                               | Computes deterministic `0–100` (`S`..`C`) Whole-Video Quality Rating + per-frame `suggestedFixPrompt`s.      |
| `POST /api/projects/:slug/storyboard/frames/:frameId/regenerate-region` | `15MB` base64 `maskDataUrl` + `compositeDataUrl` + `strokes` surgical zone regeneration (`vN+1` PNG).        |
| `GET` / `POST /api/projects/:slug/saved-frames`                         | List or bookmark permanent PNG snapshots into `.studio/frames/saved/`.                                       |
| `DELETE /api/projects/:slug/saved-frames/:savedId`                      | Remove a bookmarked snapshot from the Saved Frames Vault.                                                    |

### V3 Voice/Lip-Sync, Whiteboard, Ad Analytics & PM Routes (`routes-v3.mjs`)

| Method & Path                                              | Purpose                                                                                                                                                      |
| :--------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/voices` (`?lang=Bengali\|English\|Hindi`)        | Returns the 10-voice multilingual `VOICE_CATALOG` (`voices` + grouped `catalog`).                                                                            |
| `POST /api/projects/:slug/voice-sync`                      | Runs `original-sync` (extract + silence-trim real speaker audio) or `ai-voice-lipsync` (Edge-TTS + 30fps `visemeEnvelope` + OpenCV character `setpts` sync). |
| `GET` / `POST /api/projects/:slug/whiteboard`              | Loads or saves spatial node-whiteboard graph (`.studio/whiteboard.json`).                                                                                    |
| `POST /api/projects/:slug/whiteboard/compile-scene`        | Stitches connected footage + note nodes via FFmpeg (`concat`/`xfade`) into `assets/clips/wb_scene_<id>.mp4` & renders 1080p storyboard frame.                |
| `GET` / `POST /api/projects/:slug/ad-analytics`            | Evaluates `thumbstopHookScore`, `retentionCurve`, `dropOffRisks`, `soundOffScore`, TikTok/Reels/Shorts safe zones & 3 A/B `hookVariants`.                    |
| `POST /api/projects/:slug/inspiration/rea-decompose`       | Runs deep `rea-video` shot-by-shot animation, production-mix, camera-move & packaging decomposition (`VIDEO.md`, `storyboard.jpg`, `report.html`).           |
| `POST /api/projects/:slug/inspiration/apply-to-storyboard` | Applies `rea-video` inspiration shot presets, pacing, archetypes & motion vectors onto unlocked `STORYBOARD.json` frames.                                    |
| `GET /api/pm-insights`                                     | Serves continuous PM research insights from `studio-hub/docs/pm-insights.json`.                                                                              |

### V4 Power-Tools, Batch Localization & Skill Bundle Routes (`routes-v4.mjs`)

| Method & Path                                  | Purpose                                                                                                                                           |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/projects/:slug/beat-quantize`       | Snaps `STORYBOARD.json` scene cuts (`0`–`4` frames) & kinetic text staggers to BGM/VO transient beats (`maxDriftMs <= 140`).                      |
| `POST /api/projects/:slug/subject-matte`       | Extracts local RGBA speaker foreground matte (`*_matte.png`) via OpenCV GrabCut for Depth-of-Text behind-speaker typography.                      |
| `POST /api/projects/:slug/smart-reframe`       | Computes face/focal-aware multi-aspect (`9:16`, `1:1`, `4:5`, `16:9`) crop rectangles and optionally renders FFmpeg reframed clips.               |
| `POST /api/projects/:slug/subtitles-export`    | Exports broadcast-valid `.srt`, `.vtt`, and styled karaoke `.ass` sidecar subtitles into `output/`.                                               |
| `POST /api/projects/:slug/thumbnails-generate` | Generates 3 High-CTR A/B/C PNG cover thumbnails (`shock-stat`, `versus-split`, `curiosity-gap`) in `output/thumbnails/`.                          |
| `POST /api/projects/:slug/localized-variants`  | Builds multi-language (`en`, `bn`, `hi`) x multi-aspect (`9:16`, `1:1`, `16:9`) localized HyperFrames composition variants in `output/variants/`. |
| `POST /api/skill-bundles/export`               | Exports portable `.studio-skill.json` preset bundle (active `SKILL.md` packs, brand palette, color look & camera rig).                            |
| `POST /api/skill-bundles/import`               | Imports a `.studio-skill.json` bundle locally (`projects/<slug>/skills/<id>/SKILL.md` + active skill/brand selection).                            |

---

## Automated Test Suite (`35` Suites)

Run all suites with `node --test studio-hub/tests/*.test.mjs` or run any single suite directly (e.g. `node --test studio-hub/tests/v2-v3-release-gate.test.mjs`):

1. `ad-analytics.test.mjs` — 3s hook scoring, retention curve, safe zones & 1-click A/B hook boost
2. `beat-quantizer.test.mjs` — Music BPM/onset beat grid cut snapping & kinetic text stagger alignment
3. `camera-rigs.test.mjs` — DoP camera bodies, lenses, apertures & 24 GSAP camera presets
4. `captions-engine.test.mjs` — Word-level alignment & HyperFrames caption sub-compositions
5. `color-grade.test.mjs` — 10 cinema FFmpeg color looks & graded frame output
6. `delta-cache.test.mjs` — SHA-256 per-scene content-addressable cache hit/miss & invalidation
7. `frame-inpaint.test.mjs` — Stroke/arrow zone classification, PNG mask decoding, regional regen & vault CRUD
8. `google-flow.test.mjs` — `$0` Google Images + Google Flow shot manifest builder
9. `local-batch-runner.test.mjs` — Multi-language (`en`/`bn`/`hi`) x multi-aspect localized HyperFrames variant builder
10. `media-ingest.test.mjs` — `lib.mjs` manifest sync, external folder scan/import & `media_intelligence.py`
11. `pack-behind-speaker.test.mjs` — Depth-of-Text behind-speaker & parallax 3-layer sandwich scene templates
12. `pack-cinema-statement.test.mjs` — Fullbleed cinema & kinetic statement scene templates
13. `pack-device-spotlight.test.mjs` — 3D device showcase & cursor spotlight scene templates
14. `pack-editorial-bento.test.mjs` — Split editorial & bento feature grid scene templates
15. `pack-social-hooks.test.mjs` — Viral hook question & proof-quote card scene templates
16. `pack-wipe-metrics.test.mjs` — Before/after wipe & metric counter wall scene templates
17. `rea-inspiration.test.mjs` — `JuneYaooo/rea-video` shot-by-shot animation/style decomposition & storyboard style transfer
18. `routes-pro.test.mjs` — Pro HTTP catalog & specialist utility endpoints
19. `routes-v2.test.mjs` — V2 HTTP skills, rating, `>3MB` base64 regional canvas regen & traversal guards
20. `routes-v3.test.mjs` — V3 HTTP voices, voice-sync, whiteboard compile, ad analytics, `rea-video` & PM insights
21. `routes-v4.test.mjs` — V4 HTTP beat-quantize, subject-matte, smart-reframe, subtitles, A/B thumbnails, batch & skill bundles
22. `server-e2e.test.mjs` — Full `createStudioHttpServer()` lifecycle, upload, SSE & `$0` guard E2E
23. `skill-bundles.test.mjs` — Portable `.studio-skill.json` preset pack export/import round-trip
24. `skills-registry.test.mjs` — Dynamic 4-scope `SKILL.md` discovery (incl. `.agents/skills/rea-video`), local install & directive compiler
25. `smart-reframe.test.mjs` — Face/focal-aware multi-aspect (`9:16`, `1:1`, `4:5`, `16:9`) crop planner & FFmpeg renderer
26. `sound-engine.test.mjs` — Procedural WAV SFX synthesis, beat detection & ducked audio mix
27. `storyboard.test.mjs` — 1080p Clean + HUD Headless Chrome PNG rendering, locking & version history
28. `subject-matte.test.mjs` — Local OpenCV GrabCut RGBA speaker foreground matte extraction
29. `subtitle-exporter.test.mjs` — Broadcast-valid `.srt`, `.vtt` & styled karaoke `.ass` sidecar export
30. `thumbnail-ab-gen.test.mjs` — 3-variant High-CTR A/B/C YouTube/Reels PNG cover generator
31. `v2-v3-release-gate.test.mjs` — Live Headless Chromium React 19 UI smoke + full V2/V3/V4 HTTP release gate
32. `video-compiler.test.mjs` — 5-stage clip slicing, audio mix, GSAP scene assembly, delta cache & `hyperframes lint/check`
33. `video-rating.test.mjs` — Deterministic 6-category video rating, WCAG contrast & 1-click fix loop
34. `voice-lipsync.test.mjs` — Multilingual neural voices, original speech sync, OpenCV face detect & lip-sync
35. `whiteboard-graph.test.mjs` — Whiteboard graph normalization, silence trim, `concat`/`xfade` & frame injection
