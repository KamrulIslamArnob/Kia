# Zero-Touch Video Intake & Editing Workflow

Whenever the user wants a video created or edited, or drops/pastes a raw video file or URL in chat:

1. **Discover the active project**:
   - Run `node studio-hub/cli-ingest.mjs --status` or read `CURRENT_PROJECT.json`.
   - Read `projects/<active-slug>/AI_READY_PROMPT.md` and `projects/<active-slug>/PROJECT_BRIEF.json` to get the exact canvas size, duration, brand colors, creative instructions, reference links, and every available media file path (`assets/clips/...`, `assets/images/...`, `assets/audio/...`, `inbox/...`).

2. **Auto-ingest any file or link the user provides**:
   - If the user shares a raw video URL (YouTube, TikTok, Reels, Facebook, Loom, Google Drive, or direct MP4 URL):
     ```bash
     node studio-hub/cli-ingest.mjs --url "<URL>" --category raw-video
     ```
   - If the user shares a reference video/page URL:
     ```bash
     node studio-hub/cli-ingest.mjs --url "<URL>" --category references
     ```
     (Add `--download` if they want the reference video downloaded locally.)
   - If the user shares a local file path or mentions a file dropped in the root directory:
     ```bash
     node studio-hub/cli-ingest.mjs --file "<LOCAL_PATH>" --category raw-video
     ```
     (Use `--category images` or `--category audio` or `--category references` when appropriate.)

3. **Edit & Render via HyperFrames**:
   - Read `/hyperframes` (`skills/hyperframes/SKILL.md`) before authoring or modifying `projects/<active-slug>/index.html` or `projects/<active-slug>/compositions/*.html`.
   - Reference all project assets using HyperFrames-relative paths (`assets/clips/...`, `assets/images/...`, `assets/audio/...`).
   - Validate before rendering:
     ```bash
     npx hyperframes lint projects/<active-slug>
     npx hyperframes check --json projects/<active-slug>
     ```
   - Render the output into `projects/<active-slug>/output/<active-slug>_final.mp4` (`--quality delivery`), then run `node studio-hub/cli-ingest.mjs --sync` so the rendered video appears immediately in the Studio Hub UI Render Theater at `http://localhost:4400`.
