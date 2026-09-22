import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverSkills } from "./skills";

test("discovers skill descriptions and lets the first directory override later ones", () => {
  const root = mkdtempSync(join(tmpdir(), "teensycode-skills-"));
  try {
    const local = join(root, "local");
    const global = join(root, "global");
    mkdirSync(join(local, "auth-patterns"), { recursive: true });
    mkdirSync(join(global, "auth-patterns"), { recursive: true });
    mkdirSync(join(global, "testing"), { recursive: true });
    writeFileSync(join(local, "auth-patterns", "SKILL.md"), "---\ndescription: 'Local auth guidance'\n---\n# Auth\n");
    writeFileSync(join(global, "auth-patterns", "SKILL.md"), "---\ndescription: Global auth guidance\n---\n");
    writeFileSync(join(global, "testing", "SKILL.md"), "# No frontmatter\n");

    expect(discoverSkills([local, global])).toEqual([
      {
        name: "auth-patterns",
        description: "Local auth guidance",
        path: join(local, "auth-patterns", "SKILL.md"),
      },
      {
        name: "testing",
        description: "(no description)",
        path: join(global, "testing", "SKILL.md"),
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovers the bundled sample skill", () => {
  expect(discoverSkills([resolve(import.meta.dir, "../skills")])).toContainEqual({
    name: "auth-patterns",
    description: "Example authentication guidance; load when asked about auth or OAuth in this project",
    path: resolve(import.meta.dir, "../skills/auth-patterns/SKILL.md"),
  });
});
