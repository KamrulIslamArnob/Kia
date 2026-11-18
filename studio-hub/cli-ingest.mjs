import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertValidSlug,
  CATEGORIES,
  checkTools,
  ensureDropStructure,
  ingestLocalFile,
  ingestUrl,
  listLooseRootFiles,
  readCurrentProjectSlug,
  ROOT_DIR,
  setCurrentProjectSlug,
  syncProjectManifest,
} from "./lib.mjs";
import { importExternalFolder } from "./folder-ingest.mjs";
import { generateStoryboard, loadStoryboard } from "./storyboard.mjs";
import { compileProjectVideo } from "./video-compiler.mjs";

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printUsage() {
  console.log(`HyperFrames Studio Hub CLI Ingest & Pipeline

Usage:
  node studio-hub/cli-ingest.mjs --status [--project <slug>]
  node studio-hub/cli-ingest.mjs --url "<video_url>" [--project <slug>] [--category raw-video|inspiration|references] [--title "..."]
  node studio-hub/cli-ingest.mjs --file "<local_path>" [--project <slug>] [--category raw-video|inspiration|references|images|brand|audio] [--move]
  node studio-hub/cli-ingest.mjs --folder "<local_dir>" [--project <slug>] [--category auto|raw-video|brand|images|audio]
  node studio-hub/cli-ingest.mjs --storyboard [--project <slug>] [--scenes 6] [--prompt "..."]
  node studio-hub/cli-ingest.mjs --compile [--project <slug>] [--quality draft|delivery] [--fps 30] [--aspect 9:16] [--no-render]
  node studio-hub/cli-ingest.mjs --sync [--project <slug>]
`);
}

export async function runCliIngest(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  ensureDropStructure();

  if (args.help || args.h) {
    printUsage();
    return;
  }

  const slug = args.project || readCurrentProjectSlug();
  if (!slug) {
    console.error("No active project found in projects/. Create one in the Studio Hub UI first.");
    process.exitCode = 1;
    return;
  }

  if (args.status) {
    const [tools, manifest, loose] = await Promise.all([
      checkTools(),
      syncProjectManifest(slug),
      Promise.resolve(listLooseRootFiles()),
    ]);
    console.log(
      JSON.stringify(
        {
          ok: tools.ffmpeg.ok && tools.ffprobe.ok,
          activeProject: slug,
          projectTitle: manifest.title,
          canvas: `${manifest.width}x${manifest.height} (${manifest.aspectRatio}) @ ${manifest.fps}fps · ${manifest.durationSeconds}s`,
          tools,
          counts: {
            rawVideo: manifest.files.rawVideo.length,
            inspiration: manifest.files.inspiration?.length || 0,
            clips: manifest.files.clips.length,
            references: manifest.files.references.length,
            referenceLinks: manifest.referenceLinks.length,
            brand: manifest.files.brand?.length || 0,
            images: manifest.files.images.length + manifest.files.assetImages.length,
            audio: manifest.files.assetAudio.length,
            renders: manifest.files.renders.length,
          },
          looseRootFiles: loose,
          aiReadyPrompt: `projects/${slug}/AI_READY_PROMPT.md`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.activate) {
    const payload = setCurrentProjectSlug(slug);
    const manifest = await syncProjectManifest(slug);
    console.log(
      JSON.stringify(
        { ok: true, activeProject: payload.activeProject, title: manifest.title },
        null,
        2,
      ),
    );
    return;
  }

  if (args.sync) {
    const manifest = await syncProjectManifest(slug);
    console.log(JSON.stringify({ ok: true, slug, updatedAt: manifest.updatedAt }, null, 2));
    return;
  }

  if (args.url) {
    const category = args.category || "raw-video";
    if (!CATEGORIES.includes(category)) {
      throw new Error(
        `Invalid --category "${category}". Expected one of: ${CATEGORIES.join(", ")}`,
      );
    }
    const effectiveCategory =
      category === "inspiration" && args.download === "false" ? "references" : category;
    const result = await ingestUrl({
      slug,
      url: String(args.url),
      category: effectiveCategory,
      title: args.title ? String(args.title) : "",
      notes: args.notes ? String(args.notes) : "",
      download:
        args.download !== undefined ? args.download !== "false" && Boolean(args.download) : null,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          slug,
          mode: result.mode,
          url: result.url,
          inboxRelPath: result.inboxRelPath || null,
          assetRelPath: result.assetRelPath || null,
          aiReadyPrompt: `projects/${slug}/AI_READY_PROMPT.md`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.file) {
    const category = args.category || "raw-video";
    const resolved = path.isAbsolute(String(args.file))
      ? String(args.file)
      : path.resolve(ROOT_DIR, String(args.file));
    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: ${resolved}`);
    }
    const result = await ingestLocalFile({
      slug,
      sourcePath: resolved,
      category,
      move: Boolean(args.move),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          slug,
          category,
          inboxRelPath: result.inboxRelPath,
          assetRelPath: result.assetRelPath,
          aiReadyPrompt: `projects/${slug}/AI_READY_PROMPT.md`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.folder) {
    const category = args.category || "auto";
    const resolvedFolder = path.isAbsolute(String(args.folder))
      ? String(args.folder)
      : path.resolve(ROOT_DIR, String(args.folder));
    const result = await importExternalFolder({
      slug,
      folderPath: resolvedFolder,
      category,
      recursive: !args["no-recursive"],
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          slug,
          importedCount: result.importedCount,
          sourceFolder: result.sourceFolder,
          aiReadyPrompt: `projects/${slug}/AI_READY_PROMPT.md`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.storyboard) {
    const projectDir = assertValidSlug(slug);
    const projectBrief = await syncProjectManifest(slug);
    const rawCachePath = path.join(projectDir, ".studio", "raw-analysis.json");
    let rawAnalysis = null;
    if (fs.existsSync(rawCachePath)) {
      try {
        rawAnalysis = JSON.parse(fs.readFileSync(rawCachePath, "utf8"));
      } catch {
        rawAnalysis = null;
      }
    }
    const sb = await generateStoryboard({
      slug,
      projectBrief,
      rawAnalysis,
      inspirationProfile: projectBrief.inspirationProfile || null,
      globalPrompt: args.prompt ? String(args.prompt) : "",
      targetScenes: args.scenes ? Number(args.scenes) : undefined,
      preserveLocked: !args["force-unlocked"],
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          slug,
          frameCount: sb.frameCount,
          lockedCount: sb.lockedCount,
          totalDurationSeconds: sb.totalDurationSeconds,
          storyboardPath: `projects/${slug}/STORYBOARD.json`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.compile) {
    const brief = await syncProjectManifest(slug);
    let storyboard = loadStoryboard(slug);
    if (!storyboard || !Array.isArray(storyboard.frames) || storyboard.frames.length === 0) {
      storyboard = await generateStoryboard({
        slug,
        projectBrief: brief,
        inspirationProfile: brief.inspirationProfile || null,
      });
    }
    const result = await compileProjectVideo({
      slug,
      storyboard,
      brief,
      settings: {
        quality: args.quality ? String(args.quality) : "draft",
        fps: args.fps ? Number(args.fps) : brief.fps || 30,
        aspectRatio: args.aspect ? String(args.aspect) : brief.aspectRatio || "9:16",
        resolution: args.resolution ? String(args.resolution) : "1080p",
        renderVideo: !args["no-render"],
      },
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          slug,
          outputRelPath: result.outputRelPath,
          totalDuration: result.totalDuration,
          sceneCount: result.sceneCount,
        },
        null,
        2,
      ),
    );
    return;
  }

  printUsage();
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runCliIngest().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}
