"""
Google Multimodal Crew — $0 Subscription Orchestrator Workflow
Executed via Antigravity `run_workflow(ScriptPath=".../studio-hub/workflows/google_media_crew.py", Args={"slug": "..."})`.

Bridges `STORYBOARD.json` + `.studio/google-multimodal-plan.json` across:
- Antigravity `image-generator` (`type_name="image-generator"`) for brand-matched 1080p AI plates
- Antigravity `self` (`type_name="self"`) for per-shot HyperFrames sub-composition & Google Flow updates
Strictly enforces `costMode == "subscription-zero-dollar"` with zero paid external API keys.
"""

import asyncio
import json
import os
import re
import subprocess
import threading

SLUG_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")


def _resolve_workspace_root():
    workspaces = globals().get("WORKSPACES")
    if workspaces and len(workspaces) > 0 and workspaces[0]:
        return os.path.abspath(str(workspaces[0]))
    return os.path.abspath(os.getcwd())


def _validate_slug(slug_value):
    cleaned = str(slug_value or "").strip()
    if not cleaned or not SLUG_PATTERN.match(cleaned):
        raise ValueError(f"Invalid Studio Hub project slug: {slug_value!r}")
    return cleaned


def _read_json_file(file_path):
    if not os.path.isfile(file_path):
        return None
    with open(file_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _ensure_multimodal_plan_on_disk(root_dir, slug):
    plan_path = os.path.join(root_dir, "projects", slug, ".studio", "google-multimodal-plan.json")
    if os.path.isfile(plan_path):
        return _read_json_file(plan_path)

    js_code = (
        "import { generateGoogleMultimodalPlan } from './studio-hub/google-flow-playbook.mjs';"
        f"generateGoogleMultimodalPlan({{ slug: {json.dumps(slug)}, enqueueTickets: false }});"
    )
    subprocess.run(
        ["node", "--input-type=module", "-e", js_code],
        cwd=root_dir,
        check=True,
        capture_output=True,
        text=True,
    )
    return _read_json_file(plan_path)


def _select_unlocked_targets(storyboard, plan, include_all_unlocked=False):
    sb_frames = storyboard.get("frames") if isinstance(storyboard, dict) else []
    if not isinstance(sb_frames, list):
        sb_frames = []

    frame_by_id = {}
    for idx, frame in enumerate(sb_frames):
        if isinstance(frame, dict):
            fid = str(frame.get("id") or f"frame_{idx + 1:02d}")
            frame_by_id[fid] = frame

    plan_shots = plan.get("shots") if isinstance(plan, dict) else []
    if not isinstance(plan_shots, list):
        plan_shots = []

    plate_shots = []
    composition_shots = []

    for shot_entry in plan_shots:
        if not isinstance(shot_entry, dict):
            continue
        shot_id = str(shot_entry.get("shotId") or shot_entry.get("id") or "").strip()
        if not shot_id:
            continue
        sb_frame = frame_by_id.get(shot_id, {})
        is_locked = bool(shot_entry.get("locked") or sb_frame.get("locked"))
        if is_locked:
            continue

        merged = {
            "shotId": shot_id,
            "sceneId": str(
                shot_entry.get("sceneId")
                or sb_frame.get("sceneId")
                or shot_id.replace("frame_", "scene_")
            ),
            "title": str(shot_entry.get("title") or sb_frame.get("title") or shot_id),
            "layout": str(sb_frame.get("layout") or "device-3d-showcase"),
            "durationSeconds": float(sb_frame.get("durationSeconds") or 4.0),
            "needsImagePlate": bool(shot_entry.get("needsImagePlate") or include_all_unlocked),
            "needsGoogleFlowVideo": bool(shot_entry.get("needsGoogleFlowVideo")),
            "needsAudio": bool(shot_entry.get("needsAudio")),
            "imageGeneratorBrief": shot_entry.get("imageGeneratorBrief") or {},
            "googleFlowBrief": shot_entry.get("googleFlowBrief") or {},
            "audioBrief": shot_entry.get("audioBrief") or {},
        }

        if merged["needsImagePlate"]:
            plate_shots.append(merged)

        if (
            merged["needsImagePlate"]
            or merged["needsGoogleFlowVideo"]
            or merged["needsAudio"]
            or include_all_unlocked
        ):
            composition_shots.append(merged)

    return plate_shots, composition_shots


def _build_plate_agent_prompt(slug, item):
    brief = item["imageGeneratorBrief"]
    shot_id = item["shotId"]
    out_rel = brief.get("outputRelPath") or f"assets/images/plate_{shot_id}.png"
    art_prompt = brief.get("prompt") or f"1080p brand background plate for {item['title']}"
    dims = brief.get("dimensions") or {"width": 1080, "height": 1920}
    neg = brief.get("negativePrompt") or "no text, no watermarks, no UI chrome"

    return (
        f"Generate AI Background Design Plate for `{slug}` · `{shot_id}` ({item['title']}).\n"
        f"- Cost Mode: subscription-zero-dollar ($0 Antigravity subscription only; never call paid external APIs).\n"
        f"- Output File: `projects/{slug}/{out_rel}` ({dims.get('width', 1080)}x{dims.get('height', 1920)} PNG).\n"
        f"- Art Direction Prompt: {art_prompt}\n"
        f"- Anti-Slop Constraints: {neg}\n"
        f"Save the generated PNG to `projects/{slug}/{out_rel}` and return completion JSON."
    )


def _build_composition_agent_prompt(slug, item, plate_map, run_google_flow=False):
    shot_id = item["shotId"]
    scene_id = item["sceneId"]
    plate_rel = plate_map.get(shot_id) or item["imageGeneratorBrief"].get(
        "outputRelPath", f"assets/images/plate_{shot_id}.png"
    )
    flow_brief = item["googleFlowBrief"]
    audio_brief = item["audioBrief"]
    flow_steps = "\n".join(flow_brief.get("browserInstructions") or [])

    flow_block = ""
    if run_google_flow and item["needsGoogleFlowVideo"]:
        flow_block = (
            f"\nOptional Google Flow Browser Direction (`{flow_brief.get('toolUrl', 'https://labs.google/fx/tools/flow')}`):\n"
            f"{flow_steps}\n"
            "IMPORTANT: Never bypass authentication, sign-in, or CAPTCHA challenges. "
            "If Google Flow requires sign-in, skip browser capture cleanly and report status.\n"
        )

    return (
        f"Update HyperFrames Shot Sub-Composition for `{slug}` · `{shot_id}` (`{scene_id}`).\n"
        f"- Own ONLY `projects/{slug}/compositions/{scene_id}.html` (and shot-scoped assets for `{shot_id}`). "
        f"Do NOT edit `STORYBOARD.json` or other shots' files concurrently.\n"
        f"- Layout Archetype: `{item['layout']}` · Duration: `{item['durationSeconds']}s`.\n"
        f"- Visual Plate: `projects/{slug}/{plate_rel}` (use relative `assets/...` path inside HTML, never leading `/`).\n"
        f"- Voiceover / Audio Brief ($0 `{audio_brief.get('ttsBackend', 'edge-tts-neural')}`): "
        f"voice `{audio_brief.get('voice', 'en-US-AriaNeural')}`, copy: {json.dumps(audio_brief.get('voiceoverText', ''))}.\n"
        f"{flow_block}"
        "- Enforce HyperFrames contract: paused GSAP timeline registered on `window.__timelines`, "
        "no CSS `transform` on GSAP targets, no `Date.now()` or `Math.random()`, WCAG AA high-contrast text.\n"
        "Verify your sub-composition and return structured JSON summary."
    )


async def run_google_media_crew(raw_args=None):
    workflow_args = raw_args if isinstance(raw_args, dict) else (globals().get("args") or {})
    root_dir = _resolve_workspace_root()
    slug = str(workflow_args.get("slug") or "").strip()
    include_all_unlocked = bool(workflow_args.get("includeAllUnlocked", False))
    run_google_flow = bool(workflow_args.get("runGoogleFlow", False))

    phase("Phase 1 · Load Storyboard & Multimodal Plan")

    if not slug:
        current_proj = _read_json_file(os.path.join(root_dir, "CURRENT_PROJECT.json")) or {}
        slug = str(current_proj.get("slug") or "").strip()

    if not slug:
        resolved = await agent(
            prompt=(
                "Read `CURRENT_PROJECT.json` and return the active Studio Hub `slug` "
                "for the Google Multimodal Crew."
            ),
            schema={
                "type": "object",
                "properties": {"slug": {"type": "string"}},
                "required": ["slug"],
            },
            role="Resolve Active Project Slug",
            type_name="self",
            workspace="inherit",
            model="inherit",
        )
        slug = str(resolved.get("slug") or "").strip()

    slug = _validate_slug(slug)
    storyboard_path = os.path.join(root_dir, "projects", slug, "STORYBOARD.json")
    storyboard = _read_json_file(storyboard_path)
    if not storyboard:
        raise FileNotFoundError(
            f"STORYBOARD.json not found at {storyboard_path}. Generate a storyboard before running google_media_crew.py."
        )

    plan = _ensure_multimodal_plan_on_disk(root_dir, slug)
    if not plan:
        raise FileNotFoundError(
            f"Multimodal plan missing at projects/{slug}/.studio/google-multimodal-plan.json"
        )

    if plan.get("costMode") != "subscription-zero-dollar" or plan.get("requiresApiKey"):
        raise RuntimeError(
            f"zeroCostGuard blocked execution: expected costMode 'subscription-zero-dollar', got {plan.get('costMode')!r}"
        )

    plate_shots, composition_shots = _select_unlocked_targets(
        storyboard, plan, include_all_unlocked=include_all_unlocked
    )
    log(
        f"[google-media-crew] Loaded STORYBOARD.json + .studio/google-multimodal-plan.json for '{slug}': "
        f"{len(plate_shots)} AI plate shot(s), {len(composition_shots)} composition shot(s) unlocked."
    )

    plate_map = {}

    if plate_shots:
        phase("Phase 2 · Parallel Google Images & AI Design Plates")
        plate_results = await parallel(
            plate_shots,
            lambda item: agent(
                prompt=_build_plate_agent_prompt(slug, item),
                schema={
                    "type": "object",
                    "properties": {
                        "shotId": {"type": "string"},
                        "plateRelPath": {"type": "string"},
                        "ok": {"type": "boolean"},
                        "summary": {"type": "string"},
                    },
                    "required": ["shotId", "plateRelPath", "ok"],
                },
                role=f"AI Plate · {item['shotId']}",
                type_name="image-generator",
                workspace="inherit",
                model="inherit",
            ),
        )
        for item, res in zip(plate_shots, plate_results):
            if isinstance(res, dict) and res.get("ok") and res.get("plateRelPath"):
                plate_map[item["shotId"]] = str(res["plateRelPath"])
            log(
                f"[image-generator:{item['shotId']}] ok={res.get('ok')} path={res.get('plateRelPath')}"
            )
    else:
        log("[google-media-crew] No unlocked shots require new AI background plates.")

    composition_results = []
    if composition_shots:
        phase("Phase 3 · Parallel Shot Composition & Multimodal Updates")
        composition_results = await parallel(
            composition_shots,
            lambda item: agent(
                prompt=_build_composition_agent_prompt(
                    slug, item, plate_map, run_google_flow=run_google_flow
                ),
                schema={
                    "type": "object",
                    "properties": {
                        "shotId": {"type": "string"},
                        "sceneId": {"type": "string"},
                        "compositionRelPath": {"type": "string"},
                        "flowClipRelPath": {"type": "string"},
                        "ok": {"type": "boolean"},
                        "summary": {"type": "string"},
                    },
                    "required": ["shotId", "ok", "summary"],
                },
                role=f"Composition · {item['shotId']}",
                type_name="self",
                workspace="inherit",
                model="inherit",
            ),
        )
        for item, res in zip(composition_shots, composition_results):
            log(f"[composition:{item['shotId']}] {res.get('summary', 'updated')}")

    phase("Phase 4 · Sync Storyboard & Complete")
    if plate_map and isinstance(storyboard.get("frames"), list):
        updated_count = 0
        for frame in storyboard["frames"]:
            if not isinstance(frame, dict) or frame.get("locked"):
                continue
            fid = str(frame.get("id") or "")
            if fid in plate_map:
                frame["aiBackgroundPlate"] = plate_map[fid]
                updated_count += 1
        if updated_count > 0:
            with open(storyboard_path, "w", encoding="utf-8") as handle:
                json.dump(storyboard, handle, indent=2)
                handle.write("\n")
            log(f"[google-media-crew] Linked {updated_count} AI plate(s) in STORYBOARD.json.")

    summary_payload = {
        "ok": True,
        "slug": slug,
        "costMode": "subscription-zero-dollar",
        "platesGenerated": len(plate_map),
        "compositionsUpdated": len(composition_results),
    }
    log(
        f"[google-media-crew] Completed '{slug}' ($0 subscription guard active): "
        f"plates={len(plate_map)}, compositions={len(composition_results)}."
    )
    print(json.dumps(summary_payload, indent=2))
    return summary_payload


def _execute_workflow_entrypoint():
    box = {}

    def _thread_target():
        try:
            box["result"] = asyncio.run(run_google_media_crew())
        except BaseException as exc:  # noqa: BLE001
            box["error"] = exc

    worker = threading.Thread(target=_thread_target, name="google-media-crew-runner")
    worker.start()
    worker.join()
    if "error" in box:
        raise box["error"]
    return box.get("result")


if callable(globals().get("phase")) and __name__ != "google_media_crew":
    _execute_workflow_entrypoint()
