import { expect, test } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import { createRegistry, registerBuiltins, wrapTool } from "./registry";
import type { Sandbox } from "./sandbox";

const sampleTool = tool({
  description: "Return a greeting",
  inputSchema: z.object({ name: z.string() }),
  execute: async ({ name }) => `Hello, ${name}`,
});

test("registry registers, replaces, and lists tools in insertion order", () => {
  const registry = createRegistry();
  registry.register("greet", sampleTool);
  expect(registry.get("greet")).toBe(sampleTool);
  expect(registry.get("missing")).toBeUndefined();
  expect(registry.list()).toEqual(["greet"]);
  expect(registry.entries()).toEqual([["greet", sampleTool]]);

  const replacement = tool({
    description: "Return a different greeting",
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => `Hi, ${name}`,
  });
  registry.register("greet", replacement);
  expect(registry.get("greet")).toBe(replacement);
  expect(registry.list()).toEqual(["greet"]);
});

test("wrapTool transforms input and output without changing the base tool", async () => {
  const wrapped = wrapTool(sampleTool, {
    beforeExecute: (input) => ({ ...input, name: input.name.toUpperCase() }),
    afterExecute: (output) => typeof output === "string" ? `${output}!` : output,
  });

  expect(wrapped.description).toBe(sampleTool.description);
  expect(wrapped.inputSchema).toBe(sampleTool.inputSchema);
  expect(await wrapped.execute!({ name: "Ada" }, {} as never)).toBe("Hello, ADA!");
  expect(await sampleTool.execute!({ name: "Ada" }, {} as never)).toBe("Hello, Ada");
});

test("registerBuiltins preserves all existing tools and local approval policy", async () => {
  let executed = false;
  const sandbox: Sandbox = {
    type: "local",
    workingDirectory: "/project",
    readFile: async () => "",
    exec: async () => { executed = true; return { stdout: "ran", exitCode: 0 }; },
    stop: async () => {},
  };
  const registry = createRegistry();
  registerBuiltins(registry, sandbox, []);

  expect(registry.list()).toEqual(["read", "grep", "bash", "askUser", "todo", "loadSkill", "task"]);
  expect(Object.keys(Object.fromEntries(registry.entries()))).toEqual(registry.list());
  expect(await registry.get("bash")?.execute?.({ command: "vercel deploy --prod" }, {} as never))
    .toBe('Blocked: "vercel deploy --prod" requires approval.');
  expect(executed).toBe(false);
});
