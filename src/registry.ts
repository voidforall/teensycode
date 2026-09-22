import type { Tool, ToolExecutionOptions } from "ai";
import type { Sandbox } from "./sandbox";
import type { Skill } from "./skills";
import { createApproval } from "./approval";
import {
  createAskUserTool,
  createBashTool,
  createGrepTool,
  createLoadSkillTool,
  createReadTool,
  createTaskTool,
  createTodoTool,
} from "./tools";

export interface ToolRegistry {
  register(name: string, value: Tool): void;
  get(name: string): Tool | undefined;
  list(): string[];
  entries(): [string, Tool][];
}

export function createRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();
  return {
    register: (name, value) => { tools.set(name, value); },
    get: (name) => tools.get(name),
    list: () => [...tools.keys()],
    entries: () => [...tools.entries()],
  };
}

export function registerBuiltins(registry: ToolRegistry, sandbox: Sandbox, skills: Skill[]): void {
  const read = createReadTool(sandbox);
  const grep = createGrepTool(sandbox);
  registry.register("read", read);
  registry.register("grep", grep);
  registry.register("bash", createBashTool(
    sandbox,
    createApproval({ mode: sandbox.type === "just-bash" ? "background" : "interactive" }),
  ));
  registry.register("askUser", createAskUserTool());
  registry.register("todo", createTodoTool());
  registry.register("loadSkill", createLoadSkillTool(skills));
  registry.register("task", createTaskTool(
    sandbox,
    { read, grep },
    createApproval({
      mode: "delegated",
      trust: ["bun test", "bun run typecheck", "npx tsc --noEmit"],
    }),
  ));
}

interface WrapHooks<Input, Output> {
  beforeExecute?: (input: Input) => Input | Promise<Input>;
  afterExecute?: (output: Output) => Output | Promise<Output>;
}

export function wrapTool<Input, Output>(
  base: Tool<Input, Output>,
  hooks: WrapHooks<Input, Output>,
): Tool<Input, Output> {
  if (!base.execute) throw new Error("Cannot wrap a tool without execute");
  const execute = base.execute;
  if (base.type && base.type !== "function") {
    throw new Error("wrapTool requires a function tool");
  }
  return {
    ...base,
    type: "function" as const,
    execute: async (input: Input, options: ToolExecutionOptions): Promise<Output> => {
      const transformed = hooks.beforeExecute ? await hooks.beforeExecute(input) : input;
      const output = await execute(transformed, options);
      if (output && typeof output === "object" && Symbol.asyncIterator in output) {
        throw new Error("wrapTool does not support streaming tool output");
      }
      return hooks.afterExecute ? await hooks.afterExecute(output as Output) : output as Output;
    },
  } as Tool<Input, Output>;
}
