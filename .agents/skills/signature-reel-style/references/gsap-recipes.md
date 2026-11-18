# Signature Reel Style — Deterministic GSAP Recipes (`gsap-recipes.md`)

Every snippet below strictly obeys the `/hyperframes` deterministic contract:

- **Never** target an element carrying `class="clip"` with GSAP (`gsap_animates_clip_element`). Always animate inner `.swrap` or child elements.
- **Never** declare CSS `transform` on any element that GSAP animates (`gsap_css_transform_conflict`). Set all initial transforms via `gsap.set(...)` or `tl.fromTo(..., { immediateRender: false })`.
- Put gradient `background-clip: text` on an inner static `<span>`, never on a transformed parent.
- Register one paused root timeline per composition at `window.__timelines["main"] = tl`.

---

## Recipe 1 · Hook: Giant Gradient Numeral + Behind-Shoulder 3D Glass Badges

stack order when using a speaker cutout (`npx hyperframes remove-background`):
`z-index: 1` background footage (`muted` or `data-has-audio="true"`) -> `z-index: 2` hook numeral & 3D badges -> `z-index: 3` transparent WebM cutout (`muted data-layout-allow-occlusion`).

```html
<div id="beat-hook" class="slide clip" data-start="0" data-duration="3.2" data-track-index="1">
  <div id="w-hook" class="swrap">
    <div
      id="hook-header"
      style="position:absolute; top:300px; left:132px; right:132px; display:flex; align-items:center; gap:28px;"
    >
      <div id="hook-num" style="line-height:0.85;">
        <span class="grad-num">3</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div
          id="hook-kicker"
          style="font-family:'Inter',sans-serif; font-weight:700; font-size:40px; color:#ffffff;"
        >
          Before you send
        </div>
        <div
          id="hook-punch"
          style="font-family:'Montserrat',sans-serif; font-weight:900; font-size:68px; line-height:0.96; letter-spacing:-0.03em; color:var(--accent); text-shadow:0 0 28px var(--accent-glow);"
        >
          SECRET DMs
        </div>
      </div>
    </div>

    <div
      id="badge-left"
      class="glass-badge"
      style="position:absolute; top:690px; left:120px; width:192px; height:192px;"
    >
      <span
        style="font-family:'Inter',sans-serif; font-weight:800; font-size:28px; color:var(--accent);"
        >Direct</span
      >
    </div>
    <div
      id="badge-right"
      class="glass-badge"
      style="position:absolute; top:710px; right:120px; width:260px; height:176px;"
    >
      <span style="font-family:'Inter',sans-serif; font-weight:800; font-size:30px; color:#ffffff;"
        >Messages</span
      >
    </div>
  </div>
</div>
```

```js
// Frame-measured timings (@30fps): f2 (0.067s) numeral rise, f4 (0.133s) 3D badges, f16 (0.533s) punch line
tl.set("#w-hook", { autoAlpha: 1 }, 0);
tl.fromTo(
  "#hook-num",
  { opacity: 0, y: 54, filter: "blur(10px)" },
  {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    duration: 0.2,
    ease: "power4.out",
    immediateRender: false,
  },
  0.066666,
);
tl.fromTo(
  "#hook-kicker",
  { opacity: 0, y: 18, filter: "blur(12px)" },
  {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    duration: 0.2,
    ease: "power3.out",
    immediateRender: false,
  },
  0.133333,
);
tl.fromTo(
  "#badge-left",
  { opacity: 0, y: 96, scale: 0.86, rotation: -4 },
  {
    opacity: 1,
    y: 0,
    scale: 1,
    rotation: -12,
    duration: 0.333333,
    ease: "power4.out",
    immediateRender: false,
  },
  0.133333,
);
tl.fromTo(
  "#badge-right",
  { opacity: 0, y: 96, scale: 0.86, rotation: 4 },
  {
    opacity: 1,
    y: 0,
    scale: 1,
    rotation: 11,
    duration: 0.333333,
    ease: "power4.out",
    immediateRender: false,
  },
  0.166666,
);
tl.fromTo(
  "#hook-punch",
  { opacity: 0, y: 20, filter: "blur(14px)" },
  {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    duration: 0.233333,
    ease: "power3.out",
    immediateRender: false,
  },
  0.533333,
);
```

---

## Recipe 2 · Hook Variant: 3 Glowing Frosted Glass Number Orbs (`7-Frame` Drop-Bounce)

```html
<div id="orbs-cluster" style="position:absolute; top:980px; left:240px; width:600px; height:400px;">
  <div id="orb-1" class="glass-orb" style="position:absolute; top:0; left:72px;">1</div>
  <div id="orb-2" class="glass-orb" style="position:absolute; top:0; left:332px;">2</div>
  <div id="orb-3" class="glass-orb" style="position:absolute; top:188px; left:202px;">3</div>
</div>
```

```css
.glass-orb {
  width: 196px;
  height: 196px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Montserrat", sans-serif;
  font-weight: 900;
  font-size: 86px;
  color: #ffffff;
  background: radial-gradient(
    100% 90% at 50% 95%,
    var(--accent-glow) 0%,
    rgba(20, 18, 30, 0.92) 72%
  );
  border: 3px solid rgba(255, 224, 150, 0.78);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.55),
    0 0 28px var(--accent-glow);
}
```

```js
["#orb-1", "#orb-2", "#orb-3"].forEach((sel, idx) => {
  const at = 0.2 + idx * 0.233333; // 7-frame stagger
  tl.fromTo(
    sel,
    { opacity: 0, y: -64, scale: 0.76, filter: "blur(12px)" },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      duration: 0.233333,
      ease: "back.out(1.65)",
      immediateRender: false,
    },
    at,
  );
});
```

---

## Recipe 3 · Chest-Zone Optical Blur-Morph Ladder + Italic Serif Climax + SVG Underline

```html
<div
  id="ladder-1"
  style="position:absolute; top:1050px; left:120px; right:120px; display:flex; flex-direction:column; align-items:center; text-align:center;"
>
  <div id="l1-w1" class="ladder-primary">That is</div>
  <div id="l1-w2" class="ladder-bridge">your favorite</div>
  <div id="l1-w3" class="ladder-serif-accent">excuse</div>
  <div id="l1-w4" class="ladder-primary" style="position:relative;">
    every day.
    <svg
      width="320"
      height="22"
      viewBox="0 0 320 22"
      style="position:absolute; left:10px; bottom:-14px; overflow:visible;"
      data-layout-ignore
    >
      <path
        id="l1-underline"
        d="M 6 15 Q 160 5 314 13"
        fill="none"
        stroke="#ffffff"
        stroke-width="5"
        stroke-linecap="round"
        stroke-dasharray="320"
        stroke-dashoffset="320"
      />
    </svg>
  </div>
</div>
```

```css
.ladder-primary {
  font-family: "Inter", sans-serif;
  font-weight: 800;
  font-size: 70px;
  line-height: 0.95;
  letter-spacing: -0.03em;
  color: var(--ink-primary);
}
.ladder-bridge {
  font-family: "Inter", sans-serif;
  font-weight: 600;
  font-size: 48px;
  line-height: 0.98;
  letter-spacing: -0.02em;
  color: var(--ink-primary);
}
.ladder-serif-accent {
  font-family: "Playfair Display", serif;
  font-style: italic;
  font-weight: 700;
  font-size: 88px;
  line-height: 0.94;
  color: var(--accent);
  text-shadow: 0 0 30px var(--accent-glow);
}
```

```js
// 6-frame (0.20s) optical blur-morph per accumulated line, then 6-frame staggered top-down blur exit
const entries = [
  ["#l1-w1", 3.266666],
  ["#l1-w2", 3.533333],
  ["#l1-w3", 3.8],
  ["#l1-w4", 4.133333],
];
entries.forEach(([sel, t]) => {
  tl.fromTo(
    sel,
    { opacity: 0, y: 18, filter: "blur(14px)" },
    {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      duration: 0.2,
      ease: "power3.out",
      immediateRender: false,
    },
    t,
  );
});
tl.fromTo(
  "#l1-underline",
  { strokeDashoffset: 320 },
  { strokeDashoffset: 0, duration: 0.266666, ease: "power3.out", immediateRender: false },
  4.233333,
);

// Staggered top-to-bottom optical blur dissolve at cluster end (t = 5.70s)
["#l1-w1", "#l1-w2", "#l1-w3", "#l1-w4"].forEach((sel, i) => {
  const outAt = 5.7 + i * 0.033333;
  tl.to(sel, { opacity: 0, y: -10, filter: "blur(16px)", duration: 0.2, ease: "power2.in" }, outAt);
});
tl.set("#ladder-1", { opacity: 0, visibility: "hidden" }, 5.966666);
```

---

## Recipe 4 · Step Progress Tracker `(1) — 2 — 3` Bloom + Vertical `Trick` Capsule

```html
<div
  id="step-tracker"
  style="position:absolute; top:216px; left:0; right:0; display:flex; justify-content:center; align-items:center; gap:20px;"
>
  <div id="step-dot-1" class="step-dot step-active">1</div>
  <div class="step-line"></div>
  <div id="step-dot-2" class="step-dot">2</div>
  <div class="step-line"></div>
  <div id="step-dot-3" class="step-dot">3</div>
</div>

<div
  id="trick-pill"
  style="position:absolute; top:360px; right:120px; width:132px; height:232px; border-radius:999px; background:var(--accent); color:var(--ink-dark); display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:28px 16px;"
>
  <span style="font-family:'Inter',sans-serif; font-weight:800; font-size:28px;">Trick</span>
  <svg
    width="56"
    height="56"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
  >
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M3 3l18 18" />
  </svg>
</div>
```

```js
tl.fromTo(
  "#step-dot-1",
  { scale: 1.36, boxShadow: "0 0 44px #ffffff" },
  {
    scale: 1,
    boxShadow: "0 0 18px var(--accent-glow)",
    duration: 0.4,
    ease: "expo.out",
    immediateRender: false,
  },
  0.066666,
);
tl.fromTo(
  "#trick-pill",
  { opacity: 0, scale: 0.78, x: 28 },
  { opacity: 1, scale: 1, x: 0, duration: 0.266666, ease: "back.out(1.4)", immediateRender: false },
  0.733333,
);
```

---

## Recipe 5 · White Chapter Card with `6-Frame` Neon-Tube Flicker & Blurred Foreground Mark

```html
<div
  id="chapter-card"
  style="position:absolute; inset:0; background:#ffffff; overflow:hidden;"
  data-layout-allow-overflow
>
  <!-- Blurred oversized brand shape on right edge -->
  <div
    id="chapter-depth-mark"
    style="position:absolute; top:380px; right:-110px; font-family:'Montserrat',sans-serif; font-weight:900; font-size:760px; line-height:0.8; color:#f89c2d; filter:blur(10px);"
    data-layout-ignore
  >
    B
  </div>

  <!-- Outlined neon-tube numeral + solid brand name -->
  <div
    style="position:absolute; top:680px; left:148px; display:flex; flex-direction:column; align-items:flex-start;"
  >
    <div
      id="chapter-neon-num"
      style="font-family:'Montserrat',sans-serif; font-weight:900; font-size:240px; line-height:0.88; color:transparent; -webkit-text-stroke:5px #7c3aed; filter:drop-shadow(0 0 24px rgba(124,58,237,0.55));"
    >
      1
    </div>
    <div
      id="chapter-brand-title"
      style="font-family:'Montserrat',sans-serif; font-weight:900; font-size:92px; letter-spacing:-0.03em; color:#2e1065;"
    >
      DefiLlama
    </div>
  </div>
</div>
```

```js
// Exact 6-frame (1-frame = 0.033333s) neon-tube ignition strobe measured on Reel 2 frames 182..188
const t0 = 6.0;
tl.set("#chapter-neon-num", { opacity: 1 }, t0);
tl.set("#chapter-neon-num", { opacity: 0.08 }, t0 + 0.033333);
tl.set("#chapter-neon-num", { opacity: 1 }, t0 + 0.066666);
tl.set("#chapter-neon-num", { opacity: 0.08 }, t0 + 0.1);
tl.set("#chapter-neon-num", { opacity: 1 }, t0 + 0.133333);
tl.set("#chapter-neon-num", { opacity: 0.12 }, t0 + 0.166666);
tl.set("#chapter-neon-num", { opacity: 1 }, t0 + 0.2);

tl.fromTo(
  "#chapter-brand-title",
  { opacity: 0, x: -24, filter: "blur(12px)" },
  {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    duration: 0.233333,
    ease: "power3.out",
    immediateRender: false,
  },
  t0 + 0.233333,
);
```

---

## Recipe 6 · Dotted-Matrix 3D Perspective iPhone Showcase + Neon Target Highlight Box

```html
<div
  id="device-stage"
  style="position:absolute; inset:0; background-color:var(--bg-ground); background-image:radial-gradient(rgba(255,255,255,0.10) 1.5px, transparent 1.5px); background-size:24px 24px;"
>
  <div
    style="position:absolute; top:-120px; left:-80px; width:760px; height:760px; border-radius:50%; background:radial-gradient(circle, var(--bg-glow) 0%, rgba(0,0,0,0) 70%);"
    data-layout-ignore
  ></div>

  <div
    id="device-caption"
    style="position:absolute; top:252px; left:120px; right:120px; text-align:center; font-family:'Inter',sans-serif; font-weight:700; font-size:52px; letter-spacing:-0.02em; color:#ffffff;"
  >
    Open Privacy &amp; Safety
  </div>

  <div
    id="phone-3d-rig"
    style="position:absolute; top:380px; left:190px; width:700px; height:1320px; border-radius:72px; background:#121417; border:8px solid #3a3f47; box-shadow:0 40px 90px rgba(0,0,0,0.78); padding:36px; overflow:hidden;"
    data-layout-allow-overflow
  >
    <!-- Mockup UI rows -->
    <div style="margin-top:96px; display:flex; flex-direction:column; gap:28px;">
      <div class="ui-row">Theme &amp; Wallpaper</div>
      <div class="ui-row" style="position:relative;">
        Privacy &amp; Safety
        <div
          id="ui-neon-box"
          style="position:absolute; inset:-10px -14px; border:4px solid var(--accent); border-radius:24px; box-shadow:0 0 28px var(--accent-glow); pointer-events:none;"
        ></div>
      </div>
      <div class="ui-row">Disappearing Messages</div>
    </div>
  </div>
</div>
```

```js
// 8-frame (0.267s) slide-up arrival, 8-frame neon target box, 10-frame (0.333s) 3D perspective swing
tl.fromTo(
  "#device-caption",
  { opacity: 0, y: 16, filter: "blur(10px)" },
  {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    duration: 0.2,
    ease: "power3.out",
    immediateRender: false,
  },
  6.066666,
);
tl.fromTo(
  "#phone-3d-rig",
  { opacity: 0, y: 210, scale: 0.95, rotationY: 0, rotationX: 0, transformPerspective: 1400 },
  {
    opacity: 1,
    y: 0,
    scale: 1,
    rotationY: 0,
    rotationX: 0,
    transformPerspective: 1400,
    duration: 0.266666,
    ease: "power4.out",
    immediateRender: false,
  },
  6.033333,
);
tl.fromTo(
  "#ui-neon-box",
  { opacity: 0, scale: 1.06 },
  { opacity: 1, scale: 1, duration: 0.266666, ease: "power3.out", immediateRender: false },
  6.566666,
);
// 3D perspective swing (Reel 1 frames 682..692)
tl.to(
  "#phone-3d-rig",
  {
    rotationY: -15,
    rotationX: 4,
    transformPerspective: 1400,
    duration: 0.333333,
    ease: "power3.inOut",
  },
  7.4,
);
```

---

## Recipe 7 · Frosted Dark Glass Feature Pills with Counter-Vertical Split-Slot Text Reveal

Measured on Reel 2 frames `494..514`: the glass pill shell expands in `8 frames`, then the two halves of the label slide in **opposing vertical directions** (`+56px` and `-56px`) inside an `overflow: hidden` slot mask over `12 frames (0.40s)`.

```html
<div
  id="pill-1"
  class="feature-pill"
  style="position:absolute; top:1060px; left:210px; width:660px; height:136px;"
>
  <div class="pill-icon-box">$</div>
  <div
    class="pill-slot-mask"
    style="overflow:hidden; height:64px; display:flex; align-items:center; gap:12px;"
    data-layout-allow-overflow
  >
    <span id="pill-1-tok-a" class="pill-label">Open</span>
    <span id="pill-1-tok-b" class="pill-label">Interest</span>
  </div>
</div>
```

```js
tl.fromTo(
  "#pill-1",
  { opacity: 0, scaleX: 0.86, y: 24, filter: "blur(8px)" },
  {
    opacity: 1,
    scaleX: 1,
    y: 0,
    filter: "blur(0px)",
    duration: 0.266666,
    ease: "power3.out",
    immediateRender: false,
  },
  9.266666,
);
tl.fromTo(
  "#pill-1-tok-a",
  { opacity: 0, y: 56 },
  { opacity: 1, y: 0, duration: 0.4, ease: "power4.out", immediateRender: false },
  9.4,
);
tl.fromTo(
  "#pill-1-tok-b",
  { opacity: 0, y: -56 },
  { opacity: 1, y: 0, duration: 0.4, ease: "power4.out", immediateRender: false },
  9.433333,
);
```

---

## Recipe 8 · Camera Wrapper Slow Creep + Instant Punch-In Save / Handle CTA

Never animate `scale` on `<video class="clip">`. Wrap the `<video>` (or wrap the `<video>` + cutout together) inside `#cam-rig` and drive `#cam-rig` on the root timeline:

```html
<div
  id="cam-stage"
  class="clip"
  data-start="0"
  data-duration="12"
  data-track-index="0"
  style="position:absolute; inset:0; overflow:hidden;"
  data-layout-allow-overflow
>
  <div id="cam-rig" style="position:absolute; inset:0; transform-origin:50% 38%;">
    <video
      id="a-roll"
      src="assets/speaker.mp4"
      playsinline
      data-has-audio="true"
      style="position:absolute; left:0; top:0; width:1080px; height:1920px; object-fit:cover;"
    ></video>
  </div>
</div>
```

```js
// Slow 1.00 -> 1.06 push during opening hook, then instant 1.28x punch-in on emphasis/Save beat
tl.fromTo(
  "#cam-rig",
  { scale: 1.0 },
  { scale: 1.06, duration: 2.8, ease: "none", immediateRender: false },
  0,
);
tl.set("#cam-rig", { scale: 1.28, y: 36 }, 2.8);
tl.to("#cam-rig", { scale: 1.32, duration: 2.0, ease: "none" }, 2.8);
tl.set("#cam-rig", { scale: 1.0, y: 0 }, 4.8);
```
