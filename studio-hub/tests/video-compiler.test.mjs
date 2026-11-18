import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  CURRENT_PROJECT_FILE,
  PROJECTS_DIR,
  ROOT_DIR,
  ensureProjectDirs,
  runCommand,
  syncProjectManifest,
} from "../lib.mjs";
import {
  PROVIDER_SETTINGS_FILE,
  broadcastEvent,
  claimAgentTask,
  completeAgentTask,
  enqueueAgentTask,
  failAgentTask,
  getAgentCrewState,
  getProviderSettings,
  listAgentTasks,
  saveProviderSettings,
  setAgentStatus,
  subscribeSse,
} from "../agent-bridge.mjs";
import {
  LAYOUT_ARCHETYPES,
  buildSceneSubCompositionHtml,
  compileProjectVideo,
} from "../video-compiler.mjs";

const TEST_SLUG = "tmp-vc-tdd-suite";
const TEST_PROJECT_DIR = path.join(PROJECTS_DIR, TEST_SLUG);
const CREW_STATE_FILE = path.join(ROOT_DIR, ".hyperframes", "agent-crew-state.json");

function snapshotOptionalFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function restoreOptionalFile(filePath, snapshot) {
  if (snapshot === null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, snapshot);
  }
}

test("Director Studio Pro — agent-bridge, zero-cost guard, workflow & video-compiler E2E", async (t) => {
  const prevCurrentProject = snapshotOptionalFile(CURRENT_PROJECT_FILE);
  const prevProviderSettings = snapshotOptionalFile(PROVIDER_SETTINGS_FILE);
  const prevCrewState = snapshotOptionalFile(CREW_STATE_FILE);

  t.after(async () => {
    if (fs.existsSync(TEST_PROJECT_DIR)) {
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          await fs.promises.rm(TEST_PROJECT_DIR, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
          });
          break;
        } catch (err) {
          if (attempt === 14) throw err;
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    }
    restoreOptionalFile(CURRENT_PROJECT_FILE, prevCurrentProject);
    restoreOptionalFile(PROVIDER_SETTINGS_FILE, prevProviderSettings);
    restoreOptionalFile(CREW_STATE_FILE, prevCrewState);
  });

  await t.test("Zero-Cost Subscription Guard enforces $0 defaults and blocks paid modes", () => {
    if (fs.existsSync(PROVIDER_SETTINGS_FILE)) {
      fs.unlinkSync(PROVIDER_SETTINGS_FILE);
    }

    const defaults = getProviderSettings();
    assert.equal(defaults.providerMode, "antigravity-subscription");
    assert.equal(defaults.model, "gemini-4-carbon-high");
    assert.equal(defaults.zeroCostGuard, true);
    assert.equal(defaults.imageBackend, "antigravity-image-generator");
    assert.equal(defaults.videoBackend, "google-flow-browser");
    assert.equal(defaults.audioBackend, "edge-tts-neural");
    assert.equal(defaults.allowFreeTierApiKey, false);

    assert.throws(
      () => saveProviderSettings({ providerMode: "paid-openai-api" }),
      /zeroCostGuard/i,
    );
    assert.throws(
      () => saveProviderSettings({ imageBackend: "paid-cloud-diffusion" }),
      /zeroCostGuard/i,
    );

    const updated = saveProviderSettings({ allowFreeTierApiKey: true });
    assert.equal(updated.zeroCostGuard, true);
    assert.equal(updated.allowFreeTierApiKey, true);
    assert.ok(fs.existsSync(PROVIDER_SETTINGS_FILE));
  });

  await t.test("6-Agent Crew state, SSE stream & Persistent Ticket Queue lifecycle", async () => {
    ensureProjectDirs(TEST_SLUG);

    const crewInitial = getAgentCrewState();
    const expectedIds = [
      "brand-analyst",
      "storyboard-director",
      "frame-designer",
      "google-flow-video",
      "audio-director",
      "hyperframes-qa",
    ];
    assert.deepEqual(
      crewInitial.agents.map((a) => a.id),
      expectedIds,
    );

    // Mock HTTP req/res for SSE verification
    const reqStream = new PassThrough();
    const resChunks = [];
    let statusCode = 0;
    let headers = {};
    const mockRes = {
      writeHead(code, hdrs) {
        statusCode = code;
        headers = hdrs;
      },
      write(chunk) {
        resChunks.push(String(chunk));
        return true;
      },
      on() {},
    };

    const unsubscribe = subscribeSse(reqStream, mockRes);
    assert.equal(statusCode, 200);
    assert.match(String(headers["Content-Type"]), /text\/event-stream/i);

    const updatedAgent = setAgentStatus(
      "frame-designer",
      "working",
      "Generating clean plate via image-generator",
      { frameId: "frame_01" },
    );
    assert.equal(updatedAgent.status, "working");

    broadcastEvent("custom-ping", { hello: "studio" });
    unsubscribe();
    reqStream.destroy();

    const combinedSse = resChunks.join("");
    assert.match(combinedSse, /event: connected/);
    assert.match(combinedSse, /event: agent-status/);
    assert.match(combinedSse, /event: custom-ping/);

    // Persistent Ticket Queue lifecycle
    const t1 = enqueueAgentTask({
      slug: TEST_SLUG,
      type: "ai_storyboard_direct",
      payload: { targetScenes: 2 },
    });
    const t2 = enqueueAgentTask({
      slug: TEST_SLUG,
      type: "ai_google_flow_video",
      payload: { prompt: "Macro emerald leaf dewdrop" },
    });

    const ticketsPath = path.join(TEST_PROJECT_DIR, ".studio", "agent-queue", "tickets.json");
    assert.ok(fs.existsSync(ticketsPath), "tickets.json should persist on disk");

    const pending = listAgentTasks(TEST_SLUG, { status: "pending" });
    assert.equal(pending.length, 2);

    // Verify CLI --list-pending works cleanly
    const cliRes = await runCommand(
      "node",
      ["studio-hub/agent-bridge.mjs", "--list-pending", "--slug", TEST_SLUG],
      { cwd: ROOT_DIR, shell: false },
    );
    assert.equal(cliRes.code, 0, cliRes.stderr);
    const cliParsed = JSON.parse(cliRes.stdout);
    assert.equal(cliParsed.tickets.length, 2);

    const claimed = claimAgentTask(TEST_SLUG, t1.id, "storyboard-director");
    assert.equal(claimed.status, "in_progress");
    assert.equal(claimed.claimedBy, "storyboard-director");

    const done = completeAgentTask(TEST_SLUG, t1.id, { storyboardSaved: true });
    assert.equal(done.status, "completed");
    assert.deepEqual(done.result, { storyboardSaved: true });

    claimAgentTask(TEST_SLUG, t2.id, "google-flow-video");
    const failed = failAgentTask(TEST_SLUG, t2.id, "Browser tab closed by user");
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /Browser tab closed/);

    assert.equal(listAgentTasks(TEST_SLUG, { status: "completed" }).length, 1);
    assert.equal(listAgentTasks(TEST_SLUG, { status: "failed" }).length, 1);
  });

  await t.test("All 6 layout archetypes generate deterministic, HyperFrames-safe HTML", () => {
    assert.deepEqual(LAYOUT_ARCHETYPES, [
      "device-3d-showcase",
      "split-editorial",
      "fullbleed-cinema",
      "bento-feature-grid",
      "spotlight-cursor-zoom",
      "kinetic-statement-card",
    ]);

    for (const [idx, layout] of LAYOUT_ARCHETYPES.entries()) {
      const sceneId = `scene_0${idx + 1}`;
      const html = buildSceneSubCompositionHtml({
        sceneId,
        width: 1080,
        height: 1920,
        frame: {
          id: `frame_0${idx + 1}`,
          title: `Archetype ${layout}`,
          durationSeconds: 3,
          layout,
          badge: "PRO STUDIO",
          headline: `Crafted ${layout}`,
          subheadline: "Deterministic GSAP camera motion with WCAG contrast.",
          caption: "High-precision motion graphics compiled cleanly.",
          clipRelPath: "assets/clips/shot_frame_01.mp4",
          camera: {
            fromScale: 1,
            toScale: 1.08,
            panX: -12,
            panY: -8,
            tiltDeg: 4,
            focusX: 0.55,
            focusY: 0.45,
            ease: "power2.out",
          },
        },
        brandColors: {
          primary: "#1E824C",
          secondary: "#2ECC71",
          accent: "#F1C40F",
          background: "#0A1612",
        },
        captionsMode: "kinetic",
      });

      assert.match(html, new RegExp(`<template id="${sceneId}-template">`));
      assert.match(html, new RegExp(`data-composition-id="${sceneId}"`));
      assert.match(html, new RegExp(`window\\.__timelines\\["${sceneId}"\\]`));
      assert.doesNotMatch(html, /Date\.now\s*\(/);
      assert.doesNotMatch(html, /Math\.random\s*\(/);
      if (layout === "kinetic-statement-card") {
        assert.match(html, /object-position:\s*50%\s+25%/);
      }
    }
  });

  await t.test(
    "End-to-end 2-scene compileProjectVideo slices clips, mixes VO+SFX+BGM, passes lint + check with 0 errors, and renders MP4",
    async () => {
      ensureProjectDirs(TEST_SLUG);
      const rawVideoPath = path.join(TEST_PROJECT_DIR, "inbox", "raw-video", "synthetic_raw.mp4");

      const genRes = await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=720x1280:rate=30:duration=5",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          rawVideoPath,
        ],
        { cwd: ROOT_DIR, shell: false },
      );
      assert.equal(genRes.code, 0, `Synthetic raw video failed: ${genRes.stderr}`);

      const brief = await syncProjectManifest(TEST_SLUG, {
        title: "Fresh Harvest Launch",
        aspectRatio: "9:16",
        fps: 30,
        durationSeconds: 4,
        language: "English",
        brandColors: {
          primary: "#1E824C",
          secondary: "#2ECC71",
          accent: "#F1C40F",
          background: "#0A1612",
        },
      });

      const storyboard = {
        slug: TEST_SLUG,
        frames: [
          {
            id: "frame_01",
            title: "Hero App Showcase",
            layout: "device-3d-showcase",
            sourceClip: "inbox/raw-video/synthetic_raw.mp4",
            rawTimeRange: [0.2, 3.2],
            speedFactor: 1.5,
            durationSeconds: 2.0,
            staging: {
              badge: "NEW RELEASE",
              headline: "Farm To Doorstep",
              subheadline: "Fresh organic harvest in one tap.",
              camera: {
                fromScale: 0.96,
                toScale: 1.04,
                panX: 0,
                panY: -10,
                ease: "power2.out",
              },
            },
            audioSpec: {
              voiceoverText: "Fresh harvest delivered fast.",
              voice: "en-US-AriaNeural",
              sfx: ["whoosh", "pop"],
            },
          },
          {
            id: "frame_02",
            title: "Feature Grid Payoff",
            layout: "bento-feature-grid",
            sourceClip: "inbox/raw-video/synthetic_raw.mp4",
            rawTimeRange: [2.5, 4.5],
            speedFactor: 1.0,
            durationSeconds: 2.0,
            staging: {
              badge: "ZERO FEES",
              headline: "Order In Seconds",
              subheadline: "Live tracking and instant checkout.",
              camera: {
                fromScale: 1.0,
                toScale: 1.06,
                panX: -8,
                panY: 0,
                ease: "power2.out",
              },
            },
            audioSpec: {
              voiceoverText: "Order today with free delivery.",
              voice: "en-US-AriaNeural",
              sfx: ["chime"],
            },
          },
        ],
      };

      const progressStages = [];
      const result = await compileProjectVideo({
        slug: TEST_SLUG,
        storyboard,
        brief,
        settings: {
          resolution: "1080p",
          aspectRatio: "9:16",
          fps: 30,
          quality: "draft",
          captionsMode: "kinetic",
          includeVoiceover: true,
          includeBgm: true,
          bgmVolume: 0.16,
          renderVideo: true,
        },
        onProgress(evt) {
          progressStages.push(evt.stage);
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.outputRelPath, `output/${TEST_SLUG}_draft.mp4`);
      assert.ok(progressStages.includes("slice-clips"));
      assert.ok(progressStages.includes("audio-mix"));
      assert.ok(progressStages.includes("build-compositions"));
      assert.ok(progressStages.includes("validate"));
      assert.ok(progressStages.includes("render"));

      // Verify Stage 1 sliced clips
      assert.ok(fs.existsSync(path.join(TEST_PROJECT_DIR, "assets/clips/shot_frame_01.mp4")));
      assert.ok(fs.existsSync(path.join(TEST_PROJECT_DIR, "assets/clips/shot_frame_02.mp4")));

      // Verify Stage 2 master audio
      assert.ok(fs.existsSync(path.join(TEST_PROJECT_DIR, "assets/audio/compiled_master.mp3")));

      // Verify Stage 3 compositions
      assert.ok(fs.existsSync(path.join(TEST_PROJECT_DIR, "compositions/scene_01.html")));
      assert.ok(fs.existsSync(path.join(TEST_PROJECT_DIR, "compositions/scene_02.html")));
      assert.ok(fs.existsSync(path.join(TEST_PROJECT_DIR, "index.html")));

      // Verify Stage 4 lint & browser check had ZERO errors
      assert.equal(result.lintResult.ok, true);
      assert.equal(result.lintResult.errorCount, 0);
      assert.equal(result.checkResult.ok, true);
      assert.equal(result.checkResult.browserSkipped, false);

      // Verify Stage 5 rendered MP4 & ffprobe metadata
      const absMp4 = path.join(TEST_PROJECT_DIR, result.outputRelPath);
      assert.ok(fs.existsSync(absMp4), "Rendered MP4 must exist on disk");
      assert.equal(result.probe.mediaType, "video");
      assert.equal(result.probe.width, 1080);
      assert.equal(result.probe.height, 1920);
      assert.ok(result.probe.duration >= 3.8 && result.probe.duration <= 4.3);
      assert.equal(result.probe.hasAudio, true);
    },
  );

  await t.test(
    "Antigravity workflow director_crew.py & SKILL.md are valid and complete",
    async () => {
      const workflowPath = path.join(ROOT_DIR, "studio-hub", "workflows", "director_crew.py");
      const skillPath = path.join(ROOT_DIR, ".agents", "skills", "director-studio-pro", "SKILL.md");

      assert.ok(fs.existsSync(workflowPath), "director_crew.py must exist");
      assert.ok(fs.existsSync(skillPath), "SKILL.md must exist");

      const pyCompile = await runCommand(
        "python",
        ["-m", "py_compile", "studio-hub/workflows/director_crew.py"],
        { cwd: ROOT_DIR, shell: false },
      );
      assert.equal(pyCompile.code, 0, `python -m py_compile failed: ${pyCompile.stderr}`);

      const pyText = fs.readFileSync(workflowPath, "utf8");
      for (const primitive of ["phase(", "agent(", "parallel(", "log("]) {
        assert.ok(pyText.includes(primitive), `Workflow missing primitive ${primitive}`);
      }

      const skillText = fs.readFileSync(skillPath, "utf8");
      for (const term of [
        "brand-analyst",
        "storyboard-director",
        "frame-designer",
        "google-flow-video",
        "audio-director",
        "hyperframes-qa",
        "labs.google/fx/tools/flow",
        "video-compiler.mjs",
      ]) {
        assert.ok(skillText.includes(term), `SKILL.md missing "${term}"`);
      }
    },
  );
});
