# Signature Reel Style — Numerical Specification (`style-spec.md`)

All measurements below were extracted frame-by-frame (`30 fps`) and pixel-sampled (`RGB24`) from the 3 reference reels in `inspiration/`, then normalized by exact `1.5x` scale from `720x1280` source capture to **`1080x1920` (`9:16`, `30 fps`)**.

---

## 1 · Source Forensics Baseline

| Metric               | Reference Reel 1 (`52f9...mp4`)                                                                 | Reference Reel 2 (`af22...mp4`)                                                      | Reference Reel 3 (`b156...mp4`)                                                         | Unified Target Spec                              |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Canvas & Rate**    | `720x1280` -> `1080x1920` @ `30 fps`                                                            | `720x1280` -> `1080x1920` @ `30 fps`                                                 | `720x1280` -> `1080x1920` @ `30 fps`                                                    | `1080x1920`, `data-fps="30"`                     |
| **Duration & Cuts**  | `42.433s` (`1273f`), `14` major cuts                                                            | `22.400s` (`672f`), `9` major cuts                                                   | `19.567s` (`587f`), `11` major cuts                                                     | Avg major cut every `1.8s–3.0s`                  |
| **Integrated Audio** | `-14.1 LUFS`, LRA `2.2 LU`, Peak `-2.2 dBFS`                                                    | `-15.6 LUFS`, LRA `3.5 LU`, Peak `-0.5 dBFS`                                         | `-14.2 LUFS`, LRA `1.4 LU`, Peak `-1.0 dBFS`                                            | `-14.2 LUFS`, LRA `<= 2.5 LU`, Peak `-1.0 dBFS`  |
| **Dominant Ground**  | `#09060c` + `#35480d` radial top-left glow                                                      | `#0d0a18` + `#ffffff` chapter flash cards                                            | `#060606` crushed moody studio                                                          | `#09060c` dark studio (`#ffffff` contrast cards) |
| **Peak Accent Hex**  | Electric Lime `#e9ff00`                                                                         | Electric Violet `#ba8eff` + Amber `#f89c2d`                                          | Crimson `#e6000c` + Mint `#4ade80`                                                      | 1 high-voltage accent per reel                   |
| **Signature Moves**  | Behind-shoulder 3D glass icons, `(1)—2—3` tracker, `Trick` pill, 3D `rotateY` iPhone + neon box | `7f` drop-bounce glass orbs, neon-flicker `1/2` chapter card, split-slot glass pills | `6f` optical blur-morph chest ladder, Italic Serif climax word, `8f` SVG underline/oval | All 8 primitives available in `gsap-recipes.md`  |

---

## 2 · Canvas, Safe Zones & Optical Anchor Grid (`1080x1920`)

- **Canvas**: `width: 1080px`, `height: 1920px`, `fps: 30` (`1 frame = 0.033333s`).
- **Platform UI Keep-Clear Zones**:
  - Top status/search bar clear: `y = 0px..192px` (no readable text above `y = 192px`).
  - Right-hand social action rail clear: `x = 936px..1080px` for `y = 1080px..1760px`.
  - Bottom handle/caption deck clear: `y = 1728px..1920px` (only full-bleed footage, device bottom bezel, or ambient glow may extend here; never readable copy).
  - Horizontal title-safe box for all typography & pills: `x = 108px..972px` (`max-width: 864px`).
- **Vertical Focal Anchors (Where Elements Sit)**:
  - **Step Progress Tracker `(1) — 2 — 3`**: Centered horizontally (`x = 540px`), `top = 216px` (`height: 64px`).
  - **Upper Header / Hook Numeral & Title Stack (Scene Mode A — Medium Shot)**: `top = 310px..620px`, `left = 120px..960px` (sits cleanly above or behind subject's head at `y >= 600px`).
  - **Device Showcase Top Instruction Line**: Centered horizontally, `top = 248px..316px` (sits `48px` above the iPhone top bezel).
  - **3D Device Mockup Slot**: Centered horizontally (`left = 180px`, `width = 720px`, `height = 1460px`), `top = 372px` (extends cleanly to `1832px` as hardware frame, with interactive UI target rows inside `y = 520px..1480px`).
  - **Chest Optical Focal Zone (Talking-Head Kinetic Ladder & Glass Pills)**: `top = 1040px..1320px` (`54.2%–68.7%` of height — directly over upper chest/collarbone, never covering chin/mouth and never buried at bottom edge).

---

## 3 · Color System & Surface Recipes (`LOOK`)

Choose **one** preset per video by setting CSS custom properties on `:root`:

### Preset A · `lime-noir` (Default — Tech / Social / Tutorial)

- `--bg-ground`: `#09060c`
- `--bg-glow`: `rgba(116, 178, 18, 0.34)` (radial `680px` spotlight at `22% 18%`)
- `--ink-primary`: `#ffffff`
- `--ink-dark`: `#09060c` (used on solid `--accent` pills/circles)
- `--ink-muted`: `rgba(255, 255, 255, 0.68)`
- `--accent`: `#e9ff00`
- `--accent-mid`: `#9bc800`
- `--accent-glow`: `rgba(233, 255, 0, 0.48)`

### Preset B · `violet-studio` (Finance / SaaS / Tools / Agency)

- `--bg-ground`: `#0d0a18`
- `--bg-glow`: `rgba(124, 58, 237, 0.38)` (radial `740px` spotlight at `50% 16%`)
- `--ink-primary`: `#ffffff` (switches to `#111115` over bright shirts or `#ffffff` chapter cards)
- `--ink-dark`: `#111115`
- `--ink-muted`: `rgba(240, 238, 255, 0.70)`
- `--accent`: `#ba8eff`
- `--accent-mid`: `#7c3aed`
- `--accent-secondary`: `#f89c2d` (orb rim / depth mark accent)
- `--accent-glow`: `rgba(186, 142, 255, 0.52)`

### Preset C · `crimson-editorial` (Mindset / Storytelling / Opinion / Coaching)

- `--bg-ground`: `#060606`
- `--bg-glow`: `rgba(230, 0, 12, 0.18)` (subtle low-contrast warm rim)
- `--ink-primary`: `#ffffff`
- `--ink-dark`: `#060606`
- `--ink-muted`: `rgba(255, 255, 255, 0.64)`
- `--accent`: `#e6000c`
- `--accent-mid`: `#ff3341`
- `--accent-secondary`: `#4ade80` (thin `2.5px` SVG oval/underline micro-annotation)
- `--accent-glow`: `rgba(230, 0, 12, 0.55)`

### Material & Surface Tokens

- **Dotted Matrix Studio Stage (Device Showcase Ground)**:
  - Base `#09060c` + `background-image: radial-gradient(rgba(255, 255, 255, 0.10) 1.5px, transparent 1.5px); background-size: 24px 24px;` + radial spotlight `--bg-glow`.
- **Frosted Dark Glass Card / Pill / Orb**:
  - Fill: `linear-gradient(180deg, rgba(26, 26, 36, 0.84) 0%, rgba(16, 15, 24, 0.92) 100%)` with internal bottom radial accent bloom `radial-gradient(120% 90% at 50% 100%, var(--accent-glow) 0%, rgba(0,0,0,0) 70%)`.
  - Rim border: `2px solid rgba(255, 255, 255, 0.22)` (or `2.5px solid var(--accent)` on highlighted cards).
  - Radius: `34px` on feature pills (`620x136px`), `38px` on floating 3D app icons (`188x188px`), `999px` on circular orbs (`196x196px`) and vertical `Trick` capsules (`132x236px`).
  - Shadow: `0 24px 56px rgba(0, 0, 0, 0.62)`.
- **Giant Gradient Step Numeral (`1`, `2`, `3`)**:
  - `background: linear-gradient(180deg, var(--accent) 0%, var(--accent-mid) 56%, rgba(0, 0, 0, 0) 100%); -webkit-background-clip: text; color: transparent;` (applied on an inner static `<span>`, never on the GSAP-transformed parent).

---

## 4 · Typography & Caption Scale (`TYPOGRAPHY`)

Uses HyperFrames bundled fonts only (zero runtime network fetches):

| Role                         | Font Family & Weight            | Size (`1080x1920`) | Line Height | Tracking  | Notes                                                      |
| ---------------------------- | ------------------------------- | ------------------ | ----------- | --------- | ---------------------------------------------------------- |
| **Giant Step Numeral**       | `Montserrat` `900`              | `260px`            | `0.85`      | `-0.04em` | Vertical gradient fade to transparent at bottom            |
| **Hero Hook / Accent Punch** | `Montserrat` or `Inter` `900`   | `84px–98px`        | `0.95`      | `-0.03em` | `var(--accent)` + `0 0 28px var(--accent-glow)`            |
| **Editorial Climax Word**    | `Playfair Display` `700 italic` | `82px–92px`        | `0.94`      | `-0.01em` | Used on 1 emotional/key word per ladder (Reel 3 signature) |
| **Chest Ladder Primary**     | `Inter` `800`                   | `66px–74px`        | `0.94`      | `-0.03em` | Tight stacked 1–3 words per line, centered                 |
| **Chest Ladder Bridge**      | `Inter` `600`                   | `46px–50px`        | `0.98`      | `-0.02em` | Connector words (`a sua`, `other crypto`, `apenas`)        |
| **Device Top Instruction**   | `Inter` `700`                   | `50px–54px`        | `1.15`      | `-0.02em` | Single clean line at `top: 256px`, `#ffffff`               |
| **Glass Pill Label**         | `Inter` `700`                   | `46px`             | `1.00`      | `-0.02em` | Inside `overflow: hidden` slot mask                        |
| **UI / Prompt Command**      | `JetBrains Mono` `700`          | `32px–38px`        | `1.20`      | `-0.01em` | For `@handle`, `/imagine`, or UI tags                      |

### Caption & Ladder Rules

1. **Word Density**: `1–3` words per stacked line; accumulate `2–4` lines in one tight chest cluster (`gap: 2px`), hold the completed thought `0.45s–0.75s`, then blur-dissolve the whole cluster top-to-bottom in `0.20s` before starting the next cluster.
2. **Start Offset**: First text or graphic starts at `f2–f5` (`0.067s–0.167s`), never pre-baked on frame `0`.
3. **Hard Visibility Kill**: Every transient ladder or caption group finishes with `tl.set(selector, { opacity: 0, visibility: "hidden" }, endSec)`.

---

## 5 · Frame-Exact Motion & GSAP Curve Table (`MOTION`)

| Motion Primitive                   | Frames (`@30fps`)        | Seconds     | Start State (`fromTo`)                                    | End State (`fromTo`)                                       | GSAP Ease               |
| ---------------------------------- | ------------------------ | ----------- | --------------------------------------------------------- | ---------------------------------------------------------- | ----------------------- |
| **Optical Blur-Morph Line In**     | `6f`                     | `0.20s`     | `opacity: 0, y: 18, filter: "blur(14px)"`                 | `opacity: 1, y: 0, filter: "blur(0px)"`                    | `power3.out`            |
| **Optical Blur-Morph Cluster Out** | `6f` (`+1f` stagger)     | `0.20s`     | `opacity: 1, y: 0, filter: "blur(0px)"`                   | `opacity: 0, y: -10, filter: "blur(16px)"`                 | `power2.in`             |
| **Behind-Shoulder 3D Badge Rise**  | `10f`                    | `0.333s`    | `opacity: 0, y: 96, scale: 0.86, rotation: ±6`            | `opacity: 1, y: 0, scale: 1.0, rotation: ±12`              | `power4.out`            |
| **Glass Orb Drop-Bounce**          | `7f` (`7f` stagger)      | `0.233s`    | `opacity: 0, y: -64, scale: 0.76, filter: "blur(12px)"`   | `opacity: 1, y: 0, scale: 1.0, filter: "blur(0px)"`        | `back.out(1.65)`        |
| **Step Circle Bloom Activation**   | `12f`                    | `0.40s`     | `scale: 1.36, boxShadow: "0 0 42px #fff"`                 | `scale: 1.0, boxShadow: "0 0 18px var(--accent-glow)"`     | `expo.out`              |
| **Vertical `Trick` Capsule Pop**   | `8f`                     | `0.267s`    | `opacity: 0, scale: 0.78, x: 28`                          | `opacity: 1, scale: 1.0, x: 0`                             | `back.out(1.4)`         |
| **Neon-Tube Chapter Flicker**      | `6f` (`1f` steps)        | `0.20s`     | Stepped opacity `0.1 -> 1 -> 0.08 -> 1 -> 0.12 -> 1`      | Locked `opacity: 1` at `+6f`                               | `none` (`tl.set` steps) |
| **iPhone Slide-Up Arrival**        | `8f`                     | `0.267s`    | `opacity: 0, y: 210, scale: 0.95`                         | `opacity: 1, y: 0, scale: 1.0`                             | `power4.out`            |
| **iPhone 3D Perspective Swing**    | `10f`                    | `0.333s`    | `rotationY: 16, rotationX: 4, transformPerspective: 1400` | `rotationY: -16, rotationX: 4, transformPerspective: 1400` | `power3.inOut`          |
| **Neon UI Highlight Box**          | `8f`                     | `0.267s`    | `opacity: 0, scale: 1.06`                                 | `opacity: 1, scale: 1.0`                                   | `power3.out`            |
| **Split-Slot Pill Text Reveal**    | `12f` (after `8f` shell) | `0.40s`     | Token A `y: 56`, Token B `y: -56`                         | Token A `y: 0`, Token B `y: 0`                             | `power4.out`            |
| **SVG Underline / Oval Draw**      | `8f`                     | `0.267s`    | `strokeDashoffset: pathLength`                            | `strokeDashoffset: 0`                                      | `power3.out`            |
| **Camera Slow Creep (Wrapper)**    | `60f–105f`               | `2.0s–3.5s` | `scale: 1.00`                                             | `scale: 1.06`                                              | `none`                  |
| **Camera Emphasis Punch-In**       | `0f` (instant cut)       | `0.00s`     | `scale: 1.06`                                             | `scale: 1.24` (or `1.42` Save CTA)                         | `tl.set`                |

---

## 6 · Pacing, Audio Loudness & SFX Architecture (`PACING` & `AUDIO`)

- **0.0s–3.0s (The Hook Window)**: Visual graphic + bold numeral/orbs/question lands by `0.35s`; camera or secondary line progresses at `1.1s`; retention micro-cut or punch-in hits at `2.6s–3.2s`.
- **Pattern-Interrupt Cadence**:
  - Talking-head stretches: new ladder line every `0.45s–0.9s`, full cluster swap or camera reframe every `1.8s–3.0s`.
  - Device demo stretches: hold single scene up to `6.0s–9.0s`, but trigger an internal action (highlight box, keyboard type, 3D swing, popup menu) every `1.6s–2.2s`.
- **Audio Mix Rules**:
  - Master target: `-14.2 LUFS` integrated, `-1.0 dBFS` true peak (`npx hyperframes normalize-audio` when available).
  - Voiceover / A-roll speech: `data-volume="1.0"`.
  - Background music (`bgm`): subtle dark minimal synth/lo-fi pulse at `data-volume="0.14"` (`~ -17 dB` below speech).
  - Discrete SFX triggers (each `<audio>` requires a unique `id`):
    - **Soft Sub-Pop (`data-volume="0.35"`)**: On glass orb bounce, `Trick` capsule pop, and frosted pill shell open.
    - **Crisp UI Click / Chime (`data-volume="0.30"`)**: On `(1)—2—3` step bloom and neon UI highlight box lock.
    - **Short Airy Whoosh (`0.22s`, `data-volume="0.38"`)**: On 3D iPhone perspective swing, white chapter card cut, and hard `1.24x+` camera punch-in.

---

## 7 · Explicitly `BANNED` Defaults

Never introduce any of the following into a `signature-reel-style` project:

1. **Bottom-edge CapCut karaoke bars**: Full-width dark bars or yellow/black stroked words parked at `bottom: 60px–140px`.
2. **Uniform `0.5s+` fade-and-slide-up**: Making every element slowly drift upward with `opacity: 0 -> 1` and zero optical blur.
3. **Idle sine-wave floating / breathing loops**: Continuous bobbing on landed titles, pills, or step trackers (`motion-doctrine` ban). Landed typography is dead still until exit.
4. **Multi-color rainbow palettes**: Mixing cyan, magenta, yellow, and green in the same composition. Stick strictly to the chosen single-accent preset (`+` optional secondary warm rim in `violet-studio`).
5. **Unframed raw screenshots floating in empty black space**: Always house mobile UI inside the `38px`-bezel `720px`-wide 3D device frame over the `24px` dotted-matrix stage + radial top glow.
6. **Low-contrast white text over white shirts or white cards**: Always flip primary non-accent ink to `#111115` over bright backgrounds (`> 175` luminance).
