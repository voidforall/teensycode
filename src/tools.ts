import type { Sandbox } from "./sandbox";
import { tool } from "ai";
import { z } from "zod";

const MAX_READ_LINES = 500;

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

export function createBashTool(
  sandbox: Sandbox,
  needsApproval: (input: { command: string }) => boolean,
) {
  return tool({
    description: `Execute a shell command in the working directory.

WHEN TO USE: running builds or tests, installing packages, git operations, and listing directories.
WHEN NOT TO USE: reading file contents (use read instead) or searching code (use grep instead).
USAGE: commands needing approval are blocked.`,
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
    }),
    execute: async ({ command }) => {
      if (needsApproval({ command })) {
        return `Blocked: "${command}" requires approval.`;
      }
      const { stdout, exitCode } = await sandbox.exec(command);
      return exitCode === 0 ? stdout || "(no output)" : `Exit ${exitCode}: ${stdout}`;
    },
  });
}
