import type { Sandbox } from "./sandbox";

interface PackageManifest {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function isBunProject(sandbox: Sandbox, pkg: PackageManifest): Promise<boolean> {
  if (pkg.packageManager?.startsWith("bun@")) return true;

  for (const lockfile of ["bun.lock", "bun.lockb"]) {
    try {
      await sandbox.readFile(lockfile);
      return true;
    } catch {
      // Try the next Bun lockfile name.
    }
  }

  return false;
}

export async function discoverGates(sandbox: Sandbox): Promise<string[]> {
  try {
    const raw = await sandbox.readFile("package.json");
    const pkg = JSON.parse(raw) as PackageManifest;
    const scripts = pkg.scripts ?? {};
    const usesBun = await isBunProject(sandbox, pkg);
    const runScript = (name: string) => usesBun
      ? name === "test" ? "bun test" : `bun run ${name}`
      : name === "test" ? "npm test" : `npm run ${name}`;
    const gates: string[] = [];

    const typecheckScript = scripts.typecheck
      ? "typecheck"
      : scripts["type-check"] ? "type-check" : undefined;
    if (typecheckScript) {
      gates.push(runScript(typecheckScript));
    } else if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
      gates.push("npx tsc --noEmit");
    }

    if (scripts.lint) gates.push(runScript("lint"));
    if (scripts.test) gates.push(runScript("test"));
    if (scripts.build) gates.push(runScript("build"));

    return gates;
  } catch {
    return [];
  }
}
