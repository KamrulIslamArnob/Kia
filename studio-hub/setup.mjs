import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DROP_DIR,
  PROJECTS_DIR,
  ROOT_DIR,
  ensureDropStructure,
  findChromeHeadlessShell,
  getToolEnv,
  resolvePythonBin,
  runCommand,
} from "./lib.mjs";
import { buildStudioUi } from "./build-ui.mjs";

const __filename = fileURLToPath(import.meta.url);

const PYTHON_MODULES_PROBE = [
  "import importlib.util, json, sys",
  "mods = ['cv2', 'PIL', 'fitz', 'edge_tts', 'faster_whisper', 'rea_video']",
  "found = {m: (importlib.util.find_spec(m) is not None) for m in mods}",
  "print(json.dumps({'version': sys.version.split()[0], 'modules': found}))",
].join("; ");

function firstLine(text) {
  return String(text || "")
    .trim()
    .split(/\r?\n/)[0]
    .trim();
}

function ensureDropReadme() {
  const readmePath = path.join(DROP_DIR, "README.txt");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      [
        "HyperFrames Video Studio — Zero-Touch Drop Folder",
        "",
        "Drop files into any subfolder while the Studio Hub server is running:",
        "  - raw-video/    -> Raw screen recordings, talking-head clips, B-roll",
        "  - inspiration/  -> Reference reels for tempo & color profiling",
        "  - references/   -> Additional visual references",
        "  - images/       -> Product screenshots & graphics",
        "  - brand/        -> Logos, fonts (.ttf/.otf/.woff2), brand PDFs/docs",
        "  - audio/        -> Voiceovers & music tracks",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

function padCell(str, width) {
  const s = String(str ?? "");
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

export async function runSetup({ silent = false, buildUi = true } = {}) {
  const env = getToolEnv();
  const nodeVersion = process.versions.node || "0.0.0";
  const nodeMajor = Number(nodeVersion.split(".")[0]) || 0;
  const pythonBin = resolvePythonBin();

  const [bunRes, ffmpegRes, ffprobeRes, ytdlpRes, pyRes] = await Promise.all([
    runCommand("bun", ["--version"], { env, shell: false }),
    runCommand("ffmpeg", ["-version"], { env, shell: false }),
    runCommand("ffprobe", ["-version"], { env, shell: false }),
    runCommand("yt-dlp", ["--version"], { env, shell: false }),
    runCommand(pythonBin, ["-c", PYTHON_MODULES_PROBE], { env, shell: false }),
  ]);

  let pyInfo = { version: "", modules: {} };
  if (pyRes.code === 0 && pyRes.stdout.trim()) {
    try {
      pyInfo = JSON.parse(pyRes.stdout.trim());
    } catch {
      pyInfo = { version: firstLine(pyRes.stdout), modules: {} };
    }
  }

  const chromePath = findChromeHeadlessShell();

  // Scaffold local workspace folders
  ensureDropStructure();
  ensureDropReadme();
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });

  let uiBuildSummary = null;
  if (buildUi) {
    uiBuildSummary = await buildStudioUi();
  }

  const pyMods = pyInfo.modules || {};
  const corePyNames = ["cv2", "PIL", "fitz", "edge_tts"];
  const missingCorePy = corePyNames.filter((m) => !pyMods[m]);

  const rows = [
    {
      component: "Node.js (>= 22)",
      ok: nodeMajor >= 22,
      required: true,
      detail: `v${nodeVersion}`,
    },
    {
      component: "Bun (Workspace PM)",
      ok: bunRes.code === 0,
      required: true,
      detail: bunRes.code === 0 ? `v${firstLine(bunRes.stdout)}` : "Not found in PATH",
    },
    {
      component: "FFmpeg",
      ok: ffmpegRes.code === 0,
      required: true,
      detail: ffmpegRes.code === 0 ? firstLine(ffmpegRes.stdout).slice(0, 44) : "Missing",
    },
    {
      component: "FFprobe",
      ok: ffprobeRes.code === 0,
      required: true,
      detail: ffprobeRes.code === 0 ? firstLine(ffprobeRes.stdout).slice(0, 44) : "Missing",
    },
    {
      component: `Python 3 (${pythonBin})`,
      ok: pyRes.code === 0 && Boolean(pyInfo.version),
      required: true,
      detail: pyInfo.version ? `Python ${pyInfo.version}` : "Missing",
    },
    {
      component: "Python Core (cv2, PIL, fitz, edge_tts)",
      ok: pyRes.code === 0 && missingCorePy.length === 0,
      required: true,
      detail:
        missingCorePy.length === 0
          ? "All 4 core packages installed"
          : `Missing: ${missingCorePy.join(", ")}`,
    },
    {
      component: "Python Whisper (faster_whisper)",
      ok: Boolean(pyMods.faster_whisper),
      required: false,
      detail: pyMods.faster_whisper ? "Installed (offline ASR ready)" : "Optional (not installed)",
    },
    {
      component: "Python rea-video (Inspiration Decomp)",
      ok: Boolean(pyMods.rea_video),
      required: false,
      detail: pyMods.rea_video
        ? "Installed (shot & editing breakdown ready)"
        : "Optional: pip install git+https://github.com/JuneYaooo/rea-video.git",
    },
    {
      component: "yt-dlp (URL Video Ingest)",
      ok: ytdlpRes.code === 0,
      required: false,
      detail: ytdlpRes.code === 0 ? `v${firstLine(ytdlpRes.stdout)}` : "Optional (not installed)",
    },
    {
      component: "Headless Chrome / Browser",
      ok: Boolean(chromePath),
      required: true,
      detail: chromePath ? path.basename(chromePath) : "Run: npx hyperframes browser ensure",
    },
    {
      component: "React 19 Studio UI Bundle",
      ok: Boolean(uiBuildSummary?.ok) || !buildUi,
      required: true,
      detail: uiBuildSummary
        ? `Built app.js (${(uiBuildSummary.bytes.js / 1024).toFixed(1)} KB)`
        : "Skipped",
    },
  ];

  const missingRequired = rows.filter((r) => r.required && !r.ok);

  if (!silent) {
    console.log("");
    console.log("==========================================================================");
    console.log(`  HyperFrames Video Studio — Cross-Device Setup (${os.platform()} ${os.arch()})`);
    console.log("==========================================================================");
    console.log(`${padCell("COMPONENT", 38)} ${padCell("STATUS", 12)} DETAILS`);
    console.log("-".repeat(74));
    for (const row of rows) {
      const badge = row.ok ? "[OK]" : row.required ? "[MISSING]" : "[OPTIONAL]";
      console.log(`${padCell(row.component, 38)} ${padCell(badge, 12)} ${row.detail}`);
    }
    console.log("-".repeat(74));
    console.log(`Workspace Root : ${ROOT_DIR}`);
    console.log(`Drop Folder    : ${DROP_DIR}`);
    console.log(`Projects Vault : ${PROJECTS_DIR}`);
    console.log("");

    if (
      missingRequired.length > 0 ||
      !pyMods.faster_whisper ||
      !pyMods.rea_video ||
      ytdlpRes.code !== 0
    ) {
      console.log("Copy-Paste Prerequisite Install Commands by OS:");
      console.log("  Windows (PowerShell):");
      console.log(
        "    winget install Gyan.FFmpeg Python.Python.3.12 OpenJS.NodeJS.LTS Oven-sh.Bun",
      );
      console.log("    pip install opencv-python pillow pymupdf edge-tts faster-whisper yt-dlp");
      console.log(
        "    pip install PyYAML videomd && pip install --no-deps git+https://github.com/JuneYaooo/rea-video.git",
      );
      console.log("  macOS (Homebrew):");
      console.log("    brew install node bun ffmpeg python yt-dlp");
      console.log("    pip3 install opencv-python pillow pymupdf edge-tts faster-whisper");
      console.log(
        "    pip3 install PyYAML videomd && pip3 install --no-deps git+https://github.com/JuneYaooo/rea-video.git",
      );
      console.log("  Ubuntu / Debian Linux:");
      console.log(
        "    sudo apt update && sudo apt install -y ffmpeg python3 python3-pip python3-venv",
      );
      console.log("    pip3 install opencv-python pillow pymupdf edge-tts faster-whisper yt-dlp");
      console.log(
        "    pip3 install PyYAML videomd && pip3 install --no-deps git+https://github.com/JuneYaooo/rea-video.git",
      );
      console.log("  Headless Browser (All OSes):");
      console.log("    npx hyperframes browser ensure");
      console.log("");
    }

    console.log("Launch Studio Hub (http://localhost:4400):");
    console.log("  Windows : Start-Video-Studio.bat   (or: node studio-hub/server.mjs)");
    console.log("  macOS   : ./start-studio.sh        (or: node studio-hub/server.mjs)");
    console.log("  Linux   : ./start-studio.sh        (or: node studio-hub/server.mjs)");
    console.log("==========================================================================");
    console.log("");
  }

  return {
    ok: missingRequired.length === 0,
    platform: process.platform,
    arch: process.arch,
    nodeVersion,
    pythonBin,
    chromePath,
    rows,
    missingRequired: missingRequired.map((r) => r.component),
    uiBuildSummary,
  };
}

if (path.resolve(process.argv[1] || "") === __filename) {
  const strict = process.argv.includes("--strict");
  runSetup()
    .then((summary) => {
      if (strict && !summary.ok) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error("[setup] Fatal error:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
