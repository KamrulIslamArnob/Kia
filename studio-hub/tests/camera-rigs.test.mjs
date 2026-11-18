import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  CAMERA_BODIES,
  LENS_FOCAL_LENGTHS,
  APERTURE_STOPS,
  DOP_CAMERA_PRESETS,
  buildGsapCameraTweenCode,
  recommendRigForPrompt,
} from "../presets/camera-rigs.mjs";

const EXPECTED_CAMERA_BODY_IDS = [
  "modern-digital",
  "kodak-35mm",
  "indie-16mm",
  "anamorphic-2x",
  "clean-ui-studio",
  "handheld-doc",
];

const EXPECTED_LENS_IDS = ["14mm", "24mm", "35mm", "50mm", "85mm"];

const EXPECTED_APERTURE_IDS = ["f/1.4", "f/2.8", "f/5.6", "f/11"];

const EXPECTED_PRESET_IDS = [
  "crash-zoom-in",
  "dolly-in-slow",
  "dolly-out-reveal",
  "whip-pan-left",
  "whip-pan-right",
  "isometric-3d-tilt-left",
  "isometric-3d-tilt-right",
  "crane-up-reveal",
  "crane-down-land",
  "orbit-float-cw",
  "orbit-float-ccw",
  "push-pull-vertigo",
  "spotlight-cursor-200",
  "bottom-left-cta-zoom",
  "top-right-badge-zoom",
  "bento-stagger-pop",
  "split-slide-duet",
  "hero-lockoff",
  "handheld-micro-drift",
  "snap-punch-135",
  "glide-down-scroll",
  "glide-up-scroll",
  "flip-card-reveal",
  "outro-dock-left",
];

const TRANSFORM_KEYS = ["scale", "x", "y", "rotateX", "rotateY", "rotateZ"];

function executeGsapSnippet(snippet) {
  const calls = [];
  const mockTl = {
    fromTo(target, fromVars, toVars, position) {
      calls.push({ target, fromVars, toVars, position });
      return mockTl;
    },
  };
  vm.runInNewContext(snippet, { tl: mockTl });
  return calls;
}

test("CAMERA_BODIES exports 6 cinema optical profiles with FFmpeg pre-treatment metadata", () => {
  assert.equal(Array.isArray(CAMERA_BODIES), true);
  assert.equal(CAMERA_BODIES.length, 6);
  assert.deepEqual(
    CAMERA_BODIES.map((b) => b.id),
    EXPECTED_CAMERA_BODY_IDS,
  );
  assert.equal(JSON.parse(JSON.stringify(CAMERA_BODIES)).length, 6);

  for (const id of EXPECTED_CAMERA_BODY_IDS) {
    const body = CAMERA_BODIES[id];
    assert.ok(body, `Expected dual lookup CAMERA_BODIES["${id}"]`);
    assert.equal(body.id, id);
    assert.equal(typeof body.name, "string");
    assert.ok(body.name.length > 0);
    assert.equal(typeof body.description, "string");
    assert.equal(typeof body.grain, "number");
    assert.ok(body.grain >= 0);
    assert.equal(typeof body.vignette, "number");
    assert.ok(body.vignette >= 0);
    assert.equal(typeof body.aspect, "string");
    assert.ok(body.aspect.length > 0);
    assert.equal(typeof body.contrast, "number");
    assert.ok(body.contrast > 0);
    assert.equal(typeof body.ffmpegFilter, "string");
    assert.ok(body.ffmpegFilter.length > 0);
    assert.equal(body.allowCssFilter, false);
    assert.equal(/blur\(|brightness\(|drop-shadow\(/i.test(body.ffmpegFilter), false);
    assert.equal(Object.isFrozen(body), true);
  }

  assert.equal(CAMERA_BODIES["clean-ui-studio"].grain, 0);
  assert.equal(CAMERA_BODIES["clean-ui-studio"].vignette, 0);
  assert.ok(CAMERA_BODIES["indie-16mm"].grain > CAMERA_BODIES["kodak-35mm"].grain);
  assert.ok(CAMERA_BODIES["kodak-35mm"].grain > CAMERA_BODIES["modern-digital"].grain);
});

test("LENS_FOCAL_LENGTHS exports 5 lenses with perspective 900px..2200px and FOV scale factors", () => {
  assert.equal(Array.isArray(LENS_FOCAL_LENGTHS), true);
  assert.equal(LENS_FOCAL_LENGTHS.length, 5);
  assert.deepEqual(
    LENS_FOCAL_LENGTHS.map((l) => l.id),
    EXPECTED_LENS_IDS,
  );

  for (const id of EXPECTED_LENS_IDS) {
    const lens = LENS_FOCAL_LENGTHS[id];
    assert.ok(lens, `Expected dual lookup LENS_FOCAL_LENGTHS["${id}"]`);
    assert.equal(lens.id, id);
    assert.equal(typeof lens.perspectivePx, "number");
    assert.ok(
      lens.perspectivePx >= 900 && lens.perspectivePx <= 2200,
      `Expected perspectivePx in 900..2200, got ${lens.perspectivePx}`,
    );
    assert.match(lens.perspectiveCss, /^perspective:\s*\d+px$/);
    assert.equal(typeof lens.fovScale, "number");
    assert.ok(lens.fovScale > 0);
    assert.equal(typeof lens.fovDeg, "number");
    assert.ok(lens.fovDeg > 0);
    assert.equal(Object.isFrozen(lens), true);
  }

  assert.equal(LENS_FOCAL_LENGTHS["14mm"].perspectivePx, 900);
  assert.equal(LENS_FOCAL_LENGTHS["85mm"].perspectivePx, 2200);

  for (let i = 1; i < LENS_FOCAL_LENGTHS.length; i += 1) {
    assert.ok(
      LENS_FOCAL_LENGTHS[i].perspectivePx > LENS_FOCAL_LENGTHS[i - 1].perspectivePx,
      "perspectivePx must strictly increase with focal length",
    );
    assert.ok(
      LENS_FOCAL_LENGTHS[i].fovDeg < LENS_FOCAL_LENGTHS[i - 1].fovDeg,
      "fovDeg must strictly decrease with focal length",
    );
    assert.ok(
      LENS_FOCAL_LENGTHS[i].fovScale > LENS_FOCAL_LENGTHS[i - 1].fovScale,
      "fovScale must strictly increase with focal length",
    );
  }
});

test("APERTURE_STOPS exports 4 T/f-stops with background plate separation metadata", () => {
  assert.equal(Array.isArray(APERTURE_STOPS), true);
  assert.equal(APERTURE_STOPS.length, 4);
  assert.deepEqual(
    APERTURE_STOPS.map((a) => a.id),
    EXPECTED_APERTURE_IDS,
  );

  for (const id of EXPECTED_APERTURE_IDS) {
    const stop = APERTURE_STOPS[id];
    assert.ok(stop, `Expected dual lookup APERTURE_STOPS["${id}"]`);
    assert.equal(stop.id, id);
    assert.equal(typeof stop.fNumber, "number");
    assert.equal(typeof stop.depthOfField, "string");
    assert.equal(typeof stop.backgroundSeparation, "number");
    assert.ok(stop.backgroundSeparation >= 0 && stop.backgroundSeparation <= 1);
    assert.equal(typeof stop.ffmpegBgBlurSigma, "number");
    assert.ok(stop.ffmpegBgBlurSigma >= 0);
    assert.equal(typeof stop.parallaxRatio, "number");
    assert.ok(stop.parallaxRatio > 0 && stop.parallaxRatio <= 1);
    assert.equal(Object.isFrozen(stop), true);
  }

  for (let i = 1; i < APERTURE_STOPS.length; i += 1) {
    assert.ok(
      APERTURE_STOPS[i].backgroundSeparation < APERTURE_STOPS[i - 1].backgroundSeparation,
      "Wider apertures must have stronger background separation than stopped-down apertures",
    );
    assert.ok(
      APERTURE_STOPS[i].ffmpegBgBlurSigma <= APERTURE_STOPS[i - 1].ffmpegBgBlurSigma,
      "FFmpeg background blur sigma must decrease as f-number increases",
    );
  }
});

test("DOP_CAMERA_PRESETS exports all 24 deterministic Higgsfield camera motion presets", () => {
  assert.equal(Array.isArray(DOP_CAMERA_PRESETS), true);
  assert.equal(DOP_CAMERA_PRESETS.length, 24);
  assert.deepEqual(
    DOP_CAMERA_PRESETS.map((p) => p.id),
    EXPECTED_PRESET_IDS,
  );

  for (const id of EXPECTED_PRESET_IDS) {
    const preset = DOP_CAMERA_PRESETS[id];
    assert.ok(preset, `Expected dual lookup DOP_CAMERA_PRESETS["${id}"]`);
    assert.equal(preset.id, id);
    assert.equal(typeof preset.name, "string");
    assert.ok(preset.name.length > 0);
    assert.equal(typeof preset.category, "string");
    assert.ok(preset.category.length > 0);
    assert.equal(typeof preset.description, "string");
    assert.ok(preset.description.length > 0);
    assert.equal(typeof preset.ease, "string");
    assert.ok(preset.ease.length > 0);
    assert.equal(/bounce\.out|elastic\.out/i.test(preset.ease), false);
    assert.equal(typeof preset.durationRatio, "number");
    assert.ok(preset.durationRatio > 0 && preset.durationRatio <= 1);

    for (const endpoint of ["from", "to"]) {
      assert.equal(typeof preset[endpoint], "object");
      assert.equal(Object.isFrozen(preset[endpoint]), true);
      for (const key of TRANSFORM_KEYS) {
        assert.equal(
          typeof preset[endpoint][key],
          "number",
          `Preset ${id}.${endpoint}.${key} must be a finite number`,
        );
        assert.equal(Number.isFinite(preset[endpoint][key]), true);
      }
    }
    assert.equal(Object.isFrozen(preset), true);
  }

  assert.ok(
    DOP_CAMERA_PRESETS["crash-zoom-in"].to.scale > DOP_CAMERA_PRESETS["crash-zoom-in"].from.scale,
  );
  assert.ok(
    DOP_CAMERA_PRESETS["dolly-out-reveal"].from.scale >
      DOP_CAMERA_PRESETS["dolly-out-reveal"].to.scale,
  );
  assert.equal(DOP_CAMERA_PRESETS["spotlight-cursor-200"].to.scale, 2.0);
  assert.equal(DOP_CAMERA_PRESETS["snap-punch-135"].to.scale, 1.35);
  assert.equal(
    Math.sign(DOP_CAMERA_PRESETS["whip-pan-left"].from.x),
    -Math.sign(DOP_CAMERA_PRESETS["whip-pan-right"].from.x),
  );
  assert.equal(
    Math.sign(DOP_CAMERA_PRESETS["isometric-3d-tilt-left"].to.rotateY),
    -Math.sign(DOP_CAMERA_PRESETS["isometric-3d-tilt-right"].to.rotateY),
  );
});

test("buildGsapCameraTweenCode generates valid, deterministic, HyperFrames-safe GSAP .fromTo() code", () => {
  for (const preset of DOP_CAMERA_PRESETS) {
    const selector = '[data-composition-id="scene_01"] .camera-rig';
    const snippetA = buildGsapCameraTweenCode({
      presetId: preset.id,
      selector,
      durationSeconds: 4.0,
      focusX: 0.5,
      focusY: 0.5,
    });
    const snippetB = buildGsapCameraTweenCode({
      presetId: preset.id,
      selector,
      durationSeconds: 4.0,
      focusX: 0.5,
      focusY: 0.5,
    });

    assert.equal(snippetA, snippetB, `Snippet for ${preset.id} must be 100% deterministic`);
    assert.match(snippetA, /tl\.fromTo\(/);
    assert.equal(
      /Date\.now|Math\.random|repeat\s*:\s*-1|setTimeout|setInterval/.test(snippetA),
      false,
    );

    const calls = executeGsapSnippet(snippetA);
    assert.equal(calls.length, 1, `Expected 1 tl.fromTo call for ${preset.id}`);
    assert.equal(calls[0].target, selector);
    assert.equal(calls[0].position, 0);
    assert.equal(calls[0].fromVars.scale, preset.from.scale);
    assert.equal(calls[0].toVars.scale, preset.to.scale);
    assert.equal(calls[0].toVars.ease, preset.ease);
    assert.equal(calls[0].fromVars.transformOrigin, "50% 50%");
    assert.ok(calls[0].toVars.duration > 0 && calls[0].toVars.duration <= 4.0);
  }
});

test("buildGsapCameraTweenCode supports customScale, focal anchor offsets, lens perspective, and fallback", () => {
  const customSnippet = buildGsapCameraTweenCode({
    presetId: "crash-zoom-in",
    selector: "#hero-plate",
    durationSeconds: 3.0,
    focusX: 0.25,
    focusY: 0.75,
    customScale: 2.35,
    lens: "85mm",
  });

  const calls = executeGsapSnippet(customSnippet);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, "#hero-plate");
  assert.equal(calls[0].toVars.scale, 2.35);
  assert.equal(calls[0].fromVars.transformOrigin, "25% 75%");
  assert.equal(calls[0].fromVars.transformPerspective, 2200);
  assert.ok(calls[0].toVars.x > DOP_CAMERA_PRESETS["crash-zoom-in"].to.x);
  assert.ok(calls[0].toVars.y < DOP_CAMERA_PRESETS["crash-zoom-in"].to.y);

  // Range object customScale + percentage focus coordinates + fallback preset
  const rangeSnippet = buildGsapCameraTweenCode({
    presetId: "non-existent-preset",
    selector: "#stage",
    durationSeconds: 2.5,
    focusX: 80,
    focusY: 20,
    customScale: { from: 1.1, to: 1.9 },
  });
  const fallbackCalls = executeGsapSnippet(rangeSnippet);
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].fromVars.transformOrigin, "80% 20%");
  assert.equal(fallbackCalls[0].fromVars.scale, 1.1);
  assert.equal(fallbackCalls[0].toVars.scale, 1.9);
});

test("recommendRigForPrompt deterministically scores natural-language prompts and reaches full catalog", () => {
  const validPresetSet = new Set(EXPECTED_PRESET_IDS);
  const validBodySet = new Set(EXPECTED_CAMERA_BODY_IDS);
  const validLensSet = new Set(EXPECTED_LENS_IDS);
  const validApertureSet = new Set(EXPECTED_APERTURE_IDS);

  function assertValidRig(rig) {
    assert.deepEqual(Object.keys(rig), ["presetId", "cameraBody", "lens", "aperture"]);
    assert.equal(validPresetSet.has(rig.presetId), true, `Invalid presetId: ${rig.presetId}`);
    assert.equal(validBodySet.has(rig.cameraBody), true, `Invalid cameraBody: ${rig.cameraBody}`);
    assert.equal(validLensSet.has(rig.lens), true, `Invalid lens: ${rig.lens}`);
    assert.equal(validApertureSet.has(rig.aperture), true, `Invalid aperture: ${rig.aperture}`);
  }

  // Empty / null safety + determinism
  const defaultRigA = recommendRigForPrompt("");
  const defaultRigB = recommendRigForPrompt(null);
  assertValidRig(defaultRigA);
  assert.deepEqual(defaultRigA, defaultRigB);

  // SaaS UI spotlight cursor 200% zoom
  const uiRig = recommendRigForPrompt("Crisp SaaS dashboard UI with 200% spotlight cursor click");
  assertValidRig(uiRig);
  assert.equal(uiRig.presetId, "spotlight-cursor-200");
  assert.equal(uiRig.cameraBody, "clean-ui-studio");

  // Indie 16mm handheld documentary
  const docRig = recommendRigForPrompt("Gritty indie 16mm handheld street documentary drift");
  assertValidRig(docRig);
  assert.equal(docRig.presetId, "handheld-micro-drift");
  assert.equal(docRig.cameraBody, "indie-16mm");
  assert.equal(docRig.lens, "35mm");

  // Disambiguates "Kodak 35mm film" gauge from portrait lens selection (selects 85mm f/1.4)
  const filmPortraitRig = recommendRigForPrompt(
    "Warm Kodak 35mm film close-up portrait with shallow bokeh and slow dolly in",
  );
  assertValidRig(filmPortraitRig);
  assert.equal(filmPortraitRig.presetId, "dolly-in-slow");
  assert.equal(filmPortraitRig.cameraBody, "kodak-35mm");
  assert.equal(filmPortraitRig.lens, "85mm");
  assert.equal(filmPortraitRig.aperture, "f/1.4");

  // Epic widescreen anamorphic crane up reveal in deep focus f/11
  const craneRig = recommendRigForPrompt(
    "Epic widescreen anamorphic 2x crane up reveal of architecture in deep focus f/11",
  );
  assertValidRig(craneRig);
  assert.equal(craneRig.presetId, "crane-up-reveal");
  assert.equal(craneRig.cameraBody, "anamorphic-2x");
  assert.equal(craneRig.aperture, "f/11");

  // Hitchcock vertigo push-pull with 14mm ultra-wide lens
  const vertigoRig = recommendRigForPrompt("Dramatic 14mm ultra-wide vertigo dolly zoom warp");
  assertValidRig(vertigoRig);
  assert.equal(vertigoRig.presetId, "push-pull-vertigo");
  assert.equal(vertigoRig.lens, "14mm");

  // Verify every single preset, cameraBody, lens, and aperture is reachable via prompt
  for (const id of EXPECTED_PRESET_IDS) {
    assert.equal(recommendRigForPrompt(`Use ${id} motion`).presetId, id);
  }
  for (const id of EXPECTED_CAMERA_BODY_IDS) {
    assert.equal(recommendRigForPrompt(`Shoot on ${id} profile`).cameraBody, id);
  }
  for (const id of EXPECTED_LENS_IDS) {
    assert.equal(recommendRigForPrompt(`Mount ${id} prime lens`).lens, id);
  }
  for (const id of EXPECTED_APERTURE_IDS) {
    assert.equal(recommendRigForPrompt(`Expose at ${id} stop`).aperture, id);
  }
});
