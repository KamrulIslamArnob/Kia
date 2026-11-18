"""
Director Studio Pro — 6-Agent Zero-Cost Production Crew Workflow
Executed via Antigravity `run_workflow(ScriptPath=".../studio-hub/workflows/director_crew.py", Args={...})`.

Runs entirely on the user's included Antigravity subscription (`gemini-4-carbon-high` via `model="inherit"`),
using local FFmpeg / edge-tts / faster-whisper tools, Antigravity `image-generator` (Google Images plates),
and Antigravity `browser` on Google Flow (`https://labs.google/fx/tools/flow`).
"""

import asyncio
import json
import threading


async def run_director_crew(raw_args=None):
    workflow_args = raw_args if isinstance(raw_args, dict) else (globals().get("args") or {})
    slug = str(workflow_args.get("slug") or "").strip()
    ticket_id = str(workflow_args.get("ticketId") or "").strip()
    quality = str(workflow_args.get("quality") or "draft").strip()
    global_prompt = str(workflow_args.get("prompt") or "").strip()
    use_google_flow = bool(workflow_args.get("useGoogleFlow", False))

    if not slug:
        phase("Resolve Active Project")
        slug_info = await agent(
            (
                "Read `CURRENT_PROJECT.json` (or run `node studio-hub/agent-bridge.mjs --list-pending`) "
                "and return the active Studio Hub project slug."
            ),
            schema={
                "type": "object",
                "properties": {
                    "slug": {"type": "string"},
                    "ticketId": {"type": "string"},
                },
                "required": ["slug"],
            },
            role="Project Resolver",
            workspace="inherit",
            model="inherit",
        )
        slug = slug_info["slug"]
        if not ticket_id and slug_info.get("ticketId"):
            ticket_id = slug_info["ticketId"]

    log(f"Starting Director Studio Pro 6-Agent Crew for project '{slug}' (quality={quality})")

    # ─────────────────────────────────────────────────────────────────────────
    # Phase 1: Brand & Media Intelligence (`brand-analyst`)
    # ─────────────────────────────────────────────────────────────────────────
    phase("Phase 1 · Brand & Media Intelligence")

    claim_line = (
        f"and claim ticket `{ticket_id}` if pending: "
        f"`node studio-hub/agent-bridge.mjs --claim {slug} {ticket_id} brand-analyst`"
        if ticket_id
        else ""
    )

    brand_intel = await agent(
        f"""Brand Analyst (`brand-analyst`) for project `{slug}`.
1. Broadcast live status:
   `node studio-hub/agent-bridge.mjs --agent-status brand-analyst working "Analyzing raw media, inspiration pacing, and brand palette"`
   {claim_line}
2. Inspect `projects/{slug}/PROJECT_BRIEF.json`.
3. Run `python studio-hub/media_intelligence.py` on any raw videos (`analyze-raw`), inspiration clips (`analyze-inspiration`), and brand logos/docs (`extract-brand`) present in `projects/{slug}/inbox/`.
4. Persist extracted brand palette & pacing via `syncProjectManifest` if new media was analyzed, then set status:
   `node studio-hub/agent-bridge.mjs --agent-status brand-analyst done "Brand palette & scene keyframes ready"`
5. Return a concise JSON summary of the brand palette, pacing, and detected scene count.""",
        schema={
            "type": "object",
            "properties": {
                "sceneCount": {"type": "number"},
                "pacing": {"type": "string"},
                "primaryColor": {"type": "string"},
                "summary": {"type": "string"},
            },
            "required": ["sceneCount", "pacing", "summary"],
        },
        role="brand-analyst",
        workspace="inherit",
        model="inherit",
    )
    log(f"[brand-analyst] {brand_intel['summary']} (pacing={brand_intel['pacing']})")

    # ─────────────────────────────────────────────────────────────────────────
    # Phase 2: Shot & Motion Storyboard (`storyboard-director`)
    # ─────────────────────────────────────────────────────────────────────────
    phase("Phase 2 · Higgsfield Shot & Motion Storyboard")

    storyboard_plan = await agent(
        f"""Storyboard Director (`storyboard-director`) for project `{slug}`.
Context from brand-analyst: {json.dumps(brand_intel)}
Creative direction override: {json.dumps(global_prompt or "Follow PROJECT_BRIEF.json instructions")}

1. Broadcast live status:
   `node studio-hub/agent-bridge.mjs --agent-status storyboard-director working "Staging shots, camera presets, and speed ramps"`
2. Use `studio-hub/storyboard.mjs` (`generateStoryboard` / `loadStoryboard`) to build or refine `projects/{slug}/STORYBOARD.json`, strictly preserving any frames with `locked: true`.
3. Ensure every unlocked shot has a fitting layout archetype (`device-3d-showcase`, `split-editorial`, `fullbleed-cinema`, `bento-feature-grid`, `spotlight-cursor-zoom`, or `kinetic-statement-card`), concrete camera parameters, speed ramp, and concise `audioSpec.voiceoverText`.
4. Set status:
   `node studio-hub/agent-bridge.mjs --agent-status storyboard-director done "Storyboard locked and clean/HUD frames rendered"`
5. Return the list of frame IDs and whether any shot requests generative plates or Google Flow B-roll.""",
        schema={
            "type": "object",
            "properties": {
                "frameIds": {"type": "array", "items": {"type": "string"}},
                "needsImagePlates": {"type": "boolean"},
                "needsGoogleFlowClips": {"type": "boolean"},
                "totalDuration": {"type": "number"},
            },
            "required": ["frameIds", "totalDuration"],
        },
        role="storyboard-director",
        workspace="inherit",
        model="inherit",
    )
    log(
        f"[storyboard-director] Staged {len(storyboard_plan['frameIds'])} shots "
        f"({storyboard_plan['totalDuration']}s)"
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Phase 3: Parallel Visual, Generative Video & Audio Production
    # (`frame-designer` + `google-flow-video` + `audio-director`)
    # ─────────────────────────────────────────────────────────────────────────
    phase("Phase 3 · Parallel Asset & Audio Direction")

    parallel_tracks = [
        {
            "id": "frame-designer",
            "prompt": f"""Frame Designer (`frame-designer`) for project `{slug}`.
1. Broadcast status:
   `node studio-hub/agent-bridge.mjs --agent-status frame-designer working "Designing 1080p plates & verifying frame compositions"`
2. Inspect `projects/{slug}/STORYBOARD.json`. For any unlocked shot requesting `aiBackgroundPlate` (or missing visual plates when no raw video exists), generate high-craft 1080p background plates into `projects/{slug}/assets/images/` using Antigravity's built-in image generation / Google Images visual reference workflow ($0 subscription, never paid external APIs).
3. Ensure clean + HUD design PNGs in `projects/{slug}/.studio/frames/design/` are up to date.
4. Set status:
   `node studio-hub/agent-bridge.mjs --agent-status frame-designer done "Design plates verified"`
Return a short status summary.""",
        },
        {
            "id": "google-flow-video",
            "prompt": f"""Google Flow Video Specialist (`google-flow-video`) for project `{slug}`.
Google Flow requested: {use_google_flow or bool(storyboard_plan.get("needsGoogleFlowClips"))}
1. Broadcast status:
   `node studio-hub/agent-bridge.mjs --agent-status google-flow-video working "Preparing motion clips"`
2. If Google Flow generative B-roll is requested for specific shots in `projects/{slug}/STORYBOARD.json`:
   - Open `https://labs.google/fx/tools/flow` via the Antigravity `browser` tool.
   - IMPORTANT: Never bypass authentication or CAPTCHA gates; if sign-in is required, pause and report cleanly so the user can sign in visibly.
   - Generate and download approved clips into `projects/{slug}/assets/clips/`.
   Otherwise, verify local raw source clips referenced in `STORYBOARD.json` are ready for FFmpeg slicing.
3. Set status:
   `node studio-hub/agent-bridge.mjs --agent-status google-flow-video done "Motion clips ready"`
Return a short status summary.""",
        },
        {
            "id": "audio-director",
            "prompt": f"""Audio Director (`audio-director`) for project `{slug}`.
1. Broadcast status:
   `node studio-hub/agent-bridge.mjs --agent-status audio-director working "Auditing edge-tts voiceover timing, Whisper transcripts & SFX cues"`
2. Review `projects/{slug}/STORYBOARD.json` `audioSpec` entries so every shot's `voiceoverText` fits comfortably inside `Math.max(1.2, durationSeconds - 0.25)` seconds and SFX cues (`whoosh`, `pop`, `chime`) match on-screen actions without crowding.
3. Set status:
   `node studio-hub/agent-bridge.mjs --agent-status audio-director done "Voiceover & SFX timing calibrated"`
Return a short status summary.""",
        },
    ]

    track_results = await parallel(
        parallel_tracks,
        lambda item: agent(
            item["prompt"],
            schema={
                "type": "object",
                "properties": {
                    "agent": {"type": "string"},
                    "summary": {"type": "string"},
                },
                "required": ["summary"],
            },
            role=item["id"],
            workspace="inherit",
            model="inherit",
        ),
    )

    for item, res in zip(parallel_tracks, track_results):
        log(f"[{item['id']}] {res['summary']}")

    # ─────────────────────────────────────────────────────────────────────────
    # Phase 4: HyperFrames Compilation, Browser Gate & Render (`hyperframes-qa`)
    # ─────────────────────────────────────────────────────────────────────────
    phase("Phase 4 · HyperFrames Compilation, Browser Check Gate & MP4 Render")

    complete_line = (
        f'and complete ticket `{ticket_id}`: '
        f'`node studio-hub/agent-bridge.mjs --complete {slug} {ticket_id} '
        f'"{{\\"ok\\":true,\\"outputRelPath\\":\\"output/{slug}_{quality}.mp4\\"}}"`'
        if ticket_id
        else ""
    )

    final_delivery = await agent(
        f"""HyperFrames QA & Compiler (`hyperframes-qa`) for project `{slug}` (quality=`{quality}`).
1. Broadcast status:
   `node studio-hub/agent-bridge.mjs --agent-status hyperframes-qa working "Compiling sub-compositions, running check gate & rendering MP4"`
2. Execute `compileProjectVideo` from `studio-hub/video-compiler.mjs` for slug `{slug}` with `quality: "{quality}"`.
3. Verify `npx hyperframes lint .` and `npx hyperframes check --json .` in `projects/{slug}` report **0 errors** across lint, runtime, layout, motion, and WCAG contrast. If any error occurs, fix the composition and re-run `npx hyperframes check --json .` until 0 errors.
4. Confirm rendered MP4 exists at `projects/{slug}/output/{slug}_{quality}.mp4` and has valid video + audio streams via `ffprobe`.
5. Broadcast completion:
   `node studio-hub/agent-bridge.mjs --agent-status hyperframes-qa done "MP4 verified & delivered"`
   {complete_line}
6. Return final delivery report.""",
        schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "outputRelPath": {"type": "string"},
                "durationSeconds": {"type": "number"},
                "checkErrors": {"type": "number"},
            },
            "required": ["ok", "outputRelPath", "checkErrors"],
        },
        role="hyperframes-qa",
        workspace="inherit",
        model="inherit",
    )

    log(
        f"[hyperframes-qa] Delivered {final_delivery['outputRelPath']} "
        f"(checkErrors={final_delivery['checkErrors']})"
    )
    summary_payload = {"ok": True, "slug": slug, "delivery": final_delivery}
    print(json.dumps(summary_payload, indent=2))
    return summary_payload


def _execute_workflow_entrypoint():
    box = {}

    def _thread_target():
        try:
            box["result"] = asyncio.run(run_director_crew())
        except BaseException as exc:  # noqa: BLE001
            box["error"] = exc

    worker = threading.Thread(target=_thread_target, name="director-crew-runner")
    worker.start()
    worker.join()
    if "error" in box:
        raise box["error"]
    return box.get("result")


if callable(globals().get("phase")) and __name__ != "director_crew":
    _execute_workflow_entrypoint()
