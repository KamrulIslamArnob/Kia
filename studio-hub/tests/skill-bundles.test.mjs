import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as lib from "../lib.mjs";
import { discoverLocalSkills, setSelectedProjectSkills } from "../skills-registry.mjs";
import { exportSkillBundle, importSkillBundle } from "../skill-bundles.mjs";

const TEST_SUFFIX = `${process.pid}-${Date.now()}`;
const TEST_SLUG = `test-skill-bundles-${TEST_SUFFIX}`;
const TEST_PROJECT_DIR = path.join(lib.PROJECTS_DIR, TEST_SLUG);

let tempRoot = "";
let secondDeviceRoot = "";
let savedCurrentProjectRaw = null;
let hadCurrentProjectFile = false;

before(async () => {
  hadCurrentProjectFile = fs.existsSync(lib.CURRENT_PROJECT_FILE);
  if (hadCurrentProjectFile) {
    savedCurrentProjectRaw = fs.readFileSync(lib.CURRENT_PROJECT_FILE, "utf8");
  }

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-skill-bundles-"));
  secondDeviceRoot = path.join(tempRoot, "second-device-workspace");
  fs.mkdirSync(secondDeviceRoot, { recursive: true });

  await lib.createProject({
    title: "Skill Bundles Test Project",
    slug: TEST_SLUG,
    aspectRatio: "9:16",
    durationSeconds: 18,
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

test("exportSkillBundle packages SKILL.md and references/*.md into a portable .studioskills.json file", async () => {
  const bundleFilePath = path.join(tempRoot, "director-pack.studioskills.json");
  const exported = await exportSkillBundle({
    skillIds: ["motion-doctrine", "rea-video", "captions-overlay"],
    outFilePath: bundleFilePath,
  });

  assert.equal(exported.format, "studioskills-v1");
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.skillCount, 3);
  assert.equal(exported.outFilePath, bundleFilePath);
  assert.ok(typeof exported.checksumSha256 === "string" && exported.checksumSha256.length === 64);
  assert.ok(fs.existsSync(bundleFilePath), "bundle file must be written to disk");

  const parsedOnDisk = JSON.parse(fs.readFileSync(bundleFilePath, "utf8"));
  assert.equal(parsedOnDisk.format, "studioskills-v1");
  assert.equal(parsedOnDisk.skills.length, 3);

  const motionSkill = parsedOnDisk.skills.find((s) => s.id === "motion-doctrine");
  assert.ok(motionSkill);
  assert.match(motionSkill.skillMd, /name:\s*motion-doctrine/);
  assert.ok(
    motionSkill.references["seam-gate.md"] && motionSkill.references["seam-gate.md"].length > 50,
    "should bundle motion-doctrine/references/seam-gate.md",
  );

  const reaSkill = parsedOnDisk.skills.find((s) => s.id === "rea-video");
  assert.ok(reaSkill);
  assert.ok(
    Object.keys(reaSkill.references).includes("taxonomy.md"),
    "should bundle rea-video/references/*.md files",
  );
});

test("exportSkillBundle falls back to project selectedSkills when skillIds is omitted", async () => {
  await setSelectedProjectSkills(TEST_SLUG, ["seam-craft", "oversized-cursor"]);
  const exported = await exportSkillBundle({ slug: TEST_SLUG });

  assert.equal(exported.skillCount, 2);
  assert.deepEqual(
    exported.skills.map((s) => s.id),
    ["seam-craft", "oversized-cursor"],
  );
  assert.equal(exported.outFilePath, null);

  // Also supports UI ProToolsBelt passing { skillIds: [], slug } by falling back to project/workspace skills
  const exportedFromUiEmptyArr = await exportSkillBundle({ skillIds: [], slug: TEST_SLUG });
  assert.deepEqual(
    exportedFromUiEmptyArr.skills.map((s) => s.id),
    ["seam-craft", "oversized-cursor"],
  );
});

test("importSkillBundle restores SKILL.md and references/*.md offline across workspace and project scopes", async () => {
  const bundleFilePath = path.join(tempRoot, "portable-roundtrip.studioskills.json");
  await exportSkillBundle({
    skillIds: ["motion-doctrine", "rea-video"],
    outFilePath: bundleFilePath,
  });

  // 1. Offline import into a clean second-device workspace (.agents/skills/)
  const wsImport = await importSkillBundle({
    bundleDataOrPath: bundleFilePath,
    targetScope: "workspace",
    rootDir: secondDeviceRoot,
    globalSkillsDir: "",
  });

  assert.equal(wsImport.ok, true);
  assert.equal(wsImport.importedCount, 2);
  assert.deepEqual(wsImport.importedSkillIds, ["motion-doctrine", "rea-video"]);

  const restoredMotionMd = path.join(
    secondDeviceRoot,
    ".agents",
    "skills",
    "motion-doctrine",
    "SKILL.md",
  );
  const restoredSeamGateRef = path.join(
    secondDeviceRoot,
    ".agents",
    "skills",
    "motion-doctrine",
    "references",
    "seam-gate.md",
  );
  const restoredReaTaxonomy = path.join(
    secondDeviceRoot,
    ".agents",
    "skills",
    "rea-video",
    "references",
    "taxonomy.md",
  );

  assert.ok(fs.existsSync(restoredMotionMd));
  assert.ok(fs.existsSync(restoredSeamGateRef));
  assert.ok(fs.existsSync(restoredReaTaxonomy));

  // Verify byte-for-byte parity with original workspace SKILL.md & reference
  const origSeamGate = fs.readFileSync(
    path.join(lib.ROOT_DIR, ".agents", "skills", "motion-doctrine", "references", "seam-gate.md"),
    "utf8",
  );
  assert.equal(fs.readFileSync(restoredSeamGateRef, "utf8"), origSeamGate);

  const discoveredOnSecondDevice = discoverLocalSkills({
    rootDir: secondDeviceRoot,
    globalSkillsDir: "",
  });
  assert.equal(discoveredOnSecondDevice.length, 2);
  assert.ok(discoveredOnSecondDevice.every((s) => s.installed && s.hasReferences));

  // 2. Inline bundle object import into project scope (projects/<slug>/skills/)
  const customBundle = {
    format: "studioskills-v1",
    schemaVersion: 1,
    skills: [
      {
        id: "portable-emerald-brand",
        name: "portable-emerald-brand",
        description: "Portable brand & contrast pack moved offline.",
        skillMd: `---\nname: portable-emerald-brand\ndescription: "Portable brand & contrast pack moved offline."\n---\n\n# Portable Emerald Brand\n\n- Use #1E824C primary and #F1C40F gold with >= 7.0:1 contrast.\n`,
        references: {
          "brand-tokens.md": "# Brand Tokens\n- Primary: #1E824C\n",
        },
      },
    ],
  };

  const projImport = await importSkillBundle({
    bundleDataOrPath: customBundle,
    targetScope: "project",
    slug: TEST_SLUG,
  });

  assert.equal(projImport.importedCount, 1);
  assert.ok(
    fs.existsSync(path.join(TEST_PROJECT_DIR, "skills", "portable-emerald-brand", "SKILL.md")),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        TEST_PROJECT_DIR,
        "skills",
        "portable-emerald-brand",
        "references",
        "brand-tokens.md",
      ),
    ),
  );
});

test("exportSkillBundle and importSkillBundle strictly reject path traversal and malicious reference payloads atomically", async () => {
  await assert.rejects(() =>
    exportSkillBundle({
      skillIds: ["motion-doctrine"],
      outFilePath: "../../escape.studioskills.json",
    }),
  );

  await assert.rejects(() =>
    exportSkillBundle({
      skillIds: [],
    }),
  );

  await assert.rejects(() =>
    importSkillBundle({
      bundleDataOrPath: "../../etc/passwd",
      targetScope: "workspace",
      rootDir: secondDeviceRoot,
    }),
  );

  // Malicious skill ID traversal
  await assert.rejects(() =>
    importSkillBundle({
      bundleDataOrPath: {
        format: "studioskills-v1",
        skills: [
          {
            id: "../../evil-escape",
            skillMd: "---\nname: evil\ndescription: bad\n---\n- bad\n",
          },
        ],
      },
      targetScope: "workspace",
      rootDir: secondDeviceRoot,
    }),
  );

  // Atomic rejection: first skill is valid, second has malicious reference path -> zero partial writes
  const atomicTargetRoot = path.join(tempRoot, "atomic-check-root");
  fs.mkdirSync(atomicTargetRoot, { recursive: true });

  await assert.rejects(() =>
    importSkillBundle({
      bundleDataOrPath: {
        format: "studioskills-v1",
        skills: [
          {
            id: "innocent-first-skill",
            skillMd: "---\nname: innocent-first-skill\ndescription: clean\n---\n- clean rule\n",
            references: { "ok.md": "# Clean\n" },
          },
          {
            id: "poisoned-second-skill",
            skillMd: "---\nname: poisoned-second-skill\ndescription: bad ref\n---\n- rule\n",
            references: { "../../escape.md": "# Escaped\n" },
          },
        ],
      },
      targetScope: "workspace",
      rootDir: atomicTargetRoot,
    }),
  );

  assert.equal(
    fs.existsSync(path.join(atomicTargetRoot, ".agents", "skills", "innocent-first-skill")),
    false,
    "atomic validation must reject before writing any skill when a later entry has path traversal",
  );

  // Reject non-markdown script injection inside references
  await assert.rejects(() =>
    importSkillBundle({
      bundleDataOrPath: {
        format: "studioskills-v1",
        skills: [
          {
            id: "script-in-refs",
            skillMd: "---\nname: script-in-refs\ndescription: bad ext\n---\n- rule\n",
            references: { "exploit.mjs": "process.exit(1);\n" },
          },
        ],
      },
      targetScope: "workspace",
      rootDir: atomicTargetRoot,
    }),
  );

  // Reject invalid project slug traversal
  await assert.rejects(() =>
    importSkillBundle({
      bundleDataOrPath: {
        format: "studioskills-v1",
        skills: [
          {
            id: "clean-skill",
            skillMd: "---\nname: clean-skill\ndescription: clean\n---\n- rule\n",
          },
        ],
      },
      targetScope: "project",
      slug: "../escape-slug",
    }),
  );
});
