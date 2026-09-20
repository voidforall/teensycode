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

export function createTaskTool(sandbox: Sandbox, parentTools: {
  read: ReturnType<typeof createReadTool>;
  grep: ReturnType<typeof createGrepTool>;
}) {
  return tool({
    description: `Delegate research to a read-only subagent.
WHEN TO USE: investigating a codebase, finding patterns, gathering context
  across many files.
WHEN NOT TO USE: making changes (the subagent cannot write or run commands).
DO NOT USE FOR: tasks that need decisions or askUser interactions.`,
    inputSchema: z.object({
      description: z.string().describe("What the subagent should investigate"),
    }),
    execute: async ({ description }) => {
      const explorer = new ToolLoopAgent({
        model: deepseek("deepseek-flash"),
        instructions: `You are an explorer agent. Investigate and report back concisely.
Working directory: ${sandbox.workingDirectory}`,
        tools: { read: parentTools.read, grep: parentTools.grep },
        stopWhen: stepCountIs(5),
      });

      try {
        const { text, steps } = await explorer.generate({ prompt: description });
        return text
          ? `[Explorer: ${steps.length} steps]\n${text}`
          : "(no response from subagent)";
      } catch (e: any) {
        return `Subagent error: ${e.message}`;
      }
    },
  });
}
