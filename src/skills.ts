import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  path: string;
}

function parseDescription(markdown: string): string | undefined {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  const line = match[1]?.split(/\r?\n/).find((entry) => entry.startsWith("description:"));
  return line?.slice("description:".length).trim().replace(/^['"]|['"]$/g, "");
}

export function discoverSkills(dirs: string[]): Skill[] {
  const skills: Skill[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const path = join(dir, entry.name, "SKILL.md");
      if (!existsSync(path)) continue;
      const description = parseDescription(readFileSync(path, "utf-8"));
      seen.add(entry.name);
      skills.push({ name: entry.name, description: description || "(no description)", path });
    }
  }

  return skills;
}
