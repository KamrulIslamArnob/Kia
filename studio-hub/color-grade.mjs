import fs from "node:fs";
import path from "node:path";
import { getToolEnv, runCommand } from "./lib.mjs";

export const DEFAULT_COLOR_LOOK_ID = "clean-commercial";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
let inPlaceTempSeq = 0;

const RAW_LOOK_DEFINITIONS = [
  {
    id: "clean-commercial",
    name: "Clean Commercial",
    category: "commercial",
    description:
      "Neutral broadcast commercial polish with crisp micro-contrast, true skin/UI fidelity, and subtle optical roll-off.",
    filters: {
      eq: "eq=contrast=1.05:brightness=0.01:saturation=1.08:gamma=0.99",
      colorbalance:
        "colorbalance=rs=-0.01:gs=0.00:bs=0.02:rm=0.01:gm=0.01:bm=0.00:rh=0.02:gh=0.01:bh=-0.01",
      curves: "curves=m='0/0 0.20/0.18 0.80/0.83 1/1'",
      unsharp: "unsharp=5:5:0.45:3:3:0.0",
      noise: "noise=alls=1:allf=u",
      vignette: "vignette=angle=PI/10",
    },
    swatches: ["#10151C", "#4E657A", "#E9EEF4", "#38BDF8"],
  },
  {
    id: "kodak-2383-warm",
    name: "Kodak 2383 Warm Print",
    category: "film-print",
    description:
      "Motion-picture print stock emulation featuring dense cyan-blue shadows, warm amber midtones, and creamy rolled highlights.",
    filters: {
      eq: "eq=contrast=1.12:brightness=0.01:saturation=1.10:gamma=0.97:gamma_r=1.03:gamma_b=0.95",
      colorbalance:
        "colorbalance=rs=-0.05:gs=-0.01:bs=0.06:rm=0.06:gm=0.02:bm=-0.05:rh=0.08:gh=0.04:bh=-0.07",
      curves:
        "curves=m='0/0.02 0.22/0.19 0.76/0.82 1/0.97':r='0/0 0.50/0.53 1/0.99':b='0/0.03 0.50/0.46 1/0.93'",
      unsharp: "unsharp=5:5:0.30:3:3:0.0",
      noise: "noise=alls=5:allf=t+u",
      vignette: "vignette=angle=PI/5",
    },
    swatches: ["#181A24", "#8F5B38", "#F5E2C8", "#E59A46"],
  },
  {
    id: "emerald-vibrant",
    name: "Emerald Vibrant",
    category: "brand-cinema",
    description:
      "Lush botanical and modern fintech grade with deep forest shadows, rich jade midtones, and luminous warm highlights.",
    filters: {
      eq: "eq=contrast=1.10:brightness=0.01:saturation=1.22:gamma=0.98:gamma_g=1.03",
      colorbalance:
        "colorbalance=rs=-0.06:gs=0.04:bs=0.01:rm=-0.03:gm=0.07:bm=-0.02:rh=0.04:gh=0.03:bh=-0.04",
      curves: "curves=m='0/0.01 0.20/0.17 0.78/0.84 1/0.99':g='0/0 0.50/0.54 1/1'",
      unsharp: "unsharp=5:5:0.55:3:3:0.0",
      noise: "noise=alls=2:allf=t+u",
      vignette: "vignette=angle=PI/6",
    },
    swatches: ["#081812", "#1E824C", "#DCFCE7", "#2ECC71"],
  },
  {
    id: "teal-orange-cinema",
    name: "Teal & Orange Cinema",
    category: "cinema",
    description:
      "Anamorphic blockbuster color separation pushing cool teal shadow depth against warm copper-amber highlights.",
    filters: {
      eq: "eq=contrast=1.16:brightness=0.00:saturation=1.16:gamma=0.97",
      colorbalance:
        "colorbalance=rs=-0.12:gs=0.02:bs=0.12:rm=0.05:gm=0.00:bm=-0.05:rh=0.12:gh=0.03:bh=-0.10",
      curves:
        "curves=m='0/0.01 0.22/0.17 0.78/0.85 1/0.99':r='0/0 0.62/0.67 1/1':b='0/0.04 0.35/0.40 0.75/0.70 1/0.94'",
      unsharp: "unsharp=5:5:0.50:3:3:0.0",
      noise: "noise=alls=3:allf=t+u",
      vignette: "vignette=angle=PI/5",
    },
    swatches: ["#0A222E", "#19647E", "#F7B267", "#EA580C"],
  },
  {
    id: "apple-keynote-crisp",
    name: "Apple Keynote Crisp",
    category: "commercial",
    description:
      "Precision hardware and SaaS keynote finish with obsidian blacks, titanium whites, and razor-sharp UI clarity.",
    filters: {
      eq: "eq=contrast=1.10:brightness=0.00:saturation=1.05:gamma=0.98",
      colorbalance:
        "colorbalance=rs=-0.02:gs=0.00:bs=0.03:rm=0.00:gm=0.00:bm=0.01:rh=0.01:gh=0.01:bh=0.03",
      curves: "curves=m='0/0 0.16/0.13 0.84/0.88 1/1'",
      unsharp: "unsharp=5:5:0.70:3:3:0.0",
      noise: "noise=alls=1:allf=u",
      vignette: "vignette=angle=PI/9",
    },
    swatches: ["#090B10", "#3F4756", "#F8FAFC", "#60A5FA"],
  },
  {
    id: "matte-editorial",
    name: "Matte Editorial",
    category: "editorial",
    description:
      "Refined lookbook grade with lifted charcoal blacks, restrained saturation, and soft editorial highlight roll-off.",
    filters: {
      eq: "eq=contrast=0.96:brightness=0.02:saturation=0.84:gamma=1.03",
      colorbalance:
        "colorbalance=rs=0.02:gs=0.01:bs=0.03:rm=0.03:gm=0.02:bm=-0.01:rh=0.03:gh=0.02:bh=-0.02",
      curves: "curves=m='0/0.08 0.25/0.26 0.75/0.76 1/0.93'",
      unsharp: "unsharp=5:5:0.25:3:3:0.0",
      noise: "noise=alls=4:allf=t+u",
      vignette: "vignette=angle=PI/6",
    },
    swatches: ["#262523", "#78716C", "#E7E5E4", "#D6B88D"],
  },
  {
    id: "cyber-neon",
    name: "Cyber Neon",
    category: "stylized",
    description:
      "High-voltage night-tech grade with indigo shadow floor, electric magenta-cyan split toning, and punchy contrast.",
    filters: {
      eq: "eq=contrast=1.20:brightness=-0.01:saturation=1.32:gamma=0.95:gamma_b=1.06",
      colorbalance:
        "colorbalance=rs=0.06:gs=-0.08:bs=0.14:rm=0.04:gm=-0.04:bm=0.10:rh=-0.04:gh=0.06:bh=0.12",
      curves:
        "curves=m='0/0 0.20/0.14 0.78/0.86 1/1':r='0/0.02 0.55/0.58 1/1':b='0/0.06 0.50/0.58 1/1'",
      unsharp: "unsharp=5:5:0.65:3:3:0.0",
      noise: "noise=alls=3:allf=t+u",
      vignette: "vignette=angle=PI/4.5",
    },
    swatches: ["#0D0620", "#6D28D9", "#22D3EE", "#F43F5E"],
  },
  {
    id: "vintage-16mm-grain",
    name: "Vintage 16mm Grain",
    category: "film-print",
    description:
      "Authentic indie 16mm celluloid look with warm olive-ochre tonal shift, organic film grain, and optical lens falloff.",
    filters: {
      eq: "eq=contrast=1.06:brightness=0.01:saturation=0.88:gamma=1.02:gamma_r=1.04:gamma_b=0.93",
      colorbalance:
        "colorbalance=rs=0.03:gs=0.04:bs=-0.05:rm=0.07:gm=0.03:bm=-0.07:rh=0.09:gh=0.05:bh=-0.08",
      curves: "curves=m='0/0.06 0.24/0.23 0.76/0.79 1/0.94':b='0/0.04 0.50/0.44 1/0.88'",
      unsharp: "unsharp=5:5:0.15:3:3:0.0",
      noise: "noise=alls=11:allf=t+u",
      vignette: "vignette=angle=PI/4.2",
    },
    swatches: ["#242118", "#8A7248", "#EDE0C4", "#C88A3B"],
  },
  {
    id: "warm-golden-hour",
    name: "Warm Golden Hour",
    category: "cinema",
    description:
      "Magic-hour sunlit grade bathing midtones and highlights in honey-amber warmth while preserving crisp shadow detail.",
    filters: {
      eq: "eq=contrast=1.08:brightness=0.02:saturation=1.16:gamma=1.01:gamma_r=1.05:gamma_b=0.93",
      colorbalance:
        "colorbalance=rs=0.04:gs=-0.01:bs=-0.03:rm=0.09:gm=0.04:bm=-0.07:rh=0.12:gh=0.06:bh=-0.09",
      curves:
        "curves=m='0/0.02 0.22/0.21 0.76/0.83 1/0.99':r='0/0.01 0.50/0.56 1/1':b='0/0 0.50/0.43 1/0.90'",
      unsharp: "unsharp=5:5:0.35:3:3:0.0",
      noise: "noise=alls=2:allf=t+u",
      vignette: "vignette=angle=PI/5.5",
    },
    swatches: ["#231512", "#B45309", "#FDE68A", "#F59E0B"],
  },
  {
    id: "noir-high-contrast",
    name: "Noir High Contrast",
    category: "monochrome",
    description:
      "Silver-halide monochrome cinema look with deep velvet blacks, sculpted platinum highlights, and fine silver grain.",
    filters: {
      eq: "eq=contrast=1.28:brightness=-0.01:saturation=0.00:gamma=0.96",
      colorbalance:
        "colorbalance=rs=-0.01:gs=0.00:bs=0.02:rm=0.00:gm=0.00:bm=0.01:rh=0.01:gh=0.01:bh=0.02",
      curves: "curves=m='0/0 0.20/0.12 0.78/0.87 1/0.99'",
      unsharp: "unsharp=5:5:0.60:3:3:0.0",
      noise: "noise=alls=7:allf=t+u",
      vignette: "vignette=angle=PI/4.2",
    },
    swatches: ["#050505", "#52525B", "#F4F4F5", "#A1A1AA"],
  },
];

function buildDualColorLooks(definitions) {
  const list = definitions.map((def) => {
    const filters = Object.freeze({ ...def.filters });
    const filterChain = [
      filters.eq,
      filters.colorbalance,
      filters.curves,
      filters.unsharp,
      filters.noise,
      filters.vignette,
    ].join(",");
    const swatches = Object.freeze([...def.swatches]);
    const [shadows, midtones, highlights, accent] = swatches;
    const swatch = Object.freeze({
      shadows,
      midtones,
      highlights,
      accent,
      gradient: `linear-gradient(135deg, ${shadows} 0%, ${midtones} 50%, ${highlights} 100%)`,
    });

    return Object.freeze({
      id: def.id,
      name: def.name,
      label: def.name,
      category: def.category,
      description: def.description,
      filters,
      filterChain,
      vf: filterChain,
      swatches,
      swatch,
      hyperframesRule11Safe: true,
    });
  });

  for (const look of list) {
    Object.defineProperty(list, look.id, {
      value: look,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  return Object.freeze(list);
}

export const COLOR_LOOKS = buildDualColorLooks(RAW_LOOK_DEFINITIONS);
export const COLOR_LOOK_IDS = Object.freeze(COLOR_LOOKS.map((look) => look.id));

export function getColorLook(lookId = DEFAULT_COLOR_LOOK_ID) {
  const normalized = String(lookId || DEFAULT_COLOR_LOOK_ID).trim();
  return COLOR_LOOKS.find((look) => look.id === normalized) || null;
}

export function buildColorLookFilterChain(lookId = DEFAULT_COLOR_LOOK_ID) {
  const look = resolveValidatedLook(lookId);
  return look.filterChain;
}

function resolveValidatedLook(lookId) {
  const normalized =
    lookId === undefined || lookId === null || String(lookId).trim() === ""
      ? DEFAULT_COLOR_LOOK_ID
      : String(lookId).trim();
  const look = getColorLook(normalized);
  if (!look) {
    throw new Error(
      `Unknown color look: "${normalized}". Valid looks: ${COLOR_LOOK_IDS.join(", ")}`,
    );
  }
  return look;
}

function validatePaths(inputPath, outputPath, mediaLabel) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error(`Input ${mediaLabel} path is required`);
  }
  if (!outputPath || typeof outputPath !== "string") {
    throw new Error(`Output ${mediaLabel} path is required`);
  }
  const absInput = path.resolve(inputPath);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error(`Input ${mediaLabel} file not found: ${inputPath}`);
  }
  const absOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absOutput), { recursive: true });

  const samePath =
    process.platform === "win32"
      ? absInput.toLowerCase() === absOutput.toLowerCase()
      : absInput === absOutput;

  if (!samePath) {
    return { absInput, absOutput, targetOutput: absOutput, isInPlace: false };
  }

  const ext = path.extname(absOutput) || (mediaLabel === "image" ? ".png" : ".mp4");
  const stem = path.basename(absOutput, ext);
  inPlaceTempSeq += 1;
  const tmpTarget = path.join(
    path.dirname(absOutput),
    `${stem}.cg_tmp_${process.pid}_${inPlaceTempSeq}${ext}`,
  );
  return { absInput, absOutput, targetOutput: tmpTarget, isInPlace: true };
}

export async function applyColorLookToVideo({
  inputPath,
  outputPath,
  lookId = DEFAULT_COLOR_LOOK_ID,
  fps = 30,
} = {}) {
  const look = resolveValidatedLook(lookId);
  const { absInput, absOutput, targetOutput, isInPlace } = validatePaths(
    inputPath,
    outputPath,
    "video",
  );

  const args = ["-y", "-i", absInput, "-vf", look.filterChain];
  if (fps !== null && fps !== undefined && Number.isFinite(Number(fps)) && Number(fps) > 0) {
    args.push("-r", String(Number(fps)));
  }
  args.push(
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    targetOutput,
  );

  try {
    const res = await runCommand("ffmpeg", args, { env: getToolEnv(), shell: false });
    if (res.code !== 0 || !fs.existsSync(targetOutput) || fs.statSync(targetOutput).size === 0) {
      const errDetail = (res.stderr || res.stdout || "").trim().slice(-600);
      throw new Error(`FFmpeg video color grade (${look.id}) failed: ${errDetail}`);
    }
    if (isInPlace) {
      fs.renameSync(targetOutput, absOutput);
    }
    return { ok: true, outputPath, lookId: look.id };
  } catch (err) {
    if (isInPlace && fs.existsSync(targetOutput)) {
      fs.rmSync(targetOutput, { force: true });
    }
    throw err;
  }
}

export async function applyColorLookToImage({
  inputPath,
  outputPath,
  lookId = DEFAULT_COLOR_LOOK_ID,
} = {}) {
  const look = resolveValidatedLook(lookId);
  const { absInput, absOutput, targetOutput, isInPlace } = validatePaths(
    inputPath,
    outputPath,
    "image",
  );

  const ext = path.extname(targetOutput).toLowerCase();
  const args = ["-y", "-i", absInput, "-vf", look.filterChain, "-frames:v", "1", "-update", "1"];
  if (ext === ".jpg" || ext === ".jpeg") {
    args.push("-q:v", "2");
  }
  args.push(targetOutput);

  try {
    const res = await runCommand("ffmpeg", args, { env: getToolEnv(), shell: false });
    if (res.code !== 0 || !fs.existsSync(targetOutput) || fs.statSync(targetOutput).size === 0) {
      const errDetail = (res.stderr || res.stdout || "").trim().slice(-600);
      throw new Error(`FFmpeg image color grade (${look.id}) failed: ${errDetail}`);
    }
    if (isInPlace) {
      fs.renameSync(targetOutput, absOutput);
    }
    return { ok: true, outputPath, lookId: look.id };
  } catch (err) {
    if (isInPlace && fs.existsSync(targetOutput)) {
      fs.rmSync(targetOutput, { force: true });
    }
    throw err;
  }
}

export async function applyColorLook({
  inputPath,
  outputPath,
  lookId = DEFAULT_COLOR_LOOK_ID,
  fps = 30,
} = {}) {
  const ext = path.extname(String(outputPath || inputPath || "")).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return applyColorLookToImage({ inputPath, outputPath, lookId });
  }
  return applyColorLookToVideo({ inputPath, outputPath, lookId, fps });
}
