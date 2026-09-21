import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const projectDir = resolve(import.meta.dir, "..");
const nodeBinary = process.env.TEENSYCODE_TEST_NODE || "node";
const version = spawnSync(nodeBinary, ["--version"], { encoding: "utf-8" });
const [major, minor, patch] = (version.stdout.match(/v(\d+)\.(\d+)\.(\d+)/) || [])
  .slice(1)
  .map(Number);
const supported = major > 20 || (major === 20 && (minor > 18 || (minor === 18 && patch >= 1)));

if (!supported) {
  test.skip("just-bash integration requires Node >=20.18.1", () => {});
} else {
  test("just-bash writes, reads, and greps in memory without touching the host", () => {
    const file = `.just-bash-test-${randomUUID()}.txt`;
    const script = `
      import { strict as assert } from "node:assert";
      import { existsSync } from "node:fs";
      import { createJustBashSandbox } from "./src/sandbox-just-bash.ts";
      import { createBashTool, createGrepTool, createReadTool } from "./src/tools.ts";

      const file = ${JSON.stringify(file)};
      const sandbox = await createJustBashSandbox(process.cwd());
      try {
        assert.equal(sandbox.workingDirectory, "/home/user/project");
        const bash = createBashTool(sandbox, () => false);
        assert.equal(await bash.execute({ command: "echo hello > " + file }, {}), "(no output)");
        assert.equal(await createReadTool(sandbox).execute({ path: file, limit: 1 }, {}), "1: hello");
        assert.match(await createGrepTool(sandbox).execute({ pattern: "hello", path: file }, {}), /:1:hello/);
        assert.equal(existsSync(file), false);
      } finally {
        await sandbox.stop();
      }
    `;
    const result = spawnSync(nodeBinary, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: projectDir,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
  });
}
