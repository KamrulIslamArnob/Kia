import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  REFRAME_TARGETS,
  computeSmartReframePlan,
  computeMultiAspectReframePlans,
} from "../smart-reframe.mjs";

const EXPECTED_ASPECTS = ["9:16", "16:9", "1:1", "4:5"];

test("REFRAME_TARGETS exports frozen 9:16, 16:9, 1:1, and 4:5 master specs with dual lookup", () => {
  assert.equal(Array.isArray(REFRAME_TARGETS), true);
  assert.equal(REFRAME_TARGETS.length, 4);
  assert.deepEqual(
    REFRAME_TARGETS.map((t) => t.id),
    EXPECTED_ASPECTS,
  );

  assert.equal(REFRAME_TARGETS["9:16"].width, 1080);
  assert.equal(REFRAME_TARGETS["9:16"].height, 1920);
  assert.equal(REFRAME_TARGETS["16:9"].width, 1920);
  assert.equal(REFRAME_TARGETS["16:9"].height, 1080);
  assert.equal(REFRAME_TARGETS["1:1"].width, 1080);
  assert.equal(REFRAME_TARGETS["1:1"].height, 1080);
  assert.equal(REFRAME_TARGETS["4:5"].width, 1080);
  assert.equal(REFRAME_TARGETS["4:5"].height, 1350);

  for (const id of EXPECTED_ASPECTS) {
    const spec = REFRAME_TARGETS[id];
    assert.ok(spec);
    assert.equal(Object.isFrozen(spec), true);
    assert.equal(spec.width % 2, 0);
    assert.equal(spec.height % 2, 0);
  }
});

test("computeSmartReframePlan reframes 9:16 speaker into 16:9, 1:1, and 4:5 without cropping head", () => {
  const storyboard = {
    slug: "speaker-test",
    width: 1080,
    height: 1920,
    frames: [
      {
        id: "frame_01",
        sceneId: "scene_01",
        title: "Founder Hook",
        cameraMotion: {
          fromScale: 1.0,
          toScale: 1.85,
          focusX: 50,
          focusY: 50,
        },
      },
    ],
  };

  // Speaker positioned in upper vertical frame (y=0.14..0.32 -> crown ~211px, chin ~636px)
  // A naive center 16:9 crop (y=656..1264) would completely slice off the speaker's head!
  const faceBox = { x: 0.36, y: 0.14, width: 0.28, height: 0.18 };
  const crownPx = Math.floor((faceBox.y - 0.28 * faceBox.height) * 1920);
  const eyePx = Math.round((faceBox.y + 0.38 * faceBox.height) * 1920);
  const chinPx = Math.ceil((faceBox.y + faceBox.height) * 1920);

  for (const targetAspect of ["16:9", "1:1", "4:5", "9:16"]) {
    const plan = computeSmartReframePlan({
      storyboard,
      sourceWidth: 1080,
      sourceHeight: 1920,
      targetAspect,
      faceBox,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.targetAspect, targetAspect);
    assert.equal(plan.width, REFRAME_TARGETS[targetAspect].width);
    assert.equal(plan.height, REFRAME_TARGETS[targetAspect].height);
    assert.equal(plan.shots.length, 1);

    const shot = plan.shots[0];
    assert.equal(shot.frameId, "frame_01");
    assert.equal(shot.width, REFRAME_TARGETS[targetAspect].width);
    assert.equal(shot.height, REFRAME_TARGETS[targetAspect].height);
    assert.ok(shot.focusX >= 0 && shot.focusX <= 1);
    assert.ok(shot.focusY >= 0 && shot.focusY <= 1);
    assert.ok(shot.scale >= 1.0 && shot.scale <= 2.2);
    assert.equal(shot.headSafe, true);

    // Verify cropBox lies strictly inside 1080x1920 source and NEVER crops crown or eyes/chin
    assert.ok(shot.cropBox.x >= 0);
    assert.ok(shot.cropBox.y >= 0);
    assert.ok(shot.cropBox.x + shot.cropBox.width <= 1080);
    assert.ok(shot.cropBox.y + shot.cropBox.height <= 1920);
    assert.ok(
      shot.cropBox.y <= crownPx,
      `Expected cropBox.y (${shot.cropBox.y}) <= crownPx (${crownPx}) for ${targetAspect}`,
    );
    assert.ok(
      shot.cropBox.y + shot.cropBox.height >= eyePx,
      `Expected eye line (${eyePx}) inside crop bottom for ${targetAspect}`,
    );
    assert.ok(
      shot.cropBox.y + shot.cropBox.height >= chinPx,
      `Expected chin (${chinPx}) inside crop bottom for ${targetAspect}`,
    );

    if (targetAspect === "16:9") {
      // Must pan significantly above geometric center (0.5) to capture upper-frame speaker
      assert.ok(shot.focusY < 0.35, `Expected upward focusY < 0.35, got ${shot.focusY}`);
    }
  }
});

test("computeSmartReframePlan pans horizontally when reframing 16:9 off-center speaker to 9:16", () => {
  const storyboard = {
    width: 1920,
    height: 1080,
    frames: [
      {
        id: "frame_01",
        title: "Right-Third Interview Subject",
        cameraMotion: { fromScale: 1.0, toScale: 1.15, focusX: 50, focusY: 50 },
      },
    ],
  };

  // Speaker on right third of widescreen 1920x1080 frame (center X = 0.76)
  const faceBox = { x: 0.69, y: 0.2, width: 0.14, height: 0.28 };
  const plan = computeSmartReframePlan({
    storyboard,
    sourceWidth: 1920,
    sourceHeight: 1080,
    targetAspect: "9:16",
    faceBox,
  });

  const shot = plan.shots[0];
  assert.equal(shot.width, 1080);
  assert.equal(shot.height, 1920);
  assert.ok(shot.focusX > 0.68 && shot.focusX < 0.84, `Expected focusX ~0.76, got ${shot.focusX}`);
  assert.equal(shot.headSafe, true);

  const faceLeftPx = Math.floor(faceBox.x * 1920);
  const faceRightPx = Math.ceil((faceBox.x + faceBox.width) * 1920);
  assert.ok(shot.cropBox.x <= faceLeftPx);
  assert.ok(shot.cropBox.x + shot.cropBox.width >= faceRightPx);
});

test("computeSmartReframePlan supports pixel faceBoxes, per-frame maps, and UI saliency targets", () => {
  const storyboard = {
    width: 1080,
    height: 1920,
    frames: [
      {
        id: "frame_01",
        title: "Pixel Face Shot",
      },
      {
        id: "frame_02",
        title: "Bottom-Left UI Cursor Target",
        staging: {
          cursorTarget: { x: 0.2, y: 0.82 },
        },
      },
      {
        id: "frame_03",
        title: "Top-Right Camera Focus",
        cameraMotion: {
          focusX: 82,
          focusY: 18,
          fromScale: 1.12,
        },
      },
    ],
  };

  const planA = computeSmartReframePlan({
    storyboard,
    sourceWidth: 1080,
    sourceHeight: 1920,
    targetAspect: "16:9",
    faceBox: {
      frame_01: { x: 380, y: 300, width: 320, height: 360 }, // pixel coordinates
    },
  });
  const planB = computeSmartReframePlan({
    storyboard,
    sourceWidth: 1080,
    sourceHeight: 1920,
    targetAspect: "16:9",
    faceBox: {
      frame_01: { x: 380, y: 300, width: 320, height: 360 },
    },
  });

  // Strict determinism
  assert.deepEqual(planA, planB);
  assert.equal(planA.shots.length, 3);

  // Shot 1: pixel faceBox normalized -> upper frame
  assert.equal(planA.shots[0].anchorSource, "face");
  assert.ok(planA.shots[0].focusY < 0.4);
  assert.equal(planA.shots[0].headSafe, true);

  // Shot 2: cursorTarget at y=0.82 -> pans crop downward
  assert.equal(planA.shots[1].anchorSource, "cursor");
  assert.ok(planA.shots[1].focusY > 0.7);
  assert.ok(planA.shots[1].focusX < 0.3);

  // Shot 3: cameraMotion 82%, 18% -> pans crop upward & tracks X=0.82
  assert.equal(planA.shots[2].anchorSource, "camera-focus");
  assert.ok(planA.shots[2].focusY < 0.3);
  assert.ok(planA.shots[2].focusX > 0.75);
});

test("computeMultiAspectReframePlans and real project storyboard reframing work cleanly", () => {
  const showcaseSbPath = path.resolve("projects/capcut-1118-showcase/STORYBOARD.json");
  const storyboard = fs.existsSync(showcaseSbPath)
    ? JSON.parse(fs.readFileSync(showcaseSbPath, "utf8"))
    : {
        width: 1080,
        height: 1920,
        frames: [{ id: "frame_01", cameraMotion: { focusX: 50, focusY: 38 } }],
      };

  const multi = computeMultiAspectReframePlans({
    storyboard,
    sourceWidth: storyboard.width || 1080,
    sourceHeight: storyboard.height || 1920,
    targetAspects: ["9:16", "16:9", "1:1", "4:5"],
  });

  assert.equal(multi.ok, true);
  assert.deepEqual(Object.keys(multi.plans), ["9:16", "16:9", "1:1", "4:5"]);
  for (const aspect of EXPECTED_ASPECTS) {
    assert.equal(multi.plans[aspect].shots.length, storyboard.frames.length);
  }

  assert.throws(
    () =>
      computeSmartReframePlan({
        storyboard,
        targetAspect: "21:9-invalid",
      }),
    /Unsupported targetAspect/i,
  );
});
