import { ToolLoopAgent, stepCountIs, tool, pruneMessages } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { buildSystemPrompt } from "./src/system";
import { addCacheControl } from "./src/cache";
import { createApproval } from "./src/approval";
import type { SandboxLifecycle } from "./src/sandbox";
import { createLocalSandbox } from "./src/sandbox-local";
import { createJustBashSandbox } from "./src/sandbox-just-bash";
import { createBashTool, createGrepTool, createReadTool, createTaskTool } from "./src/tools";

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
});

const agent = new ToolLoopAgent({
  model: deepseek("deepseek-flash"),
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
