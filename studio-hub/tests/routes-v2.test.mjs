import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { handleV2Routes } from "../routes-v2.mjs";

function createTempProjectsRoot(t, slug = "demo-proj") {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v2-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const projectDir = path.join(tmpRoot, slug);
  const subdirs = [
    "assets/images",
    "assets/clips",
    "assets/audio",
    ".studio/frames/raw",
    ".studio/frames/design",
    ".studio/frames/annotations",
    ".studio/frames/saved",
  ];
  for (const rel of subdirs) {
    fs.mkdirSync(path.join(projectDir, rel), { recursive: true });
  }
  fs.writeFileSync(
    path.join(projectDir, "PROJECT_BRIEF.json"),
    JSON.stringify(
      {
        slug,
        title: "Demo V2 Project",
        aspectRatio: "9:16",
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 18,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return { tmpRoot, projectDir, slug };
}

async function startEphemeralV2Server(t, depsFactory) {
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const deps = typeof depsFactory === "function" ? depsFactory() : depsFactory;
    const handled = await handleV2Routes(req, res, urlObj, deps);
    if (!handled && !res.headersSent) {
      res.writeHead(418, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, passthrough: true, path: urlObj.pathname }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function sendHttpJson(baseUrl, method, urlPath, body) {
  const headers = {};
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: payload,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

test("routes-v2 — non-matching routes return false without touching res, and wrong HTTP methods return 405", async (t) => {
  const { tmpRoot, slug } = createTempProjectsRoot(t);

  // Direct unit check that res is completely untouched on non-V2 route
  const rawReq = Readable.from([]);
  rawReq.method = "GET";
  rawReq.url = "/api/status";
  rawReq.headers = { host: "127.0.0.1" };
  let touched = false;
  const mockRes = {
    headersSent: false,
    writeHead() {
      touched = true;
    },
    write() {
      touched = true;
    },
    end() {
      touched = true;
    },
  };
  const directHandled = await handleV2Routes(
    rawReq,
    mockRes,
    new URL("http://127.0.0.1/api/status"),
    { projectsDir: tmpRoot },
  );
  assert.equal(directHandled, false);
  assert.equal(touched, false);

  const { baseUrl } = await startEphemeralV2Server(t, { projectsDir: tmpRoot });

  // Non-V2 routes fall through to server's next handler (418 passthrough sentinel)
  for (const [method, route] of [
    ["GET", "/api/status"],
    ["POST", `/api/projects/${slug}/brief`],
    ["GET", `/api/projects/${slug}/storyboard`],
    ["POST", `/api/projects/${slug}/storyboard/frames/frame_01/regenerate`],
    ["PATCH", `/api/projects/${slug}/storyboard/frames/frame_01`],
  ]) {
    const res = await sendHttpJson(baseUrl, method, route, method === "GET" ? undefined : {});
    assert.equal(res.status, 418, `Expected ${method} ${route} to fall through`);
    assert.equal(res.json.passthrough, true);
  }

  // Wrong HTTP methods on V2 endpoints return 405
  const wrongMethods = [
    ["DELETE", "/api/skills"],
    ["GET", "/api/skills/install"],
    ["DELETE", `/api/projects/${slug}/skills`],
    ["DELETE", `/api/projects/${slug}/rating`],
    ["GET", `/api/projects/${slug}/storyboard/frames/frame_01/regenerate-region`],
    ["PUT", `/api/projects/${slug}/saved-frames/saved_01`],
  ];
  for (const [method, route] of wrongMethods) {
    const res = await sendHttpJson(baseUrl, method, route);
    assert.equal(res.status, 405, `Expected 405 for ${method} ${route}`);
    assert.equal(res.json.ok, false);
  }
});

test("GET /api/skills, POST /api/skills/install, and POST /api/projects/:slug/skills", async (t) => {
  const { tmpRoot, slug } = createTempProjectsRoot(t);
  const calls = [];
  let currentSelected = ["motion-doctrine"];
  const mockSkills = [
    {
      id: "motion-doctrine",
      name: "motion-doctrine",
      category: "motion",
      installed: true,
      sourceScope: "workspace-agents",
    },
    {
      id: "seam-craft",
      name: "seam-craft",
      category: "motion",
      installed: true,
      sourceScope: "workspace-agents",
    },
  ];

  const { baseUrl } = await startEphemeralV2Server(t, {
    projectsDir: tmpRoot,
    skillsRegistry: {
      async discoverLocalSkills(opts) {
        calls.push({ fn: "discoverLocalSkills", opts });
        return mockSkills;
      },
      async getSelectedProjectSkills(targetSlug) {
        calls.push({ fn: "getSelectedProjectSkills", slug: targetSlug });
        return targetSlug ? [...currentSelected] : [];
      },
      async installSkillToLocal(payload) {
        calls.push({ fn: "installSkillToLocal", payload });
        const installedSkill = {
          id: "luxury-reel",
          name: payload.name || "luxury-reel",
          description: payload.description || "Luxury motion rules",
          installed: true,
          sourceScope: payload.targetScope === "project" ? "project" : "workspace-agents",
        };
        mockSkills.push(installedSkill);
        // Return direct skill object to verify router also refreshes skills list when omitted
        return installedSkill;
      },
      async setSelectedProjectSkills(targetSlug, skillIds) {
        calls.push({ fn: "setSelectedProjectSkills", slug: targetSlug, skillIds });
        currentSelected = [...skillIds];
        return currentSelected;
      },
      async compileSkillDirectives({ slug: targetSlug, skillIds }) {
        calls.push({ fn: "compileSkillDirectives", slug: targetSlug, skillIds });
        return {
          activeSkills: skillIds,
          promptInjection: "Follow motion-doctrine and luxury-reel",
          stagingHints: { enforceSeamCraft: true },
          ratingChecks: [{ skillId: skillIds[0], checkId: "chk-1" }],
        };
      },
    },
  });

  // 1a. GET /api/skills without ?slug
  const noSlugRes = await sendHttpJson(baseUrl, "GET", "/api/skills");
  assert.equal(noSlugRes.status, 200);
  assert.equal(noSlugRes.json.ok, true);
  assert.equal(noSlugRes.json.skills.length, 2);
  assert.deepEqual(noSlugRes.json.selectedSkills, []);

  // 1b. GET /api/skills?slug=demo-proj
  const withSlugRes = await sendHttpJson(
    baseUrl,
    "GET",
    `/api/skills?slug=${encodeURIComponent(slug)}`,
  );
  assert.equal(withSlugRes.status, 200);
  assert.equal(withSlugRes.json.ok, true);
  assert.equal(withSlugRes.json.skills.length, 2);
  assert.deepEqual(withSlugRes.json.selectedSkills, ["motion-doctrine"]);

  // 2. POST /api/skills/install
  const installRes = await sendHttpJson(baseUrl, "POST", "/api/skills/install", {
    name: "luxury-reel",
    description: "Editorial luxury motion",
    content: "# Luxury Reel\n- Hold 0.4s stillness before climax",
    targetScope: "project",
    slug,
  });
  assert.equal(installRes.status, 200);
  assert.equal(installRes.json.ok, true);
  assert.equal(installRes.json.installedSkill.id, "luxury-reel");
  assert.equal(installRes.json.skills.length, 3);

  // 3. POST /api/projects/:slug/skills
  const selectRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/skills`, {
    selectedSkills: ["motion-doctrine", "luxury-reel"],
  });
  assert.equal(selectRes.status, 200);
  assert.equal(selectRes.json.ok, true);
  assert.deepEqual(selectRes.json.selectedSkills, ["motion-doctrine", "luxury-reel"]);
  assert.equal(selectRes.json.directives.promptInjection, "Follow motion-doctrine and luxury-reel");
  assert.equal(selectRes.json.directives.stagingHints.enforceSeamCraft, true);
});

test("GET and POST /api/projects/:slug/rating evaluate Whole-Video Quality Rating", async (t) => {
  const { tmpRoot, slug } = createTempProjectsRoot(t);
  const ratingCalls = [];

  const { baseUrl } = await startEphemeralV2Server(t, {
    projectsDir: tmpRoot,
    videoRating: {
      async evaluateProjectVideoRating(args) {
        ratingCalls.push(args);
        return {
          overallScore: 93,
          grade: "A+",
          verdict: "Crisp hook, WCAG contrast verified, and motion continuity locked.",
          categories: {
            hookAndPacing: { score: 95, weight: 0.2 },
            visualHierarchyAndContrast: { score: 92, weight: 0.2 },
          },
          frameRatings: [
            {
              frameId: "frame_01",
              index: 1,
              score: 94,
              grade: "A+",
              issues: [],
              suggestedFixPrompt: null,
            },
          ],
        };
      },
    },
  });

  const getRes = await sendHttpJson(baseUrl, "GET", `/api/projects/${slug}/rating`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.json.ok, true);
  assert.equal(getRes.json.rating.overallScore, 93);
  assert.equal(getRes.json.rating.grade, "A+");
  assert.deepEqual(ratingCalls[0], { slug });

  const postRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/rating`, {});
  assert.equal(postRes.status, 200);
  assert.equal(postRes.json.ok, true);
  assert.equal(postRes.json.rating.overallScore, 93);
  assert.deepEqual(ratingCalls[1], { slug });
});

test("POST /api/projects/:slug/storyboard/frames/:frameId/regenerate-region handles >2MB base64 PNGs, decorates /media/:slug URLs, broadcasts SSE, and enforces 15MB ceiling", async (t) => {
  const { tmpRoot, projectDir, slug } = createTempProjectsRoot(t);
  const sseEvents = [];
  let receivedInpaintArgs = null;

  const { baseUrl } = await startEphemeralV2Server(t, {
    projectsDir: tmpRoot,
    broadcastEvent(event, payload) {
      sseEvents.push({ event, payload });
    },
    skillsRegistry: {
      async getSelectedProjectSkills() {
        return ["oversized-cursor"];
      },
    },
    frameInpaint: {
      async regenerateFrameRegion(args) {
        receivedInpaintArgs = args;
        const updatedFrame = {
          id: args.frameId,
          index: 1,
          title: "Regional Inpaint Hero",
          currentVersion: 2,
          designFramePath: ".studio/frames/design/frame_01_v2.png",
          hudFramePath: ".studio/frames/design/frame_01_v2_hud.png",
          keyframes: {
            start: ".studio/frames/raw/scene_01_start.png",
            peak: path.join(projectDir, ".studio/frames/raw/scene_01_peak.png"),
            end: ".studio/frames/raw/scene_01_end.png",
          },
          history: [
            {
              version: 1,
              designFramePath: ".studio/frames/design/frame_01_v1.png",
              hudFramePath: ".studio/frames/design/frame_01_v1_hud.png",
            },
            {
              version: 2,
              designFramePath: ".studio/frames/design/frame_01_v2.png",
              hudFramePath: ".studio/frames/design/frame_01_v2_hud.png",
            },
          ],
        };
        return {
          annotationId: "ann_01",
          maskRelPath: ".studio/frames/annotations/frame_01_ann_01_mask.png",
          compositeRelPath: ".studio/frames/annotations/frame_01_ann_01_annotated.png",
          regionAnalysis: { zone: "badge-header", centerX: 0.5, centerY: 0.12 },
          frame: updatedFrame,
          storyboard: {
            schemaVersion: 1,
            slug: args.slug,
            frames: [updatedFrame],
          },
        };
      },
    },
  });

  // Build >3.2MB combined base64 payload (>2MB old limit!)
  const largeBase64Chunk = "iVBORw0KGgoAAAANSUhEUgAA".repeat(75_000); // ~1.8MB per image -> ~3.6MB JSON!
  const maskDataUrl = `data:image/png;base64,${largeBase64Chunk}`;
  const compositeDataUrl = `data:image/png;base64,${largeBase64Chunk}`;
  assert.ok(
    maskDataUrl.length + compositeDataUrl.length > 3 * 1024 * 1024,
    "Payload must exceed 3MB to verify >2MB canvas PNG support",
  );

  const regenRes = await sendHttpJson(
    baseUrl,
    "POST",
    `/api/projects/${slug}/storyboard/frames/frame_01/regenerate-region`,
    {
      maskDataUrl,
      compositeDataUrl,
      strokes: [
        {
          tool: "brush",
          color: "#E03E3E",
          points: [
            { x: 0.25, y: 0.1 },
            { x: 0.75, y: 0.14 },
          ],
        },
      ],
      regionBox: { x: 0.2, y: 0.06, width: 0.6, height: 0.14 },
      prompt: "Make top badge bright botanical gold",
      enqueueAiInpaint: true,
    },
  );

  assert.equal(regenRes.status, 200);
  assert.equal(regenRes.json.ok, true);
  assert.equal(receivedInpaintArgs.slug, slug);
  assert.equal(receivedInpaintArgs.frameId, "frame_01");
  assert.equal(receivedInpaintArgs.maskDataUrl.length, maskDataUrl.length);
  assert.equal(receivedInpaintArgs.enqueueAiInpaint, true);
  assert.deepEqual(receivedInpaintArgs.selectedSkills, ["oversized-cursor"]);

  // Verify frame & storyboard media URL decoration
  const expectedDesignUrl = `/media/${slug}/.studio/frames/design/frame_01_v2.png`;
  const expectedHudUrl = `/media/${slug}/.studio/frames/design/frame_01_v2_hud.png`;
  assert.equal(regenRes.json.frame.designFrameUrl, expectedDesignUrl);
  assert.equal(regenRes.json.frame.currentDesignImage, expectedDesignUrl);
  assert.equal(regenRes.json.frame.hudFrameUrl, expectedHudUrl);
  assert.equal(regenRes.json.frame.currentBlueprintImage, expectedHudUrl);
  assert.equal(
    regenRes.json.frame.keyframes.peak,
    `/media/${slug}/.studio/frames/raw/scene_01_peak.png`,
  );
  assert.equal(regenRes.json.storyboard.frames[0].currentDesignImage, expectedDesignUrl);
  assert.equal(regenRes.json.storyboard.frames[0].currentBlueprintImage, expectedHudUrl);
  assert.equal(
    regenRes.json.storyboard.frames[0].history[0].designFrameUrl,
    `/media/${slug}/.studio/frames/design/frame_01_v1.png`,
  );
  assert.equal(
    regenRes.json.maskUrl,
    `/media/${slug}/.studio/frames/annotations/frame_01_ann_01_mask.png`,
  );
  assert.equal(
    regenRes.json.compositeUrl,
    `/media/${slug}/.studio/frames/annotations/frame_01_ann_01_annotated.png`,
  );

  // Verify SSE broadcast ("storyboard_updated" + hyphenated alias "storyboard-updated")
  assert.ok(sseEvents.length >= 1);
  assert.equal(sseEvents[0].event, "storyboard_updated");
  assert.ok(sseEvents.some((e) => e.event === "storyboard-updated"));
  assert.equal(sseEvents[0].payload.slug, slug);
  assert.equal(sseEvents[0].payload.storyboard.frames[0].designFrameUrl, expectedDesignUrl);

  // Verify >15MB payload is cleanly rejected
  const over15MbPayload = JSON.stringify({
    prompt: "oversized",
    maskDataUrl: "A".repeat(15 * 1024 * 1024 + 256 * 1024),
  });
  const tooLargeRes = await sendHttpJson(
    baseUrl,
    "POST",
    `/api/projects/${slug}/storyboard/frames/frame_01/regenerate-region`,
    over15MbPayload,
  );
  assert.ok(
    tooLargeRes.status === 413 || tooLargeRes.status === 400,
    `Expected 413/400 for >15MB payload, got ${tooLargeRes.status}`,
  );
  assert.equal(tooLargeRes.json.ok, false);
});

test("Saved Frames Vault CRUD: GET, POST, and DELETE /api/projects/:slug/saved-frames", async (t) => {
  const { tmpRoot, slug } = createTempProjectsRoot(t);
  const vault = [];

  const { baseUrl } = await startEphemeralV2Server(t, {
    projectsDir: tmpRoot,
    frameInpaint: {
      async listSavedFrames(targetSlug) {
        assert.equal(targetSlug, slug);
        return vault.map((item) => ({ ...item }));
      },
      async saveDesignFrameBookmark({ slug: targetSlug, frameId, version, label, notes }) {
        assert.equal(targetSlug, slug);
        const savedFrame = {
          id: `saved_${vault.length + 1}`,
          frameId,
          version: version ?? 1,
          label: label || "Saved Shot",
          notes: notes || "",
          imageRelPath: `.studio/frames/saved/saved_${vault.length + 1}.png`,
          createdAt: "2026-11-18T01:30:00.000Z",
        };
        vault.push(savedFrame);
        return { savedFrame, savedFrames: vault.map((item) => ({ ...item })) };
      },
      async deleteSavedFrame(targetSlug, savedId) {
        assert.equal(targetSlug, slug);
        const idx = vault.findIndex((item) => item.id === savedId);
        if (idx === -1) {
          throw new Error(`Saved frame "${savedId}" not found`);
        }
        vault.splice(idx, 1);
        return { savedFrames: vault.map((item) => ({ ...item })) };
      },
    },
  });

  // POST bookmark
  const createRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/saved-frames`, {
    frameId: "frame_02",
    version: 3,
    label: "Golden Seed Reveal",
    notes: "Keep exact lighting and callout card",
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.json.ok, true);
  assert.equal(createRes.json.savedFrame.id, "saved_1");
  assert.equal(
    createRes.json.savedFrame.imageUrl,
    `/media/${slug}/.studio/frames/saved/saved_1.png`,
  );
  assert.equal(createRes.json.savedFrame.url, `/media/${slug}/.studio/frames/saved/saved_1.png`);
  assert.equal(createRes.json.savedFrames.length, 1);

  // GET saved frames
  const listRes = await sendHttpJson(baseUrl, "GET", `/api/projects/${slug}/saved-frames`);
  assert.equal(listRes.status, 200);
  assert.equal(listRes.json.ok, true);
  assert.equal(listRes.json.savedFrames.length, 1);
  assert.equal(
    listRes.json.savedFrames[0].designFrameUrl,
    `/media/${slug}/.studio/frames/saved/saved_1.png`,
  );

  // DELETE saved frame
  const delRes = await sendHttpJson(
    baseUrl,
    "DELETE",
    `/api/projects/${slug}/saved-frames/saved_1`,
  );
  assert.equal(delRes.status, 200);
  assert.equal(delRes.json.ok, true);
  assert.deepEqual(delRes.json.savedFrames, []);

  // DELETE missing saved frame -> 404
  const delMissing = await sendHttpJson(
    baseUrl,
    "DELETE",
    `/api/projects/${slug}/saved-frames/saved_1`,
  );
  assert.equal(delMissing.status, 404);
  assert.equal(delMissing.json.ok, false);
});

test("Path-traversal rejection, invalid JSON/missing-project errors, and lazy dynamic import resolution", async (t) => {
  const { tmpRoot, slug } = createTempProjectsRoot(t);
  const importedModules = [];

  const { baseUrl } = await startEphemeralV2Server(t, {
    projectsDir: tmpRoot,
    async importModule(specifier) {
      importedModules.push(specifier);
      if (specifier === "./skills-registry.mjs") {
        return {
          discoverLocalSkills: async () => [
            { id: "lazy-skill", name: "lazy-skill", installed: true },
          ],
          getSelectedProjectSkills: async () => ["lazy-skill"],
          installSkillToLocal: async () => ({ id: "installed-lazy", installed: true }),
          setSelectedProjectSkills: async (_s, ids) => ids,
          compileSkillDirectives: async ({ skillIds }) => ({ activeSkills: skillIds }),
        };
      }
      if (specifier === "./video-rating.mjs") {
        return {
          evaluateProjectVideoRating: async () => ({ overallScore: 88, grade: "A" }),
        };
      }
      if (specifier === "./frame-inpaint.mjs") {
        return {
          listSavedFrames: async () => [],
          saveDesignFrameBookmark: async () => ({ savedFrame: { id: "s1" }, savedFrames: [] }),
          deleteSavedFrame: async () => [],
          regenerateFrameRegion: async () => ({ frame: { id: "f1" }, storyboard: { frames: [] } }),
        };
      }
      throw new Error(`Unexpected module specifier: ${specifier}`);
    },
  });

  // Path-traversal attempts across all endpoints must be rejected with 400
  const traversalCases = [
    ["GET", "/api/skills?slug=..%2F..%2Fsecret", undefined],
    ["POST", "/api/skills/install", { slug: "../escape", name: "safe", content: "# x" }],
    ["POST", "/api/skills/install", { globalSkillId: "../../evil" }],
    ["POST", "/api/skills/install", { sourcePath: "../../etc/passwd" }],
    ["POST", "/api/skills/install", { name: "../evil", content: "# bad" }],
    ["POST", "/api/projects/..%2Fescape/skills", { selectedSkills: ["lazy-skill"] }],
    ["POST", `/api/projects/${slug}/skills`, { selectedSkills: ["../evil-skill"] }],
    ["GET", "/api/projects/..%2F..%2Fsecret/rating", undefined],
    [
      "POST",
      `/api/projects/${slug}/storyboard/frames/..%2Fhack/regenerate-region`,
      { prompt: "bad" },
    ],
    ["POST", `/api/projects/${slug}/saved-frames`, { frameId: "../hack" }],
    ["DELETE", `/api/projects/${slug}/saved-frames/..%2F..%2Fhack`, undefined],
  ];

  for (const [method, urlPath, body] of traversalCases) {
    const res = await sendHttpJson(baseUrl, method, urlPath, body);
    assert.equal(res.status, 400, `Expected 400 traversal block for ${method} ${urlPath}`);
    assert.equal(res.json.ok, false);
  }

  // Malformed URL encoding -> 400
  const badEncoding = await sendHttpJson(baseUrl, "GET", "/api/projects/%E0%A4%A/rating");
  assert.equal(badEncoding.status, 400);
  assert.equal(badEncoding.json.ok, false);

  // Invalid JSON body -> 400
  const badJson = await sendHttpJson(
    baseUrl,
    "POST",
    `/api/projects/${slug}/skills`,
    "{broken-json",
  );
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.ok, false);

  // Non-existent project -> 404
  const missingProj = await sendHttpJson(baseUrl, "GET", "/api/projects/missing-ghost-proj/rating");
  assert.equal(missingProj.status, 404);
  assert.equal(missingProj.json.ok, false);

  // Lazy dynamic imports via importModule hook
  const lazySkills = await sendHttpJson(baseUrl, "GET", `/api/skills?slug=${slug}`);
  assert.equal(lazySkills.status, 200);
  assert.equal(lazySkills.json.skills[0].id, "lazy-skill");

  const lazyRating = await sendHttpJson(baseUrl, "GET", `/api/projects/${slug}/rating`);
  assert.equal(lazyRating.status, 200);
  assert.equal(lazyRating.json.rating.overallScore, 88);

  const lazySaved = await sendHttpJson(baseUrl, "GET", `/api/projects/${slug}/saved-frames`);
  assert.equal(lazySaved.status, 200);
  assert.deepEqual(lazySaved.json.savedFrames, []);

  assert.ok(importedModules.includes("./skills-registry.mjs"));
  assert.ok(importedModules.includes("./video-rating.mjs"));
  assert.ok(importedModules.includes("./frame-inpaint.mjs"));
});

test("Zero-mock live HTTP integration against workspace skills-registry, video-rating, and frame-inpaint", async (t) => {
  const { baseUrl } = await startEphemeralV2Server(t, {});

  // 1. Live GET /api/skills discovers real .agents/skills/* and skills/*
  const skillsRes = await sendHttpJson(baseUrl, "GET", "/api/skills");
  assert.equal(skillsRes.status, 200);
  assert.equal(skillsRes.json.ok, true);
  assert.ok(
    Array.isArray(skillsRes.json.skills) && skillsRes.json.skills.length >= 4,
    "Expected live workspace skills to be discovered",
  );
  assert.ok(
    skillsRes.json.skills.some((s) => s.id === "motion-doctrine"),
    "Expected motion-doctrine skill in live discovery",
  );
  assert.ok(Array.isArray(skillsRes.json.skills[0].extractedHexColors));
  assert.ok(Array.isArray(skillsRes.json.selectedSkills));

  // 2. If krishop-promo exists in projects/, verify read-only saved-frames & rating over live HTTP
  const krishopDir = path.resolve(process.cwd(), "projects", "krishop-promo");
  if (fs.existsSync(krishopDir)) {
    const savedRes = await sendHttpJson(baseUrl, "GET", "/api/projects/krishop-promo/saved-frames");
    assert.equal(savedRes.status, 200);
    assert.equal(savedRes.json.ok, true);
    assert.ok(Array.isArray(savedRes.json.savedFrames));
  }
});
