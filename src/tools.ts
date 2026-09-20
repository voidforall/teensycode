import type { Sandbox } from "./sandbox";
import { deepseek } from "@ai-sdk/deepseek";
import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { resolve } from "node:path";
import { z } from "zod";

const MAX_READ_LINES = 500;
const MAX_GREP_MATCHES = 50;
const MAX_BASH_CHARS = 5_000;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function createReadTool(sandbox: Sandbox) {
  return tool({
    description: `Read a file from the project. Returns numbered lines.

WHEN TO USE: viewing file contents, checking configs, reading source code, examining specific lines with offset/limit.
WHEN NOT TO USE: searching across files (use grep instead) or running commands (use bash instead).
USAGE: path is relative to the working directory. Output is capped at 500 lines.`,
    inputSchema: z.object({
      path: z.string().describe("File path relative to working directory"),
      offset: z.number().int().min(1).optional().describe("Start line (1-indexed)"),
      limit: z.number().int().min(1).optional().describe("Max lines to return"),
    }),
    execute: async ({ path: filePath, offset, limit }) => {
      const content = await sandbox.readFile(filePath);
      const start = offset ?? 1;
      const lines = content.split("\n").slice(start - 1, limit === undefined ? undefined : start - 1 + limit);
      const truncated = lines.length > MAX_READ_LINES;
      const numbered = lines
        .slice(0, MAX_READ_LINES)
        .map((line, index) => `${start + index}: ${line}`)
        .join("\n");

      return truncated
        ? `${numbered}\n... (truncated at ${MAX_READ_LINES} lines)`
        : numbered;
    },
  });
}

export function createGrepTool(sandbox: Sandbox) {
  return tool({
    description: `Search file contents using regex. Returns matching lines with file paths.

WHEN TO USE: finding patterns across multiple files, locating definitions or imports, finding TODOs or error messages.
WHEN NOT TO USE: reading a known file (use read instead) or running commands (use bash instead).
USAGE: pattern is a regex string. glob filters filenames. Results are capped at 50 matches.`,
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      path: z.string().optional().describe("Directory to search (default: working dir)"),
      glob: z.string().optional().describe("File glob filter, e.g. '*.ts'"),
    }),
    execute: async ({ pattern, path, glob }) => {
      const searchPath = resolve(sandbox.workingDirectory, path || ".");
      const command = `grep -rn --exclude-dir=node_modules --exclude-dir=.git --include=${shellQuote(glob || "*")} -E -- ${shellQuote(pattern)} ${shellQuote(searchPath)}`;
      const { stdout, exitCode } = await sandbox.exec(command);

      if (exitCode !== 0 && exitCode !== 1) {
        throw new Error(stdout || `grep exited with status ${exitCode}`);
      }

      const matches = stdout.trimEnd().split("\n").filter(Boolean);
      if (matches.length === 0) return "No matches found.";

      const output = matches.slice(0, MAX_GREP_MATCHES).join("\n");
      return matches.length > MAX_GREP_MATCHES
        ? `${output}\n... (${matches.length} total, showing first ${MAX_GREP_MATCHES})`
        : output;
    },
  });
}

export function createBashTool(
  sandbox: Sandbox,
  needsApproval: (input: { command: string }) => boolean,
) {
  return tool({
    description: `Execute a shell command in the working directory.

WHEN TO USE: running builds or tests, installing packages, git operations, and listing directories.
WHEN NOT TO USE: reading file contents (use read instead) or searching code (use grep instead).
USAGE: commands needing approval are blocked. Output is capped at 5,000 characters, keeping the tail.`,
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
    }),
    execute: async ({ command }) => {
      if (needsApproval({ command })) {
        return `Blocked: "${command}" requires approval.`;
      }
      const { stdout, exitCode } = await sandbox.exec(command);
      const output = stdout.length > MAX_BASH_CHARS
        ? `${stdout.slice(-MAX_BASH_CHARS)}\n... (truncated, showing last ${MAX_BASH_CHARS} chars)`
        : stdout;
      return exitCode === 0 ? output || "(no output)" : `Exit ${exitCode}: ${output}`;
    },
  });
}

type ResearchTools = {
  read: ReturnType<typeof createReadTool>;
  grep: ReturnType<typeof createGrepTool>;
};

function buildExplorer(sandbox: Sandbox, parentTools: ResearchTools) {
  const model = deepseek("deepseek-flash");
  const stepBudget = 5;
  return new ToolLoopAgent({
    model,
    instructions: `You are an explorer agent. Investigate and report back concisely.
Working directory: ${sandbox.workingDirectory}`,
    tools: parentTools,
    stopWhen: stepCountIs(stepBudget),
  });
}

function buildExecutor(
  sandbox: Sandbox,
  parentTools: ResearchTools,
  needsApproval: (input: { command: string }) => boolean,
) {
  const model = deepseek("deepseek-v4-pro");
  const stepBudget = 15;
  return new ToolLoopAgent({
    model,
    instructions: `You are an executor agent. Carry out the delegated task using your available tools, then report what you did and verified.
Working directory: ${sandbox.workingDirectory}
Do not ask questions, explore beyond the task, or claim a blocked action succeeded.`,
    tools: { ...parentTools, bash: createBashTool(sandbox, needsApproval) },
    stopWhen: stepCountIs(stepBudget),
  });
}

async function runSubagent(
  role: "Explorer" | "Executor",
  agent: { generate: (input: { prompt: string }) => Promise<{ text: string; steps: readonly unknown[] }> },
  description: string,
) {
  try {
    const { text, steps } = await agent.generate({ prompt: description });
    return text ? `[${role}: ${steps.length} steps]\n${text}` : `(no response from ${role})`;
  } catch (error) {
    return `${role} error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function createTaskTool(
  sandbox: Sandbox,
  parentTools: ResearchTools,
  executorNeedsApproval: (input: { command: string }) => boolean,
) {
  return tool({
    description: `Delegate a self-contained task to a subagent.
Explorer (default): read-only research with DeepSeek Flash. Use for searching across files and gathering context.
Executor: bounded execution and verification with DeepSeek V4 Pro. It can read, grep, and run approved bash commands, but cannot edit files.
WHEN TO USE: multi-file research (explorer) or a focused task with known verification commands (executor).
WHEN NOT TO USE: ambiguous requirements (ask the user directly; use askUser if available) or architectural decisions (the parent decides).
DO NOT USE FOR: single-step work the parent can do directly.`,
    inputSchema: z.object({
      description: z.string().describe("The task to delegate, with enough context to work independently"),
      subagentType: z.enum(["explorer", "executor"]).default("explorer")
        .describe("Explorer for research; executor for approved command execution"),
    }),
    execute: async ({ description, subagentType }) => {
      // If subagents gain access to task, check parent-role spawn permissions here.
      const agent = subagentType === "executor"
        ? buildExecutor(sandbox, parentTools, executorNeedsApproval)
        : buildExplorer(sandbox, parentTools);
      return runSubagent(subagentType === "executor" ? "Executor" : "Explorer", agent, description);
    },
  });
}
