import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as lib from "../lib.mjs";
import {
  discoverLocalSkills,
  installSkillToLocal,
  getSelectedProjectSkills,
  setSelectedProjectSkills,
  compileSkillDirectives,
} from "../skills-registry.mjs";

const TEST_ID_SUFFIX = `${process.pid}-${Date.now()}`;
const TEST_SLUG = `test-skills-reg-${TEST_ID_SUFFIX}`;
const TEST_PROJECT_DIR = path.join(lib.PROJECTS_DIR, TEST_SLUG);
const WORKSPACE_TEMP_SKILL_ID = `tmp-ws-skill-${TEST_ID_SUFFIX}`;
const WORKSPACE_TEMP_SKILL_DIR = path.join(
  lib.ROOT_DIR,
  ".agents",
  "skills",
  WORKSPACE_TEMP_SKILL_ID,
);

let tempRoot = "";
let mockGlobalSkillsDir = "";
let externalSkillSourceDir = "";
let savedCurrentProjectRaw = null;
let hadCurrentProjectFile = false;

before(async () => {
  hadCurrentProjectFile = fs.existsSync(lib.CURRENT_PROJECT_FILE);
  if (hadCurrentProjectFile) {
    savedCurrentProjectRaw = fs.readFileSync(lib.CURRENT_PROJECT_FILE, "utf8");
  }

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-skills-reg-"));
  mockGlobalSkillsDir = path.join(tempRoot, "global-skills");
  externalSkillSourceDir = path.join(tempRoot, "external-luxury-motion");

  // 1. Mock global library with one uninstalled skill and one mirrored skill ("motion-doctrine")
  const globalUninstalledDir = path.join(mockGlobalSkillsDir, "editorial-monochrome-pack");
  fs.mkdirSync(globalUninstalledDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalUninstalledDir, "SKILL.md"),
    `---
name: editorial-monochrome-pack
description: Clean editorial monochrome UI and bento grid layout rules with strict contrast.
---

# Editorial Monochrome Pack

- Use warm off-white #FBFBFA canvas and crisp #111111 ink for primary typography.
- Maintain WCAG AAA contrast >= 7.0:1 across all cards and callout badges.
- DO NOT use gradients, neon glows, or heavy drop shadows.
- Structure feature breakdowns as asymmetric bento grids with 1px #EAEAEA borders.
- Animate entrances with power3.out stagger cascades over 240ms.
`,
    "utf8",
  );

  const globalMirroredDir = path.join(mockGlobalSkillsDir, "motion-doctrine");
  fs.mkdirSync(globalMirroredDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalMirroredDir, "SKILL.md"),
    `---
name: motion-doctrine
description: Global mirror copy of motion-doctrine.
---
- Global mirror bullet.
`,
    "utf8",
  );

  // 2. External local folder skill with SKILL.md + references/ + scripts/ + assets/
  fs.mkdirSync(path.join(externalSkillSourceDir, "references"), { recursive: true });
  fs.mkdirSync(path.join(externalSkillSourceDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(externalSkillSourceDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(externalSkillSourceDir, "SKILL.md"),
    `---
name: external-luxury-motion
description: "High-velocity zoom-through and 3D device showcase choreography with #D4AF37 gold accents."
---

# External Luxury Motion

1. Open hook scenes within 0.12s using a power4.out zoom-through vector.
2. Showcase hero app screens in a 3D perspective iPhone mockup at 14deg tilt.
3. Pair #0B0D10 obsidian backgrounds with #D4AF37 gold highlights and #F8FAFC body copy.
4. Never hold a static talking-head frame longer than 2.8s without a camera creep or whip-pan.
5. Enforce contrast >= 6.5:1 on every lower-third badge.
6. Extra sixth rule that should be capped at top 5 highlights.
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(externalSkillSourceDir, "references", "camera-vectors.md"),
    "# Camera Vectors\n- Match exit and entry velocity.\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(externalSkillSourceDir, "scripts", "check-vectors.mjs"),
    "export const ok = true;\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(externalSkillSourceDir, "assets", "tokens.json"),
    JSON.stringify({ gold: "#D4AF37" }),
    "utf8",
  );

  await lib.createProject({
    title: "Skills Registry Test Project",
    slug: TEST_SLUG,
    aspectRatio: "9:16",
    durationSeconds: 20,
  });
  if (hadCurrentProjectFile && savedCurrentProjectRaw !== null) {
    fs.writeFileSync(lib.CURRENT_PROJECT_FILE, savedCurrentProjectRaw, "utf8");
  }
});

after(() => {
  try {
    if (fs.existsSync(TEST_PROJECT_DIR)) {
      fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
  try {
    if (fs.existsSync(WORKSPACE_TEMP_SKILL_DIR)) {
      fs.rmSync(WORKSPACE_TEMP_SKILL_DIR, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
  try {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
  if (hadCurrentProjectFile && savedCurrentProjectRaw !== null) {
    fs.writeFileSync(lib.CURRENT_PROJECT_FILE, savedCurrentProjectRaw, "utf8");
  }
});

test("discoverLocalSkills dynamically scans .agents/skills, skills/, project skills, and global library", () => {
  const skills = discoverLocalSkills({
    slug: TEST_SLUG,
    globalSkillsDir: mockGlobalSkillsDir,
  });

  assert.ok(Array.isArray(skills), "skills should be an array");
  assert.ok(skills.length >= 10, "should discover real workspace skills plus mock global skill");

  // Workspace .agents/skills check
  const motionDoctrine = skills.find((s) => s.id === "motion-doctrine");
  assert.ok(motionDoctrine, "should discover .agents/skills/motion-doctrine");
  assert.equal(motionDoctrine.sourceScope, "workspace-agents");
  assert.equal(motionDoctrine.installed, true);
  assert.equal(motionDoctrine.category, "motion");
  assert.ok(motionDoctrine.description.includes("continuous camera move"));
  assert.ok(Array.isArray(motionDoctrine.ruleHighlights));
  assert.ok(
    motionDoctrine.ruleHighlights.length >= 3 && motionDoctrine.ruleHighlights.length <= 5,
    "should extract top concrete rule highlights",
  );
  assert.ok(motionDoctrine.motionKeywords.length > 0, "should extract motion keywords");

  // Captions category check
  const captionsOverlay = skills.find((s) => s.id === "captions-overlay");
  assert.ok(captionsOverlay, "should discover .agents/skills/captions-overlay");
  assert.equal(captionsOverlay.category, "captions");
  assert.equal(captionsOverlay.installed, true);

  // Workspace skills/ check
  const hyperframesCore = skills.find((s) => s.id === "hyperframes");
  assert.ok(hyperframesCore, "should discover skills/hyperframes");
  assert.equal(hyperframesCore.sourceScope, "workspace-skills");
  assert.equal(hyperframesCore.installed, true);

  // Uninstalled global skill check
  const globalMono = skills.find((s) => s.id === "editorial-monochrome-pack");
  assert.ok(globalMono, "should discover uninstalled skill in globalSkillsDir");
  assert.equal(globalMono.sourceScope, "global-available");
  assert.equal(globalMono.installed, false);
  assert.equal(globalMono.category, "design");
  assert.ok(globalMono.ExtractedHexColors.includes("#FBFBFA"));
  assert.ok(globalMono.ExtractedHexColors.includes("#111111"));

  // Unique IDs invariant (no duplicate keys for React UI)
  const uniqueIds = new Set(skills.map((s) => s.id));
  assert.equal(uniqueIds.size, skills.length, "all discovered skill IDs must be unique");

  // Live runtime discovery: dropping a new folder into projects/<slug>/skills/ is picked up immediately
  const liveDropDir = path.join(TEST_PROJECT_DIR, "skills", "live-dropped-brand");
  fs.mkdirSync(liveDropDir, { recursive: true });
  fs.writeFileSync(
    path.join(liveDropDir, "SKILL.md"),
    `---
name: live-dropped-brand
description: Brand guidelines and #1E824C emerald color system dropped at runtime.
---
- Primary brand emerald #1E824C and gold #F1C40F must anchor callouts.
- Keep logo clearspace >= 24px from frame edges.
`,
    "utf8",
  );

  const rescanned = discoverLocalSkills({
    slug: TEST_SLUG,
    globalSkillsDir: mockGlobalSkillsDir,
  });
  const liveDropped = rescanned.find((s) => s.id === "live-dropped-brand");
  assert.ok(liveDropped, "newly dropped project skill must be discovered immediately at runtime");
  assert.equal(liveDropped.sourceScope, "project");
  assert.equal(liveDropped.installed, true);
  assert.equal(liveDropped.category, "brand");
  assert.deepEqual(liveDropped.ExtractedHexColors, ["#1E824C", "#F1C40F"]);
});

test("installSkillToLocal supports sourcePath copy, globalSkillId copy, custom Markdown creation, and rejects path traversal", async () => {
  // Mode 1: Copy entire external skill folder (SKILL.md + references/ + scripts/ + assets/) into project
  const extRes = await installSkillToLocal({
    sourcePath: externalSkillSourceDir,
    targetScope: "project",
    slug: TEST_SLUG,
    globalSkillsDir: mockGlobalSkillsDir,
  });

  assert.equal(extRes.installedSkill.id, "external-luxury-motion");
  assert.equal(extRes.installedSkill.installed, true);
  assert.equal(extRes.installedSkill.sourceScope, "project");
  assert.equal(extRes.installedSkill.ruleHighlights.length, 5);
  assert.ok(extRes.installedSkill.ExtractedHexColors.includes("#D4AF37"));
  assert.ok(extRes.installedSkill.motionKeywords.includes("zoom-through"));

  const copiedProjectSkillDir = path.join(TEST_PROJECT_DIR, "skills", "external-luxury-motion");
  assert.ok(fs.existsSync(path.join(copiedProjectSkillDir, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(copiedProjectSkillDir, "references", "camera-vectors.md")));
  assert.ok(fs.existsSync(path.join(copiedProjectSkillDir, "scripts", "check-vectors.mjs")));
  assert.ok(fs.existsSync(path.join(copiedProjectSkillDir, "assets", "tokens.json")));
  // Non-destructive verification: original external source directory remains intact
  assert.ok(fs.existsSync(path.join(externalSkillSourceDir, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(externalSkillSourceDir, "references", "camera-vectors.md")));

  // Mode 2: Install global available skill by globalSkillId into project
  const globalRes = await installSkillToLocal({
    globalSkillId: "editorial-monochrome-pack",
    targetScope: "project",
    slug: TEST_SLUG,
    globalSkillsDir: mockGlobalSkillsDir,
  });
  assert.equal(globalRes.installedSkill.id, "editorial-monochrome-pack");
  assert.equal(globalRes.installedSkill.installed, true);
  const nowMirrored = globalRes.skills.find((s) => s.id === "editorial-monochrome-pack");
  assert.ok(nowMirrored);
  assert.equal(nowMirrored.installed, true);

  // Mode 3a: Create custom skill in project scope from { name, description, content }
  const customProjRes = await installSkillToLocal({
    name: "Custom Bengali Kinetic Rules",
    description: "Custom rules for crisp Bengali headlines, #0F172A slate ink, and fast cuts.",
    content: `# Custom Bengali Kinetic Rules

- Keep every shot <= 3.0s with whip-pan or cut-the-curve transitions.
- Render headlines in #0F172A over #FFFFFF cards with contrast >= 7.5:1.
- DO NOT place captions over product prices in the bottom 80px band.
`,
    targetScope: "project",
    slug: TEST_SLUG,
    globalSkillsDir: mockGlobalSkillsDir,
  });
  assert.equal(customProjRes.installedSkill.id, "custom-bengali-kinetic-rules");
  const writtenCustomMd = fs.readFileSync(
    path.join(TEST_PROJECT_DIR, "skills", "custom-bengali-kinetic-rules", "SKILL.md"),
    "utf8",
  );
  assert.match(writtenCustomMd, /^---\r?\nname: custom-bengali-kinetic-rules/);
  assert.match(writtenCustomMd, /description:/);

  // Mode 3b: Create custom skill in workspace scope (.agents/skills/<id>/SKILL.md) and verify discovery
  const wsRes = await installSkillToLocal({
    name: WORKSPACE_TEMP_SKILL_ID,
    description: "Temporary workspace skill for unit test verification.",
    content: "- Enforce crisp 16px border radius and #111111 primary CTA.\n",
    targetScope: "workspace",
    globalSkillsDir: mockGlobalSkillsDir,
  });
  assert.equal(wsRes.installedSkill.id, WORKSPACE_TEMP_SKILL_ID);
  assert.equal(wsRes.installedSkill.sourceScope, "workspace-agents");
  assert.ok(fs.existsSync(path.join(WORKSPACE_TEMP_SKILL_DIR, "SKILL.md")));
  fs.rmSync(WORKSPACE_TEMP_SKILL_DIR, { recursive: true, force: true });

  // Strict path-traversal rejections
  await assert.rejects(() =>
    installSkillToLocal({
      globalSkillId: "../../Windows/System32",
      targetScope: "workspace",
      globalSkillsDir: mockGlobalSkillsDir,
    }),
  );
  await assert.rejects(() =>
    installSkillToLocal({
      sourcePath: "../../etc/passwd",
      targetScope: "project",
      slug: TEST_SLUG,
    }),
  );
  await assert.rejects(() =>
    installSkillToLocal({
      name: "../../escape-attempt",
      description: "malicious",
      content: "- bad",
      targetScope: "workspace",
    }),
  );
  await assert.rejects(() =>
    installSkillToLocal({
      name: "valid-name",
      description: "bad slug",
      content: "- test",
      targetScope: "project",
      slug: "../escape-project",
    }),
  );
});

test("getSelectedProjectSkills & setSelectedProjectSkills persist to PROJECT_BRIEF.json and update AI_READY_PROMPT.md idempotently", async () => {
  assert.deepEqual(getSelectedProjectSkills(TEST_SLUG), []);
  assert.deepEqual(getSelectedProjectSkills(null), []);

  const chosen = [
    "motion-doctrine",
    "captions-overlay",
    "editorial-monochrome-pack",
    "custom-bengali-kinetic-rules",
  ];
  const saved = await setSelectedProjectSkills(TEST_SLUG, chosen, {
    globalSkillsDir: mockGlobalSkillsDir,
  });

  assert.deepEqual(saved, chosen);
  assert.deepEqual(getSelectedProjectSkills(TEST_SLUG), chosen);

  const briefJson = JSON.parse(
    fs.readFileSync(path.join(TEST_PROJECT_DIR, "PROJECT_BRIEF.json"), "utf8"),
  );
  assert.deepEqual(briefJson.selectedSkills, chosen);
  assert.equal(briefJson.slug, TEST_SLUG);

  const promptMdFirst = fs.readFileSync(path.join(TEST_PROJECT_DIR, "AI_READY_PROMPT.md"), "utf8");
  assert.match(promptMdFirst, /## Active Dynamic Skills/);
  assert.match(promptMdFirst, /motion-doctrine/);
  assert.match(promptMdFirst, /captions-overlay/);
  assert.match(promptMdFirst, /custom-bengali-kinetic-rules/);
  assert.match(promptMdFirst, /7\.5:1/);

  // Re-running setSelectedProjectSkills replaces the section cleanly without duplication
  const updatedSelection = ["oversized-cursor", "seam-craft"];
  await setSelectedProjectSkills(TEST_SLUG, updatedSelection, {
    globalSkillsDir: mockGlobalSkillsDir,
  });
  const promptMdSecond = fs.readFileSync(path.join(TEST_PROJECT_DIR, "AI_READY_PROMPT.md"), "utf8");
  const headingMatches = promptMdSecond.match(/## Active Dynamic Skills/g) || [];
  assert.equal(headingMatches.length, 1, "must not duplicate ## Active Dynamic Skills section");
  assert.match(promptMdSecond, /oversized-cursor/);
  assert.match(promptMdSecond, /seam-craft/);
  assert.doesNotMatch(promptMdSecond, /custom-bengali-kinetic-rules/);

  // Verify durability across lib.syncProjectManifest() fixed-key manifest rewrites via .studio/selected-skills.json
  await lib.syncProjectManifest(TEST_SLUG);
  assert.deepEqual(
    getSelectedProjectSkills(TEST_SLUG),
    updatedSelection,
    "getSelectedProjectSkills must survive subsequent syncProjectManifest calls via .studio/selected-skills.json",
  );
});

test("compileSkillDirectives dynamically compiles stagingHints, promptInjection, and ratingChecks from selected SKILL.md files", () => {
  const skillIds = [
    "motion-doctrine",
    "captions-overlay",
    "oversized-cursor",
    "seam-craft",
    "editorial-monochrome-pack",
    "external-luxury-motion",
  ];

  const directives = compileSkillDirectives({
    slug: TEST_SLUG,
    skillIds,
    globalSkillsDir: mockGlobalSkillsDir,
  });

  assert.equal(directives.activeSkills.length, 6);
  assert.ok(typeof directives.promptInjection === "string");
  assert.ok(directives.promptInjection.length > 120);
  assert.match(directives.promptInjection, /motion-doctrine/);
  assert.match(directives.promptInjection, /editorial-monochrome-pack/);

  // Staging hints derived dynamically from selected skills
  assert.equal(directives.stagingHints.preferMinimalPalette, true);
  assert.equal(directives.stagingHints.enforceCaptionOverlay, true);
  assert.equal(directives.stagingHints.includeOversizedCursor, true);
  assert.equal(directives.stagingHints.enforceSeamCraft, true);
  assert.ok(Array.isArray(directives.stagingHints.preferredArchetypes));
  assert.ok(directives.stagingHints.preferredArchetypes.includes("spotlight-cursor-zoom"));
  assert.ok(directives.stagingHints.preferredArchetypes.includes("bento-feature-grid"));
  assert.ok(directives.stagingHints.preferredArchetypes.includes("device-3d-showcase"));
  assert.equal(
    directives.stagingHints.contrastFloor,
    7,
    "should elevate contrastFloor dynamically to highest parsed ratio (7.0:1 from editorial-monochrome-pack)",
  );

  // Structured rating checks covering every selected skill
  assert.ok(Array.isArray(directives.ratingChecks));
  assert.ok(directives.ratingChecks.length >= 6);
  for (const id of skillIds) {
    assert.ok(
      directives.ratingChecks.some((chk) => chk.skillId === id),
      `ratingChecks should include at least one check for ${id}`,
    );
  }
  for (const chk of directives.ratingChecks) {
    assert.ok(chk.skillId && typeof chk.skillId === "string");
    assert.ok(chk.skillName && typeof chk.skillName === "string");
    assert.ok(chk.checkId && typeof chk.checkId === "string");
    assert.ok(chk.description && typeof chk.description === "string");
    assert.ok(chk.ruleType && typeof chk.ruleType === "string");
  }

  // Omitting skillIds automatically compiles from persisted getSelectedProjectSkills(slug)
  const autoDirectives = compileSkillDirectives({
    slug: TEST_SLUG,
    globalSkillsDir: mockGlobalSkillsDir,
  });
  assert.deepEqual(
    autoDirectives.activeSkills.map((s) => s.id),
    ["oversized-cursor", "seam-craft"],
  );
});
