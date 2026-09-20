import { ToolLoopAgent, stepCountIs } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSystemPrompt } from "./src/system";
import { createLocalSandbox } from "./src/sandbox-local";
import { createBashTool, createGrepTool, createReadTool } from "./src/tools";

const cwd = process.argv[2] || process.cwd();

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

const sandbox = createLocalSandbox(cwd);
const tools = {
  read: createReadTool(sandbox),
  grep: createGrepTool(sandbox),
  bash: createBashTool(sandbox, createApproval({ mode: "interactive" })),
};

const instructions = buildSystemPrompt({
  workingDirectory: cwd,
  sandboxType: sandbox.type,
  toolNames: Object.keys(tools),
  projectContext,
});

const agent = new ToolLoopAgent({
  model: deepseek("deepseek-flash"),
  instructions,
  tools,
  stopWhen: stepCountIs(10),
});

const prompt = process.argv.slice(3).join(" ") || "Hello!";
const { text, steps } = await agent.generate({ prompt });

for (const step of steps) {
  for (const call of step.toolCalls) console.log(`Tool: ${call.toolName} ${JSON.stringify(call.input)}`);
}
console.log(text);
console.log(`\n(${steps.length} steps)`);
