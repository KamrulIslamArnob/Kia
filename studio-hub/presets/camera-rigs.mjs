/**
 * Higgsfield Cinema Studio DoP Camera Rig & Optical Simulation Library.
 *
 * Enforces HyperFrames render contracts:
 * - Optical film grain, vignette, contrast, and background bokeh separation
 *   are specified strictly as FFmpeg pre-treatment metadata (NEVER CSS filters).
 * - Camera motion presets compile into deterministic, seekable GSAP `.fromTo()`
 *   tweens with zero `Date.now()`, zero `Math.random()`, and zero `repeat: -1`.
 */

function deepFreeze(obj) {
  if (!obj || typeof obj !== "object" || Object.isFrozen(obj)) {
    return obj;
  }
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(obj);
}

/**
 * Builds an immutable catalog array that also supports O(1) non-enumerable
 * lookup by `item.id` (e.g. `DOP_CAMERA_PRESETS["crash-zoom-in"]`) while
 * serializing cleanly as a standard JSON array.
 */
function buildDualCatalog(definitions) {
  const items = definitions.map((entry) => deepFreeze(structuredClone(entry)));
  for (const item of items) {
    Object.defineProperty(items, item.id, {
      value: item,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(items);
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function round3(val) {
  return Math.round(val * 1000) / 1000;
}

const CAMERA_BODY_DEFINITIONS = [
  {
    id: "modern-digital",
    name: "Modern Digital Cinema",
    sensorFormat: "Large Format Digital",
    description:
      "ARRI-inspired large-format digital cinema sensor with subtle organic grain, gentle edge falloff, and balanced highlight rolloff.",
    grain: 2,
    vignette: 0.14,
    aspect: "16:9",
    contrast: 1.04,
    saturation: 1.02,
    treatmentTarget: "ffmpeg-pretreatment",
    allowCssFilter: false,
    ffmpegFilter: "eq=contrast=1.04:saturation=1.02,noise=alls=2:allf=t+u,vignette=angle=0.14",
  },
  {
    id: "kodak-35mm",
    name: "Kodak Vision3 35mm",
    sensorFormat: "Super 35mm 4-Perf",
    description:
      "Warm photochemical 35mm celluloid emulation with fine silver-halide grain, rich midtone contrast, and classic optical vignette.",
    grain: 7,
    vignette: 0.24,
    aspect: "1.85:1",
    contrast: 1.08,
    saturation: 1.06,
    treatmentTarget: "ffmpeg-pretreatment",
    allowCssFilter: false,
    ffmpegFilter: "eq=contrast=1.08:saturation=1.06,noise=alls=7:allf=t+u,vignette=angle=0.24",
  },
  {
    id: "indie-16mm",
    name: "Indie Super 16mm",
    sensorFormat: "Super 16mm Film",
    description:
      "Tactile Super 16mm documentary stock featuring pronounced organic grain, punchy blacks, muted saturation, and stronger lens falloff.",
    grain: 14,
    vignette: 0.34,
    aspect: "4:3",
    contrast: 1.12,
    saturation: 0.94,
    treatmentTarget: "ffmpeg-pretreatment",
    allowCssFilter: false,
    ffmpegFilter: "eq=contrast=1.12:saturation=0.94,noise=alls=14:allf=t+u,vignette=angle=0.34",
  },
  {
    id: "anamorphic-2x",
    name: "Anamorphic 2x Scope",
    sensorFormat: "2x Anamorphic Widescreen",
    description:
      "Theatrical 2.39:1 widescreen optical profile with crisp cinema contrast, fine texture, and peripheral barrel vignette.",
    grain: 4,
    vignette: 0.28,
    aspect: "2.39:1",
    contrast: 1.1,
    saturation: 1.04,
    treatmentTarget: "ffmpeg-pretreatment",
    allowCssFilter: false,
    ffmpegFilter: "eq=contrast=1.10:saturation=1.04,noise=alls=4:allf=t+u,vignette=angle=0.28",
  },
  {
    id: "clean-ui-studio",
    name: "Clean UI Studio",
    sensorFormat: "Pixel-Accurate Digital Plate",
    description:
      "Zero-grain, zero-vignette studio capture profile engineered for razor-sharp SaaS dashboards, mobile interfaces, and typography.",
    grain: 0,
    vignette: 0,
    aspect: "native",
    contrast: 1.0,
    saturation: 1.0,
    treatmentTarget: "ffmpeg-pretreatment",
    allowCssFilter: false,
    ffmpegFilter: "eq=contrast=1.00:saturation=1.00",
  },
  {
    id: "handheld-doc",
    name: "Handheld Documentary",
    sensorFormat: "Super 35mm Shoulder Rig",
    description:
      "Naturalistic verite cinema profile with light reportage texture, honest color reproduction, and subtle corner shading.",
    grain: 5,
    vignette: 0.18,
    aspect: "16:9",
    contrast: 1.06,
    saturation: 0.98,
    treatmentTarget: "ffmpeg-pretreatment",
    allowCssFilter: false,
    ffmpegFilter: "eq=contrast=1.06:saturation=0.98,noise=alls=5:allf=t+u,vignette=angle=0.18",
  },
];

export const CAMERA_BODIES = buildDualCatalog(CAMERA_BODY_DEFINITIONS);

const LENS_DEFINITIONS = [
  {
    id: "14mm",
    name: "14mm Ultra-Wide Prime",
    focalLengthMm: 14,
    perspectivePx: 900,
    perspective: "900px",
    perspectiveCss: "perspective: 900px",
    fovDeg: 114,
    fovScale: 0.82,
    description:
      "Dramatic spatial depth and exaggerated Z-axis foreshortening for immersive architectural sweeps and vertigo transitions.",
  },
  {
    id: "24mm",
    name: "24mm Wide Cinema Prime",
    focalLengthMm: 24,
    perspectivePx: 1150,
    perspective: "1150px",
    perspectiveCss: "perspective: 1150px",
    fovDeg: 84,
    fovScale: 0.92,
    description:
      "Dynamic wide-angle cinema geometry ideal for 3D device tilts, crane reveals, and energetic whip pans.",
  },
  {
    id: "35mm",
    name: "35mm Director Standard",
    focalLengthMm: 35,
    perspectivePx: 1450,
    perspective: "1450px",
    perspectiveCss: "perspective: 1450px",
    fovDeg: 63,
    fovScale: 1.0,
    description:
      "Versatile narrative Cinema Prime balancing environmental context with natural three-dimensional subject presence.",
  },
  {
    id: "50mm",
    name: "50mm Natural Eye Prime",
    focalLengthMm: 50,
    perspectivePx: 1800,
    perspective: "1800px",
    perspectiveCss: "perspective: 1800px",
    fovDeg: 47,
    fovScale: 1.12,
    description:
      "Distortion-free human-eye perspective suited for editorial product showcases, bento grids, and clean UI walkthroughs.",
  },
  {
    id: "85mm",
    name: "85mm Portrait Telephoto",
    focalLengthMm: 85,
    perspectivePx: 2200,
    perspective: "2200px",
    perspectiveCss: "perspective: 2200px",
    fovDeg: 28,
    fovScale: 1.28,
    description:
      "Compressed telephoto optics isolating hero UI callouts, badges, cursors, and close-up portraits with minimal perspective warp.",
  },
];

export const LENS_FOCAL_LENGTHS = buildDualCatalog(LENS_DEFINITIONS);

const APERTURE_DEFINITIONS = [
  {
    id: "f/1.4",
    name: "Wide Open Prime (f/1.4)",
    fNumber: 1.4,
    depthOfField: "shallow",
    backgroundSeparation: 0.92,
    backgroundDimOpacity: 0.42,
    parallaxRatio: 0.35,
    ffmpegBgBlurSigma: 18,
    ffmpegBgFilter: "gblur=sigma=18",
    allowCssFilter: false,
    description:
      "Maximum subject isolation with creamy FFmpeg-baked background bokeh plate separation and deep foreground-background parallax.",
  },
  {
    id: "f/2.8",
    name: "Cinema T-Stop Split (f/2.8)",
    fNumber: 2.8,
    depthOfField: "moderate-shallow",
    backgroundSeparation: 0.68,
    backgroundDimOpacity: 0.28,
    parallaxRatio: 0.55,
    ffmpegBgBlurSigma: 9,
    ffmpegBgFilter: "gblur=sigma=9",
    allowCssFilter: false,
    description:
      "Signature commercial cinema separation keeping the hero device razor-sharp against a softly defocused ambient plate.",
  },
  {
    id: "f/5.6",
    name: "Balanced Studio Stop (f/5.6)",
    fNumber: 5.6,
    depthOfField: "balanced",
    backgroundSeparation: 0.35,
    backgroundDimOpacity: 0.14,
    parallaxRatio: 0.78,
    ffmpegBgBlurSigma: 3,
    ffmpegBgFilter: "gblur=sigma=3",
    allowCssFilter: false,
    description:
      "Crisp multi-plane legibility ideal for split-screen comparisons, bento feature cards, and dense UI compositions.",
  },
  {
    id: "f/11",
    name: "Deep Focus Architectural (f/11)",
    fNumber: 11,
    depthOfField: "deep",
    backgroundSeparation: 0.08,
    backgroundDimOpacity: 0.04,
    parallaxRatio: 0.95,
    ffmpegBgBlurSigma: 0,
    ffmpegBgFilter: "null",
    allowCssFilter: false,
    description:
      "Edge-to-edge sharpness from foreground to horizon for wide reveals, locked-off hero plates, and architectural tableaux.",
  },
];

export const APERTURE_STOPS = buildDualCatalog(APERTURE_DEFINITIONS);

const DOP_PRESET_DEFINITIONS = [
  {
    id: "crash-zoom-in",
    name: "Crash Zoom In",
    category: "zoom",
    description: "High-velocity optical punch-in locking onto the hero action.",
    from: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.85, x: 0, y: -24, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "expo.out",
    durationRatio: 0.55,
  },
  {
    id: "dolly-in-slow",
    name: "Dolly In Slow",
    category: "dolly",
    description: "Deliberate motorized track push building narrative intimacy across the shot.",
    from: { scale: 1.0, x: 0, y: 12, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.18, x: 0, y: -12, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "sine.inOut",
    durationRatio: 1.0,
  },
  {
    id: "dolly-out-reveal",
    name: "Dolly Out Reveal",
    category: "dolly",
    description: "Starts tight on hero detail and pulls back smoothly to reveal the full stage.",
    from: { scale: 1.65, x: 0, y: -28, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "power4.out",
    durationRatio: 0.8,
  },
  {
    id: "whip-pan-left",
    name: "Whip Pan Left",
    category: "pan",
    description: "Kinetic lateral whip-pan entering with house-current leftward momentum.",
    from: { scale: 1.12, x: 220, y: 0, rotateX: 0, rotateY: -6, rotateZ: -1.5 },
    to: { scale: 1.02, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "expo.out",
    durationRatio: 0.48,
  },
  {
    id: "whip-pan-right",
    name: "Whip Pan Right",
    category: "pan",
    description: "Mirrored rightward lateral whip-pan settling cleanly onto center stage.",
    from: { scale: 1.12, x: -220, y: 0, rotateX: 0, rotateY: 6, rotateZ: 1.5 },
    to: { scale: 1.02, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "expo.out",
    durationRatio: 0.48,
  },
  {
    id: "isometric-3d-tilt-left",
    name: "Isometric 3D Tilt Left",
    category: "3d-tilt",
    description: "Dimensional 3D rotation angling the hero viewport leftward in perspective space.",
    from: { scale: 1.02, x: 24, y: 18, rotateX: 6, rotateY: -4, rotateZ: 0 },
    to: { scale: 1.24, x: -18, y: -12, rotateX: 14, rotateY: -16, rotateZ: -2 },
    ease: "power3.inOut",
    durationRatio: 0.85,
  },
  {
    id: "isometric-3d-tilt-right",
    name: "Isometric 3D Tilt Right",
    category: "3d-tilt",
    description:
      "Dimensional 3D rotation angling the hero viewport rightward in perspective space.",
    from: { scale: 1.02, x: -24, y: 18, rotateX: 6, rotateY: 4, rotateZ: 0 },
    to: { scale: 1.24, x: 18, y: -12, rotateX: 14, rotateY: 16, rotateZ: 2 },
    ease: "power3.inOut",
    durationRatio: 0.85,
  },
  {
    id: "crane-up-reveal",
    name: "Crane Up Reveal",
    category: "crane",
    description: "Jib-arm elevation rising smoothly from lower foreground to grand hero framing.",
    from: { scale: 1.14, x: 0, y: 140, rotateX: -8, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "power3.out",
    durationRatio: 0.82,
  },
  {
    id: "crane-down-land",
    name: "Crane Down Land",
    category: "crane",
    description: "Overhead jib descent landing decisively onto the primary hero composition.",
    from: { scale: 1.16, x: 0, y: -140, rotateX: 8, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "power3.out",
    durationRatio: 0.82,
  },
  {
    id: "orbit-float-cw",
    name: "Orbit Float Clockwise",
    category: "orbit",
    description: "Continuous clockwise gimbal arc sculpting parallax across layered UI depth.",
    from: { scale: 1.06, x: -32, y: 14, rotateX: 4, rotateY: -10, rotateZ: -1.5 },
    to: { scale: 1.16, x: 32, y: -14, rotateX: -3, rotateY: 10, rotateZ: 1.5 },
    ease: "sine.inOut",
    durationRatio: 1.0,
  },
  {
    id: "orbit-float-ccw",
    name: "Orbit Float Counter-Clockwise",
    category: "orbit",
    description: "Counter-clockwise gimbal arc sweeping across the subject with balanced depth.",
    from: { scale: 1.06, x: 32, y: 14, rotateX: 4, rotateY: 10, rotateZ: 1.5 },
    to: { scale: 1.16, x: -32, y: -14, rotateX: -3, rotateY: -10, rotateZ: -1.5 },
    ease: "sine.inOut",
    durationRatio: 1.0,
  },
  {
    id: "push-pull-vertigo",
    name: "Push-Pull Vertigo",
    category: "dolly",
    description: "Contrazoom Z-axis compression shift creating dramatic focal tension on the hero.",
    from: { scale: 0.94, x: 0, y: 18, rotateX: -5, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.42, x: 0, y: -18, rotateX: 6, rotateY: 0, rotateZ: 0 },
    ease: "power2.inOut",
    durationRatio: 0.95,
  },
  {
    id: "spotlight-cursor-200",
    name: "Spotlight Cursor 200%",
    category: "ui-focus",
    description: "200% precision magnification tracking an interactive cursor target.",
    from: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 2.0, x: -36, y: -28, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "power4.inOut",
    durationRatio: 0.72,
  },
  {
    id: "bottom-left-cta-zoom",
    name: "Bottom-Left CTA Zoom",
    category: "ui-focus",
    description: "Targeted optical punch-in framing a lower-left conversion button or action bar.",
    from: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.75, x: 140, y: -160, rotateX: 3, rotateY: 4, rotateZ: 0 },
    ease: "expo.out",
    durationRatio: 0.68,
  },
  {
    id: "top-right-badge-zoom",
    name: "Top-Right Badge Zoom",
    category: "ui-focus",
    description:
      "Targeted optical punch-in framing an upper-right status pill, price tag, or alert.",
    from: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.72, x: -140, y: 150, rotateX: -3, rotateY: -4, rotateZ: 0 },
    ease: "expo.out",
    durationRatio: 0.68,
  },
  {
    id: "bento-stagger-pop",
    name: "Bento Stagger Pop",
    category: "staging",
    description: "Tactile spring-settled stage arrival tailored for modular bento feature grids.",
    from: { scale: 0.92, x: 0, y: 36, rotateX: 6, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.04, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "back.out(1.4)",
    durationRatio: 0.6,
  },
  {
    id: "split-slide-duet",
    name: "Split Slide Duet",
    category: "staging",
    description: "Lateral editorial glide docking paired split-screen compositions into alignment.",
    from: { scale: 1.08, x: -96, y: 0, rotateX: 0, rotateY: 5, rotateZ: 0 },
    to: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "power3.out",
    durationRatio: 0.7,
  },
  {
    id: "hero-lockoff",
    name: "Hero Studio Lockoff",
    category: "lockoff",
    description:
      "Rock-solid tripod lockoff with imperceptible 2% forward tension to keep the frame alive.",
    from: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.02, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "none",
    durationRatio: 1.0,
  },
  {
    id: "handheld-micro-drift",
    name: "Handheld Micro Drift",
    category: "lockoff",
    description:
      "Deterministic single-arc shoulder-rig drift lending documentary realism without wobble loops.",
    from: { scale: 1.04, x: -10, y: 8, rotateX: 1.2, rotateY: -1.5, rotateZ: -0.6 },
    to: { scale: 1.08, x: 12, y: -8, rotateX: -1.0, rotateY: 1.5, rotateZ: 0.6 },
    ease: "sine.inOut",
    durationRatio: 1.0,
  },
  {
    id: "snap-punch-135",
    name: "Snap Punch 135%",
    category: "zoom",
    description: "Crisp editorial 1.35x beat-matched punch-in for high-tempo social cuts.",
    from: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.35, x: 0, y: -14, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "expo.out",
    durationRatio: 0.4,
  },
  {
    id: "glide-down-scroll",
    name: "Glide Down Scroll",
    category: "scroll",
    description:
      "Smooth vertical tracking shot scanning downward across long-form feeds or landing pages.",
    from: { scale: 1.15, x: 0, y: 90, rotateX: 2, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.15, x: 0, y: -130, rotateX: 2, rotateY: 0, rotateZ: 0 },
    ease: "power2.inOut",
    durationRatio: 0.92,
  },
  {
    id: "glide-up-scroll",
    name: "Glide Up Scroll",
    category: "scroll",
    description: "Reverse vertical tracking glide ascending back to the hero header.",
    from: { scale: 1.15, x: 0, y: -130, rotateX: -2, rotateY: 0, rotateZ: 0 },
    to: { scale: 1.15, x: 0, y: 90, rotateX: -2, rotateY: 0, rotateZ: 0 },
    ease: "power2.inOut",
    durationRatio: 0.92,
  },
  {
    id: "flip-card-reveal",
    name: "Flip Card Reveal",
    category: "transition",
    description: "Three-dimensional card swing unfolding onto the stage with controlled overshoot.",
    from: { scale: 0.88, x: 0, y: 42, rotateX: -28, rotateY: 22, rotateZ: -2 },
    to: { scale: 1.0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
    ease: "back.out(1.5)",
    durationRatio: 0.62,
  },
  {
    id: "outro-dock-left",
    name: "Outro Dock Left",
    category: "transition",
    description:
      "Settles and docks the hero frame leftward to clear visual space for closing CTA lockups.",
    from: { scale: 1.18, x: 80, y: 0, rotateX: 0, rotateY: -8, rotateZ: 0 },
    to: { scale: 0.94, x: -110, y: 0, rotateX: 0, rotateY: 6, rotateZ: 0 },
    ease: "power3.inOut",
    durationRatio: 0.78,
  },
];

export const DOP_CAMERA_PRESETS = buildDualCatalog(DOP_PRESET_DEFINITIONS);

function normalizeFocusCoord(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return 0.5;
  }
  if (num > 1) {
    return clamp(num / 100, 0, 1);
  }
  return clamp(num, 0, 1);
}

/**
 * Generates a deterministic, HyperFrames-compliant JavaScript snippet adding
 * `.fromTo(...)` camera motion onto a GSAP `tl` timeline.
 */
export function buildGsapCameraTweenCode({
  presetId,
  selector = "[data-camera-stage]",
  durationSeconds = 3.5,
  focusX = 0.5,
  focusY = 0.5,
  customScale = null,
  lens = "35mm",
} = {}) {
  const preset = DOP_CAMERA_PRESETS[presetId] || DOP_CAMERA_PRESETS["hero-lockoff"];
  const lensSpec = LENS_FOCAL_LENGTHS[lens] || LENS_FOCAL_LENGTHS["35mm"];
  const targetSelector = String(selector || "[data-camera-stage]");

  const safeSceneDuration = Math.max(0.1, Number(durationSeconds) || 3.5);
  const tweenDuration = round3(
    clamp(safeSceneDuration * preset.durationRatio, 0.1, safeSceneDuration),
  );

  const normFocusX = normalizeFocusCoord(focusX);
  const normFocusY = normalizeFocusCoord(focusY);
  const originX = round3(normFocusX * 100);
  const originY = round3(normFocusY * 100);

  let fromScale = preset.from.scale;
  let toScale = preset.to.scale;
  if (typeof customScale === "number" && Number.isFinite(customScale) && customScale > 0) {
    toScale = round3(customScale);
  } else if (customScale && typeof customScale === "object") {
    const customFrom = Number(customScale.from ?? customScale.fromScale);
    const customTo = Number(customScale.to ?? customScale.toScale);
    if (Number.isFinite(customFrom) && customFrom > 0) {
      fromScale = round3(customFrom);
    }
    if (Number.isFinite(customTo) && customTo > 0) {
      toScale = round3(customTo);
    }
  }

  // Shift destination translation subtly toward off-center focal points so zoomed targets frame cleanly
  const focalOffsetX = round3((0.5 - normFocusX) * 160);
  const focalOffsetY = round3((0.5 - normFocusY) * 160);
  const toX = round3(preset.to.x + focalOffsetX);
  const toY = round3(preset.to.y + focalOffsetY);

  const fromVars = {
    scale: fromScale,
    x: preset.from.x,
    y: preset.from.y,
    rotateX: preset.from.rotateX,
    rotateY: preset.from.rotateY,
    rotateZ: preset.from.rotateZ,
    transformOrigin: `${originX}% ${originY}%`,
    transformPerspective: lensSpec.perspectivePx,
  };

  const toVars = {
    scale: toScale,
    x: toX,
    y: toY,
    rotateX: preset.to.rotateX,
    rotateY: preset.to.rotateY,
    rotateZ: preset.to.rotateZ,
    duration: tweenDuration,
    ease: preset.ease,
    force3D: true,
  };

  return `tl.fromTo(${JSON.stringify(targetSelector)}, ${JSON.stringify(fromVars)}, ${JSON.stringify(toVars)}, 0);`;
}

const PRESET_SCORING_RULES = [
  {
    id: "spotlight-cursor-200",
    patterns: [
      [/\b200%\b|\b2x\s+cursor\b|\bspotlight\s+cursor\b/i, 14],
      [/\bcursor\b|\bpointer\b|\bspotlight\b|\bmagnif/i, 8],
      [/\bclick\b|\bhover\b/i, 4],
    ],
  },
  {
    id: "bottom-left-cta-zoom",
    patterns: [
      [/\bbottom[-\s]?left\b|\blower[-\s]?left\b/i, 14],
      [/\bcta\b|\bbuy\s+button\b|\border\s+button\b|\bcheckout\s+button\b/i, 6],
    ],
  },
  {
    id: "top-right-badge-zoom",
    patterns: [
      [/\btop[-\s]?right\b|\bupper[-\s]?right\b/i, 14],
      [/\bbadge\b|\bnotification\b|\bstatus\s+pill\b|\bprice\s+tag\b/i, 6],
    ],
  },
  {
    id: "push-pull-vertigo",
    patterns: [
      [/\bvertigo\b|\bdolly[-\s]?zoom\b|\bcontrazoom\b|\bzolly\b|\bhitchcock\b/i, 16],
      [/\bpush[-\s]?pull\b|\bwarp\s+perspective\b/i, 12],
    ],
  },
  {
    id: "crash-zoom-in",
    patterns: [
      [/\bcrash[-\s]?zoom\b|\brapid\s+zoom\b|\baggressive\s+zoom\b/i, 15],
      [/\bfast\s+zoom\b|\bhero\s+punch\b|\bzoom\s+in\s+fast\b/i, 10],
    ],
  },
  {
    id: "snap-punch-135",
    patterns: [
      [/\b135%\b|\bsnap[-\s]?punch\b|\b1\.35x\b/i, 15],
      [/\bjump[-\s]?cut\b|\bbeat\s+punch\b|\bsnappy\s+zoom\b|\bpunch[-\s]?in\b/i, 9],
    ],
  },
  {
    id: "dolly-in-slow",
    patterns: [
      [/\bslow\s+dolly\b|\bdolly[-\s]?in\b|\bgentle\s+push\b|\bpush\s+in\s+slow/i, 14],
      [/\bintimate\b|\bcreeping\b|\bslow\s+push\b/i, 8],
    ],
  },
  {
    id: "dolly-out-reveal",
    patterns: [
      [/\bdolly[-\s]?out\b|\bpull[-\s]?back\b|\bpull[-\s]?out\b|\bzoom[-\s]?out\b/i, 14],
      [/\bwide\s+reveal\b|\bestablish\s+context\b/i, 8],
    ],
  },
  {
    id: "whip-pan-right",
    patterns: [
      [/\bwhip[-\s]?pan\s+right\b|\bswipe\s+right\b|\bfast\s+pan\s+right\b|\bwhip\s+right\b/i, 16],
      [/\bpan\s+right\b/i, 9],
    ],
  },
  {
    id: "whip-pan-left",
    patterns: [
      [/\bwhip[-\s]?pan\s+left\b|\bswipe\s+left\b|\bfast\s+pan\s+left\b|\bwhip\s+left\b/i, 16],
      [/\bwhip[-\s]?pan\b|\bpan\s+left\b/i, 10],
    ],
  },
  {
    id: "isometric-3d-tilt-right",
    patterns: [
      [/\b3d\s+tilt\s+right\b|\bisometric\s+right\b|\btilt\s+right\b|\bangled\s+right\b/i, 16],
    ],
  },
  {
    id: "isometric-3d-tilt-left",
    patterns: [
      [/\b3d\s+tilt\s+left\b|\bisometric\s+left\b|\btilt\s+left\b|\bangled\s+left\b/i, 16],
      [/\bisometric\b|\b3d\s+tilt\b|\b3d\s+device\b|\b3d\s+showcase\b/i, 10],
    ],
  },
  {
    id: "crane-up-reveal",
    patterns: [
      [/\bcrane[-\s]?up\b|\bjib[-\s]?up\b|\brise\s+up\b|\bpedestal\s+up\b/i, 15],
      [/\belevat\w+\s+reveal\b|\brising\s+shot\b/i, 9],
    ],
  },
  {
    id: "crane-down-land",
    patterns: [
      [/\bcrane[-\s]?down\b|\bjib[-\s]?down\b|\bdescend\b|\btop[-\s]?down\s+land/i, 15],
      [/\bdrop\s+in\b|\blanding\s+shot\b/i, 9],
    ],
  },
  {
    id: "orbit-float-ccw",
    patterns: [
      [
        /\bcounter[-\s]?clockwise\b|\bccw\b|\borbit\s+ccw\b|\borbit\s+left\b|\breverse\s+orbit\b/i,
        16,
      ],
    ],
  },
  {
    id: "orbit-float-cw",
    patterns: [
      [/\borbit\s+cw\b|\bclockwise\b/i, 14],
      [/\borbit\b|\barc\s+around\b|\bturntable\b|\b360\b|\brevolve\b/i, 10],
    ],
  },
  {
    id: "bento-stagger-pop",
    patterns: [
      [/\bbento\b|\btriptych\b|\bfeature\s+grid\b|\bmulti[-\s]?card\b/i, 15],
      [/\bstagger\b|\bcollage\b|\bmodular\s+cards\b/i, 8],
    ],
  },
  {
    id: "split-slide-duet",
    patterns: [
      [/\bsplit[-\s]?screen\b|\bduet\b|\bside[-\s]?by[-\s]?side\b|\bsplit\s+slide\b/i, 15],
      [/\bbefore\s+(and|&|vs\.?)\s+after\b|\bcomparison\b|\btwo[-\s]?column\b/i, 9],
    ],
  },
  {
    id: "hero-lockoff",
    patterns: [
      [
        /\blockoff\b|\blocked[-\s]?off\b|\btripod\b|\bdeadpan\b|\bstatic\s+shot\b|\bstationary\b/i,
        15,
      ],
    ],
  },
  {
    id: "handheld-micro-drift",
    patterns: [
      [/\bhandheld\b|\bmicro[-\s]?drift\b|\bverite\b|\bdocumentary\b/i, 14],
      [/\borganic\s+drift\b|\bstreet\b|\bvlog\b|\bcandid\b/i, 8],
    ],
  },
  {
    id: "glide-down-scroll",
    patterns: [
      [
        /\bscroll\s+down\b|\bglide\s+down\b|\bpage\s+scroll\b|\bfeed\s+scroll\b|\blanding\s+page\s+scroll\b/i,
        15,
      ],
      [/\bscroll\b/i, 8],
    ],
  },
  {
    id: "glide-up-scroll",
    patterns: [
      [
        /\bscroll\s+up\b|\bglide\s+up\b|\bback\s+to\s+top\b|\breturn\s+to\s+top\b|\breverse\s+scroll\b/i,
        16,
      ],
    ],
  },
  {
    id: "flip-card-reveal",
    patterns: [
      [
        /\bflip[-\s]?card\b|\bcard\s+flip\b|\bunfold\b|\bflip\s+reveal\b|\b3d\s+card\s+swing\b/i,
        16,
      ],
    ],
  },
  {
    id: "outro-dock-left",
    patterns: [
      [
        /\boutro\b|\bdock\s+left\b|\bend[-\s]?card\b|\bclosing\s+cta\b|\bsign[-\s]?off\b|\bpackshot\b/i,
        16,
      ],
    ],
  },
];

const BODY_SCORING_RULES = [
  {
    id: "clean-ui-studio",
    patterns: [
      [/\bclean[-\s]?ui\b|\bsaas\b|\bdashboard\b|\bscreen\s+recording\b|\bapp\s+demo\b/i, 15],
      [/\bui\b|\bcursor\b|\bbento\b|\bcta\b|\bbadge\b|\bpixel\b|\bscroll\b|\bapple\b/i, 8],
    ],
  },
  {
    id: "kodak-35mm",
    patterns: [
      [/\bkodak\b|\b35mm\s+film\b|\bvision3\b|\bcelluloid\b/i, 16],
      [/\bwarm\s+film\b|\banalog\b|\bnostalgic\b|\bgolden\s+hour\b|\bfilm\s+grain\b/i, 10],
    ],
  },
  {
    id: "indie-16mm",
    patterns: [
      [/\b16mm\b|\bsuper\s*16\b|\bindie\b/i, 16],
      [/\bgritty\b|\bheavy\s+grain\b|\bvintage\b|\bretro\b|\blo[-\s]?fi\b/i, 10],
    ],
  },
  {
    id: "anamorphic-2x",
    patterns: [
      [/\banamorphic\b|\b2\.39\b|\bcinemascope\b|\bwidescreen\b|\b2x\s+scope\b/i, 16],
      [/\bepic\b|\bblockbuster\b|\bsci[-\s]?fi\b|\btrailer\b/i, 9],
    ],
  },
  {
    id: "handheld-doc",
    patterns: [
      [/\bhandheld\s+doc\b|\bverite\b|\breportage\b|\bjournalism\b/i, 15],
      [/\bhandheld\b|\bdocumentary\b|\bstreet\b|\bcandid\b|\bbts\b/i, 9],
    ],
  },
  {
    id: "modern-digital",
    patterns: [
      [/\bmodern[-\s]?digital\b|\barri\b|\balexa\b|\blarge\s+format\s+digital\b/i, 15],
      [/\bcommercial\b|\bluxury\b|\bmodern\b|\bproduct\s+launch\b/i, 6],
    ],
  },
];

const LENS_SCORING_RULES = [
  {
    id: "14mm",
    patterns: [
      [/\b14\s*mm\b/i, 25],
      [/\bultra[-\s]?wide\b|\bextreme\s+perspective\b|\bvertigo\b|\bcontrazoom\b/i, 12],
    ],
  },
  {
    id: "24mm",
    patterns: [
      [/\b24\s*mm\b/i, 25],
      [
        /\bwide[-\s]?angle\b|\bestablishing\b|\bcrane\b|\bwhip[-\s]?pan\b|\bisometric\b|\barchitecture\b/i,
        9,
      ],
    ],
  },
  {
    id: "35mm",
    patterns: [
      [/\b35\s*mm\b/i, 25],
      [/\bdocumentary\b|\bhandheld\b|\bstreet\b|\bstorytelling\b|\beditorial\b/i, 8],
    ],
  },
  {
    id: "50mm",
    patterns: [
      [/\b50\s*mm\b/i, 25],
      [/\bnatural\s+eye\b|\bhuman\s+eye\b|\bdashboard\b|\bsaas\b|\bbento\b|\bscroll\b/i, 8],
    ],
  },
  {
    id: "85mm",
    patterns: [
      [/\b85\s*mm\b/i, 25],
      [/\bportrait\b|\btelephoto\b|\bclose[-\s]?up\b|\bmacro\b|\bbokeh\b/i, 12],
      [/\b200%\b|\bcta\b|\bbadge\b|\bdetail\b/i, 7],
    ],
  },
];

const APERTURE_SCORING_RULES = [
  {
    id: "f/1.4",
    patterns: [
      [/\bf\/?1\.4\b/i, 25],
      [
        /\bshallow\b|\bbokeh\b|\bwide[-\s]?open\b|\bdreamy\b|\bportrait\b|\bmacro\b|\bintimate\b/i,
        12,
      ],
    ],
  },
  {
    id: "f/2.8",
    patterns: [
      [/\bf\/?2\.8\b/i, 25],
      [/\bcinematic\b|\bcommercial\b|\banamorphic\b|\bkodak\b|\bhero\b/i, 7],
    ],
  },
  {
    id: "f/5.6",
    patterns: [
      [/\bf\/?5\.6\b/i, 25],
      [/\bsaas\b|\bdashboard\b|\bui\b|\bbento\b|\bsplit\b|\bscroll\b|\btutorial\b/i, 10],
    ],
  },
  {
    id: "f/11",
    patterns: [
      [/\bf\/?11(?!\.)\b/i, 25],
      [
        /\bdeep[-\s]?focus\b|\beverything\s+sharp\b|\binfinite\s+focus\b|\barchitecture\b|\blandscape\b|\blockoff\b/i,
        12,
      ],
    ],
  },
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreCatalogCategory(text, catalog, rules, fallbackId, { matchExactId = true } = {}) {
  if (!text) {
    return fallbackId;
  }

  const scores = new Map();
  for (const item of catalog) {
    scores.set(item.id, 0);
    if (matchExactId) {
      const idToken = escapeRegExp(item.id.toLowerCase());
      const spacedToken = escapeRegExp(item.id.toLowerCase().replaceAll("-", " "));
      const exactRegex = new RegExp(`(^|[^a-z0-9])(${idToken}|${spacedToken})(?=$|[^a-z0-9])`, "i");
      if (exactRegex.test(text)) {
        scores.set(item.id, 24);
      }
    }
  }

  for (const rule of rules) {
    let current = scores.get(rule.id) || 0;
    for (const [regex, weight] of rule.patterns) {
      if (regex.test(text)) {
        current += weight;
      }
    }
    scores.set(rule.id, current);
  }

  let bestId = fallbackId;
  let bestScore = 0;
  for (const [id, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Deterministically scores a natural-language prompt and recommends a cohesive
 * DoP camera rig `{ presetId, cameraBody, lens, aperture }`.
 */
export function recommendRigForPrompt(promptText) {
  const normalized = typeof promptText === "string" ? promptText.trim().toLowerCase() : "";

  // Strip 35mm/16mm film-stock phrases when scoring focal length so "Kodak 35mm film portrait"
  // selects an 85mm portrait lens rather than mistaking film gauge for focal length.
  const lensText = normalized
    .replace(/\bkodak[-\s]?35\s*mm(\s+film|\s+stock|\s+celluloid)?\b/gi, "kodak film")
    .replace(/\b35\s*mm\s+(film|stock|celluloid|grain|emulation)\b/gi, "film stock")
    .replace(/\bindie[-\s]?16\s*mm\b|\bsuper\s*16\s*mm\b|\b16\s*mm(\s+film|\s+stock)?\b/gi, "film");

  const presetId = scoreCatalogCategory(
    normalized,
    DOP_CAMERA_PRESETS,
    PRESET_SCORING_RULES,
    "dolly-in-slow",
  );
  const cameraBody = scoreCatalogCategory(
    normalized,
    CAMERA_BODIES,
    BODY_SCORING_RULES,
    "modern-digital",
  );
  const lens = scoreCatalogCategory(lensText, LENS_FOCAL_LENGTHS, LENS_SCORING_RULES, "35mm", {
    matchExactId: false,
  });
  const aperture = scoreCatalogCategory(
    normalized,
    APERTURE_STOPS,
    APERTURE_SCORING_RULES,
    "f/2.8",
    {
      matchExactId: false,
    },
  );

  return {
    presetId,
    cameraBody,
    lens,
    aperture,
  };
}
