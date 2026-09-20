import { ToolLoopAgent, stepCountIs, tool, pruneMessages } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { buildSystemPrompt } from "./src/system";
import { addCacheControl } from "./src/cache";
import type { SandboxLifecycle } from "./src/sandbox";
import { createLocalSandbox } from "./src/sandbox-local";
import { createJustBashSandbox } from "./src/sandbox-just-bash";
import { createBashTool, createGrepTool, createReadTool } from "./src/tools";

const cwd = process.argv[2] || process.cwd();

const sandboxType = process.env.SANDBOX || "local";

if (sandboxType === "just-bash" && typeof Bun !== "undefined") {
  const result = spawnSync("node", ["--import", "tsx", import.meta.filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const agentPath = join(cwd, "AGENTS.md");
const projectContext = existsSync(agentPath)
  ? readFileSync(agentPath, "utf-8")
  : undefined;

const SAFE_PREFIXES = [
  "ls", "cat", "echo", "pwd", "which",
  "head", "tail", "wc", "git log", "git status", "git diff",
];

type ApprovalConfig =
  | { mode: "interactive" }
  | { mode: "background" }
  | { mode: "delegated"; trust: string[] };

function matchesTrustedCommand(command: string, prefixes: string[]): boolean {
  const trimmed = command.trim();
  if (/[;&|<>`$\n\r]/.test(trimmed)) return false;
  return prefixes.some((prefix) =>
    trimmed === prefix || trimmed.startsWith(`${prefix} `)
  );
}

function createApproval(config: ApprovalConfig) {
  return ({ command }: { command: string }) => {
    if (config.mode === "background") return false;

    if (config.mode === "delegated") {
      return !matchesTrustedCommand(command, config.trust);
    }

    return !matchesTrustedCommand(command, SAFE_PREFIXES);
  };
}

const sandbox =
  sandboxType === "just-bash"
    ? await createJustBashSandbox(cwd)
    : createLocalSandbox(cwd);

const lifecycle: SandboxLifecycle = {};
await lifecycle.afterStart?.(sandbox);

const tools = {
  read: createReadTool(sandbox),
  grep: createGrepTool(sandbox),
  bash: createBashTool(
    sandbox,
    createApproval({ mode: sandbox.type === "just-bash" ? "background" : "interactive" }),
  ),
};

const instructions = buildSystemPrompt({
  workingDirectory: sandbox.workingDirectory,
  sandboxType: sandbox.type,
  toolNames: Object.keys(tools),
  projectContext,
});

const agent = new ToolLoopAgent({
  model: deepseek("deepseek-flash"),
  instructions,
  tools,
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

const prompt = process.argv.slice(3).join(" ") || "Hello!";
try {
  const { text, steps } = await agent.generate({ prompt });

  for (const step of steps) {
    for (const call of step.toolCalls) console.log(`Tool: ${call.toolName} ${JSON.stringify(call.input)}`);
  }
  console.log(text);
  console.log(`\n(${steps.length} steps)`);
} finally {
  await lifecycle.beforeStop?.(sandbox);
  await sandbox.stop();
}
