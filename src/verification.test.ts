import { expect, test } from "bun:test";
import type { Sandbox } from "./sandbox";
import { discoverGates } from "./verification";

function sandbox(files: Record<string, string>): Sandbox {
  return {
    type: "test",
    workingDirectory: "/project",
    readFile: async (path) => {
      if (!(path in files)) throw new Error(`Missing ${path}`);
      return files[path];
    },
    exec: async () => ({ stdout: "", exitCode: 0 }),
    stop: async () => {},
  };
}

test("discovers Bun verification gates in fail-fast order", async () => {
  const gates = await discoverGates(sandbox({
    "bun.lock": "",
    "package.json": JSON.stringify({
      scripts: {
        build: "build",
        test: "test",
        lint: "lint",
        typecheck: "tsc --noEmit",
      },
    }),
  }));

  expect(gates).toEqual([
    "bun run typecheck",
    "bun run lint",
    "bun test",
    "bun run build",
  ]);
});

test("falls back to TypeScript and returns no gates for unreadable packages", async () => {
  expect(await discoverGates(sandbox({
    "package.json": JSON.stringify({ devDependencies: { typescript: "latest" } }),
  }))).toEqual(["npx tsc --noEmit"]);

  expect(await discoverGates(sandbox({}))).toEqual([]);
});
