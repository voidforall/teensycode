import { ToolLoopAgent, stepCountIs, pruneMessages } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

import { buildSystemPrompt } from "./src/system";
import { addCacheControl } from "./src/cache";
import { createApproval } from "./src/approval";
import type { Sandbox, SandboxLifecycle } from "./src/sandbox";
import { createLocalSandbox } from "./src/sandbox-local";
import { createJustBashSandbox } from "./src/sandbox-just-bash";
import { discoverGates } from "./src/verification";
import {
  createAskUserTool,
  createBashTool,
  createGrepTool,
  createReadTool,
  createTaskTool,
  createTodoTool,
} from "./src/tools";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    sandbox: { type: "string", default: process.env.SANDBOX || "local" },
    model: { type: "string", default: "deepseek-flash" },
  },
  allowPositionals: true,
});

const cwd = resolve(positionals[0] || process.cwd());
const prompt = positionals.slice(1).join(" ") || "Hello!";
const sandboxType = values.sandbox!;
const modelName = values.model!;

if (sandboxType === "just-bash" && typeof Bun !== "undefined") {
  const child = spawn("node", ["--import", "tsx", import.meta.filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
    detached: true,
  });
  const forwardSigint = () => child.kill("SIGINT");
  process.on("SIGINT", forwardSigint);
  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", forwardSigint);
  }
  process.exit(exitCode);
}

const agentPath = join(cwd, "AGENTS.md");
const projectContext = existsSync(agentPath)
  ? readFileSync(agentPath, "utf-8")
  : undefined;

async function sandboxFromFlag(name: string, dir: string): Promise<Sandbox> {
  switch (name) {
    case "local": return createLocalSandbox(dir);
    case "just-bash": return createJustBashSandbox(dir);
    default: throw new Error(`Unknown sandbox: ${name}. Use local or just-bash.`);
  }
}

const sandbox = await sandboxFromFlag(sandboxType, cwd);
console.error(`Sandbox: ${sandbox.type}`);

const lifecycle: SandboxLifecycle = {};
let shutdownPromise: Promise<void> | undefined;
function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    try {
      await lifecycle.beforeStop?.(sandbox);
    } finally {
      await sandbox.stop();
    }
  })();
  return shutdownPromise;
}

function handleSigint(): void {
  console.error("\nShutting down...");
  void shutdown().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
process.once("SIGINT", handleSigint);

try {
  await lifecycle.afterStart?.(sandbox);
  const verificationCommands = await discoverGates(sandbox);

  const tools = {
    read: createReadTool(sandbox),
    grep: createGrepTool(sandbox),
    bash: createBashTool(
      sandbox,
      createApproval({ mode: sandbox.type === "just-bash" ? "background" : "interactive" }),
    ),
    askUser: createAskUserTool(),
    todo: createTodoTool(),
  };

  const tools_with_task = {
    ...tools,
    task: createTaskTool(
      sandbox,
      { read: tools.read, grep: tools.grep },
      createApproval({
        mode: "delegated",
        trust: ["bun test", "bun run typecheck", "npx tsc --noEmit"],
      }),
    ),
  };

  const instructions = buildSystemPrompt({
    workingDirectory: sandbox.workingDirectory,
    sandboxType: sandbox.type,
    toolNames: Object.keys(tools_with_task),
    projectContext,
    verificationCommands,
  });

  const agent = new ToolLoopAgent({
    model: deepseek(modelName),
    instructions,
    tools: tools_with_task,
    stopWhen: stepCountIs(10),
    onStepFinish: ({ usage, stepNumber }) => {
      console.error(
        `Step ${stepNumber}: ${usage.inputTokens} input, ${usage.outputTokens} output, ${usage.inputTokenDetails.cacheReadTokens ?? 0} cached`,
      );
    },
    prepareStep: ({ messages }) => {
      const pruned = pruneMessages({
        messages,
        toolCalls: "before-last-3-messages",
      });
      return { messages: addCacheControl(pruned) };
    },
  });

  const result = await agent.stream({ prompt });
  for await (const chunk of result.fullStream) {
    switch (chunk.type) {
      case "text-delta":
        process.stdout.write(chunk.text);
        break;
      case "tool-call":
        console.error(`\n[tool] ${chunk.toolName}(${JSON.stringify(chunk.input)})`);
        break;
      case "tool-result": {
        const output = typeof chunk.output === "string"
          ? chunk.output
          : JSON.stringify(chunk.output) ?? String(chunk.output);
        console.error(`  -> ${output.slice(0, 100)}`);
        break;
      }
      case "error":
        throw chunk.error;
    }
  }
  process.stdout.write("\n");
} finally {
  process.off("SIGINT", handleSigint);
  await shutdown();
}
