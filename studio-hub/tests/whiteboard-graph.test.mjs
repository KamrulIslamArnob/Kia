import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CURRENT_PROJECT_FILE,
  PROJECTS_DIR,
  ensureProjectDirs,
  probeMedia,
  runCommand,
  syncProjectManifest,
} from "../lib.mjs";
import {
  compileWhiteboardScene,
  loadWhiteboardGraph,
  saveWhiteboardGraph,
} from "../whiteboard-graph.mjs";

const TEST_SLUG = "tmp-wb-graph-tdd";
const TEST_PROJECT_DIR = path.join(PROJECTS_DIR, TEST_SLUG);

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

test("Whiteboard Scene Graph — persistence, normalization, dead-air trim, concat/xfade & 1080p storyboard injection", async (t) => {
  const prevCurrentProject = snapshotOptionalFile(CURRENT_PROJECT_FILE);

  t.after(() => {
    if (fs.existsSync(TEST_PROJECT_DIR)) {
      fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    }
    restoreOptionalFile(CURRENT_PROJECT_FILE, prevCurrentProject);
  });

  await t.test(
    "loadWhiteboardGraph & saveWhiteboardGraph normalize aliases and persist to .studio/whiteboard.json",
    async () => {
      ensureProjectDirs(TEST_SLUG);

      const initial = await loadWhiteboardGraph(TEST_SLUG);
      assert.equal(initial.slug, TEST_SLUG);
      assert.deepEqual(initial.nodes, []);
      assert.deepEqual(initial.edges, []);

      const saved = await saveWhiteboardGraph(TEST_SLUG, {
        nodes: [
          {
            id: "n_foot_1",
            type: "footage",
            x: 140,
            y: 220,
            title: "Opening Clip",
            relPath: "\\inbox\\raw-video\\clip_a.mp4",
            trimRange: [0.25, 2.75],
          },
          {
            id: "n_note_1",
            type: "note",
            x: 160,
            y: 80,
            title: "Hook Direction",
            text: "Use crash-zoom-in with bold headline",
          },
          {
            id: "n_scene_1",
            type: "scene",
            x: 520,
            y: 180,
            title: "Scene 1",
            prompt: "Clean framing",
          },
        ],
        edges: [
          { id: "e1", source: "n_foot_1", target: "n_scene_1" },
          { id: "e2", from: "n_note_1", to: "n_scene_1" },
        ],
      });

      const wbPath = path.join(TEST_PROJECT_DIR, ".studio", "whiteboard.json");
      assert.ok(fs.existsSync(wbPath), ".studio/whiteboard.json should exist on disk");

      assert.equal(saved.nodes.length, 3);
      assert.equal(saved.nodes[0].clipRelPath, "inbox/raw-video/clip_a.mp4");
      assert.deepEqual(saved.nodes[0].trimRange, [0.25, 2.75]);
      assert.equal(saved.nodes[1].promptText, "Use crash-zoom-in with bold headline");
      assert.equal(saved.nodes[2].promptText, "Clean framing");
      assert.deepEqual(
        saved.edges.map((e) => ({ from: e.from, to: e.to })),
        [
          { from: "n_foot_1", to: "n_scene_1" },
          { from: "n_note_1", to: "n_scene_1" },
        ],
      );

      const reloaded = await loadWhiteboardGraph(TEST_SLUG);
      assert.deepEqual(reloaded.nodes, saved.nodes);
      assert.deepEqual(reloaded.edges, saved.edges);

      assert.throws(() => loadWhiteboardGraph("../unsafe"), /Invalid project slug/i);
    },
  );

  await t.test(
    "compileWhiteboardScene trims dead air, honors trimRange & x-order, stitches libx264 30fps MP4, and renders 1080p Hero Frame PNG",
    async () => {
      ensureProjectDirs(TEST_SLUG);
      await syncProjectManifest(TEST_SLUG, {
        title: "Whiteboard Studio Demo",
        aspectRatio: "9:16",
        fps: 30,
      });

      const rawDir = path.join(TEST_PROJECT_DIR, "inbox", "raw-video");
      const clipAPath = path.join(rawDir, "clip_a_dead_air.mp4");
      const clipBPath = path.join(rawDir, "clip_b_trimmed.mp4");

      // Clip A: 3.2s total @ 720x1280 24fps — 0.8s silence + 1.6s speech tone + 0.8s silence
      const genA = await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=720x1280:rate=24:duration=3.2",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=44100:duration=3.2",
          "-af",
          "volume=enable='between(t,0,0.8)+between(t,2.4,3.2)':volume=0",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          "-c:a",
          "aac",
          clipAPath,
        ],
        { cwd: TEST_PROJECT_DIR, shell: false },
      );
      assert.equal(genA.code, 0, `Failed generating clip A: ${genA.stderr}`);

      // Clip B: 3.0s total @ 1080x1920 30fps (will be trimmed to [0.4, 1.9] = 1.5s)
      const genB = await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=1080x1920:rate=30:duration=3.0",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          clipBPath,
        ],
        { cwd: TEST_PROJECT_DIR, shell: false },
      );
      assert.equal(genB.code, 0, `Failed generating clip B: ${genB.stderr}`);

      await saveWhiteboardGraph(TEST_SLUG, {
        nodes: [
          {
            id: "foot_b",
            type: "footage",
            x: 420,
            y: 260,
            title: "Product Closeup",
            clipRelPath: "inbox/raw-video/clip_b_trimmed.mp4",
            trimRange: [0.4, 1.9],
          },
          {
            id: "foot_a",
            type: "footage",
            x: 110,
            y: 180,
            title: "Speaker Intro",
            clipRelPath: "inbox/raw-video/clip_a_dead_air.mp4",
            trimRange: null,
          },
          {
            id: "note_cam",
            type: "note",
            x: 90,
            y: 60,
            title: "Camera Note",
            promptText: "crash-zoom-in",
          },
          {
            id: "note_copy",
            type: "note",
            x: 280,
            y: 60,
            title: "Copy Note",
            promptText: "headline 'Fresh Daily Deals'",
          },
          {
            id: "hero_intro",
            type: "scene",
            x: 760,
            y: 200,
            title: "Opening Scene",
            promptText: "",
          },
        ],
        edges: [
          { id: "e1", from: "note_cam", to: "foot_a" },
          { id: "e2", from: "foot_a", to: "hero_intro" },
          { id: "e3", from: "foot_b", to: "hero_intro" },
          { id: "e4", from: "note_copy", to: "hero_intro" },
        ],
      });

      const compiled = await compileWhiteboardScene({
        slug: TEST_SLUG,
        sceneNodeId: "hero_intro",
        prompt: "badge 'WHITEBOARD V3'",
        transition: "cut",
      });

      assert.equal(compiled.ok, true);
      assert.equal(compiled.compiledClipRelPath, "assets/clips/wb_scene_hero_intro.mp4");

      const compiledAbs = path.join(TEST_PROJECT_DIR, compiled.compiledClipRelPath);
      assert.ok(fs.existsSync(compiledAbs), "Compiled scene MP4 must exist on disk");

      const probe = await probeMedia(compiledAbs);
      assert.equal(probe.width, 1080);
      assert.equal(probe.height, 1920);
      assert.equal(Math.round(probe.fps), 30);
      assert.equal(probe.codec, "h264");
      // Clip A trimmed from 3.2s -> ~1.6s..1.72s + Clip B trimmed [0.4, 1.9] = 1.5s => ~3.1s..3.3s (much less than raw 6.2s!)
      assert.ok(
        probe.duration >= 2.7 && probe.duration <= 3.8,
        `Expected dead-air + trimRange stitched duration ~3.1s, got ${probe.duration}s`,
      );

      // Verify STORYBOARD.json injection + combined prompts + 1080p Hero Design Frame PNG
      assert.ok(compiled.frame, "Returned frame must be defined");
      assert.equal(compiled.frame.sourceClip, "assets/clips/wb_scene_hero_intro.mp4");
      assert.equal(compiled.frame.motionPreset, "crash-zoom-in");
      assert.equal(compiled.frame.staging.headline, "Fresh Daily Deals");
      assert.equal(compiled.frame.staging.badgeText, "WHITEBOARD V3");

      const heroPngAbs = path.join(TEST_PROJECT_DIR, compiled.frame.designFramePath);
      assert.ok(fs.existsSync(heroPngAbs), "1080p Hero Design Frame PNG must exist on disk");
      assert.ok(fs.statSync(heroPngAbs).size > 10_000, "Hero Design Frame PNG must be non-trivial");

      // Re-compile same scene node with crossfade + directed topological edge override
      await saveWhiteboardGraph(TEST_SLUG, {
        nodes: compiled.graph.nodes,
        edges: [
          { id: "e_topo", from: "foot_b", to: "foot_a" },
          { id: "e2", from: "foot_a", to: "hero_intro" },
          { id: "e4", from: "note_copy", to: "hero_intro" },
        ],
      });

      const crossfaded = await compileWhiteboardScene({
        slug: TEST_SLUG,
        sceneNodeId: "hero_intro",
        prompt: "split-editorial headline 'Updated Crossfade Scene'",
        transition: "crossfade",
      });

      assert.equal(crossfaded.ok, true);
      assert.equal(
        crossfaded.storyboard.frames.length,
        1,
        "Recompiling same sceneNode updates existing storyboard frame",
      );
      assert.equal(crossfaded.frame.id, compiled.frame.id);
      assert.equal(crossfaded.frame.layout, "split-editorial");
      assert.equal(crossfaded.frame.staging.headline, "Updated Crossfade Scene");
      assert.ok(crossfaded.frame.currentVersion > compiled.frame.currentVersion);

      const probeXf = await probeMedia(compiledAbs);
      assert.ok(
        probeXf.duration < probe.duration,
        `Expected crossfade duration (${probeXf.duration}s) < hard-cut duration (${probe.duration}s)`,
      );
    },
  );
});
