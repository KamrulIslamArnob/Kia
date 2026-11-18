import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const DEFAULT_ENTRY = path.join(__dirname, "ui-src", "main.jsx");
const DEFAULT_CSS_SRC = path.join(__dirname, "ui-src", "styles", "studio.css");
const DEFAULT_PUBLIC_DIR = path.join(__dirname, "public");

export function renderIndexHtml() {
  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HyperFrames Video Studio</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="studio-root"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;
}

/**
 * Bundle the local React 19 UI (`studio-hub/ui-src`) into `studio-hub/public`
 * (or perform an in-memory `write: false` verification when `dryRun` is true).
 *
 * @param {{
 *   entryPoint?: string;
 *   cssPath?: string;
 *   outDir?: string;
 *   dryRun?: boolean;
 *   minify?: boolean;
 * }} [options]
 */
export async function buildStudioUi(options = {}) {
  const entryPoint = options.entryPoint ? path.resolve(options.entryPoint) : DEFAULT_ENTRY;
  const cssPath = options.cssPath ? path.resolve(options.cssPath) : DEFAULT_CSS_SRC;
  const outDir = options.outDir ? path.resolve(options.outDir) : DEFAULT_PUBLIC_DIR;
  const dryRun = Boolean(options.dryRun);
  const minify = options.minify !== undefined ? Boolean(options.minify) : true;

  if (!fs.existsSync(entryPoint)) {
    throw new Error(`UI entry file not found: ${entryPoint}`);
  }
  if (!fs.existsSync(cssPath)) {
    throw new Error(`UI stylesheet not found: ${cssPath}`);
  }

  const nodePaths = [
    path.join(ROOT_DIR, "packages", "studio", "node_modules"),
    path.join(ROOT_DIR, "node_modules"),
  ];

  const outJs = path.join(outDir, "app.js");
  const outCss = path.join(outDir, "styles.css");
  const outHtml = path.join(outDir, "index.html");

  if (!dryRun) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const buildResult = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    nodePaths,
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
    },
    outfile: outJs,
    write: !dryRun,
    minify,
    sourcemap: false,
    metafile: true,
    logLevel: "silent",
  });

  if (buildResult.errors.length > 0) {
    throw new Error(
      `esbuild failed with ${buildResult.errors.length} error(s): ${buildResult.errors
        .map((e) => e.text)
        .join("; ")}`,
    );
  }

  const htmlContent = renderIndexHtml();

  if (!dryRun) {
    fs.copyFileSync(cssPath, outCss);
    fs.writeFileSync(outHtml, htmlContent, "utf8");
  }

  const bundledBytes = dryRun
    ? (buildResult.outputFiles?.[0]?.contents?.byteLength ?? 0)
    : fs.statSync(outJs).size;
  const cssBytes = fs.statSync(cssPath).size;

  return {
    ok: true,
    dryRun,
    entryPoint,
    outDir,
    files: {
      js: outJs,
      css: outCss,
      html: outHtml,
    },
    bytes: {
      js: bundledBytes,
      css: cssBytes,
      html: Buffer.byteLength(htmlContent, "utf8"),
    },
    warnings: buildResult.warnings,
  };
}

function parseCliArgs(argv) {
  let dryRun = false;
  let minify = true;
  let entryPoint = DEFAULT_ENTRY;
  let outDir = DEFAULT_PUBLIC_DIR;

  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "-n") {
      dryRun = true;
    } else if (arg === "--minify") {
      minify = true;
    } else if (arg === "--no-minify") {
      minify = false;
    } else if (arg.startsWith("--entry=")) {
      entryPoint = path.resolve(arg.slice("--entry=".length));
    } else if (arg.startsWith("--outdir=")) {
      outDir = path.resolve(arg.slice("--outdir=".length));
    }
  }

  return { dryRun, minify, entryPoint, outDir };
}

if (path.resolve(process.argv[1] || "") === __filename) {
  const cliOpts = parseCliArgs(process.argv.slice(2));
  buildStudioUi(cliOpts)
    .then((summary) => {
      const modeLabel = summary.dryRun ? "DRY-RUN (write: false)" : "BUILT";
      const kbJs = (summary.bytes.js / 1024).toFixed(1);
      const kbCss = (summary.bytes.css / 1024).toFixed(1);
      console.log(
        `[build-ui] ${modeLabel} -> app.js (${kbJs} KB), styles.css (${kbCss} KB), index.html`,
      );
    })
    .catch((err) => {
      console.error("[build-ui] Build failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
