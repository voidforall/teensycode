import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync, spawnSync } from "node:child_process";

import { buildSystemPrompt } from "./src/system";

const cwd = process.argv[2] || process.cwd();

const agentPath = join(cwd, "AGENTS.md");
const projectContext = existsSync(agentPath)
  ? readFileSync(agentPath, "utf-8")
  : undefined;

const SAFE_PREFIXES = [
  "ls", "cat", "echo", "pwd", "which",
  "head", "tail", "wc", "git log", "git status", "git diff",
];

const read = tool({
  description: `Read a file from the project. Returns numbered lines.

  WHEN TO USE: viewing file contents, checking configs, reading source code, examining specific lines with offset/limit.
    
  WHEN NOT TO USE: searching across files (use grep instead). Running commands (use bash instead).

  DO NOT USE FOR: searching code (use grep), executing commands (use bash), modifying files (use edit or write).
  
  USAGE: path is relative to working directory. offset and limit are optional. Output is capped at 500 lines.

  EXAMPLES:
      - Read a known config file: path "tsconfig.json"`,
  inputSchema: z.object({
    path: z.string().describe("File path relative to working directory"),
    offset: z.number().optional().describe("Start line (1-indexed)"),
    limit: z.number().optional().describe("Max lines to return"),
  }),
  execute: async ({ path: filePath, offset, limit }) => {
    const abs = resolve(cwd, filePath);
    const content = readFileSync(abs, "utf-8");
    let lines = content.split("\n");

    if (offset) lines = lines.slice(offset - 1);
    if (limit) lines = lines.slice(0, limit);

    const MAX_LINES = 500;
    const truncated = lines.length > MAX_LINES;
    if (truncated) lines = lines.slice(0, MAX_LINES);

    const numbered = lines.map((l, i) => `${(offset || 1) + i}: ${l}`);
    return truncated ?
      numbered.join("\n") + `\n... (truncated at ${MAX_LINES} lines)`
      : numbered.join("\n");
  },
});

const grep = tool({
  description: `Search file contents using regex. Returns matching lines with file paths.
    
  WHEN TO USE: finding patterns across multiple files, locating function definitions,
      searching for imports, finding TODOs or error messages.
  
  WHEN NOT TO USE: reading a known file (use read instead). Running commands (use bash instead).

  DO NOT USE FOR: running commands (use read), listing directories (use bash). modifying files (use edit).

  USAGE: pattern is a regex string. glob filters by file extension. Results are capped at 50 matches.
    
  EXAMPLES:
    - Find all TODO comments: pattern "TODO" glob "*.ts"
    - Find function definitions: pattern "function [[:alnum:]_]+" glob "*.ts"`,
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory to search (default: working dir)"),
    glob: z.string().optional().describe("File glob filter, e.g. '*.ts'"),
  }),
  execute: async ({ pattern, path, glob }) => {
    const result = spawnSync(
      "grep",
      [
        "-rn",
        "--exclude-dir=node_modules",
        "--exclude-dir=.git",
        `--include=${glob || "*"}`,
        "-E",
        "--",
        pattern,
        resolve(cwd, path || "."),
      ],
      { encoding: "utf-8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024 },
    );

    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(result.stderr || `grep exited with status ${result.status}`);
    }

    const matches = result.stdout.trimEnd().split("\n").filter(Boolean);
    if (matches.length === 0) return "No matches found.";

    const MAX_MATCHES = 50;
    const output = matches.slice(0, MAX_MATCHES).join("\n");
    return matches.length > MAX_MATCHES
      ? `${output}\n... (${matches.length} total, showing first ${MAX_MATCHES})`
      : output;
  },
});

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

interface BashOperations {
  exec(command: string): Promise<{ stdout: string; exitCode: number }>;
}

function createBashTool(
  operations: BashOperations,
  needsApproval: (input: { command: string }) => boolean,
) {
  return tool({
    description: `Execute a shell command in the working directory.

    WHEN TO USE: running build commands, installing packages, running tests, git operations, directory listings.

    WHEN NOT TO USE: reading file contents (use read instead). Searching for patterns (use grep instead).

    DO NOT USE FOR: reading files (use read), searching code (use grep).
  
    USAGE: command is a single shell string. Commands needing approval are blocked and return a clear error message.

    EXAMPLES:
      - List files: command "ls -la"
      - Check git status: command "git status"`,
  
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
    }),
    execute: async ({ command }) => {
      if (needsApproval({ command })) {
        return `Blocked: "${command}" requires approval.`;
      }
      const { stdout, exitCode } = await operations.exec(command);
      return exitCode === 0 ? stdout || "(no output)" : `Exit ${exitCode}: ${stdout}`;
    },
  });
}

const localOps: BashOperations = {
  exec: async (command) => {
    try {
      const stdout = execSync(command, {
        cwd,
        encoding: "utf-8",
        timeout: 30_000,
      });
      return { stdout, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: String(error.stdout || error.stderr || error.message || ""),
        exitCode: error.status ?? 1,
      };
    }
  },
};

const bash = createBashTool(localOps, createApproval({ mode: "interactive" }));

const instructions = buildSystemPrompt({
  workingDirectory: cwd,
  sandboxType: "local",
  toolNames: Object.keys({ read, grep, bash }),
  projectContext,
});

const agent = new ToolLoopAgent({
  model: deepseek("deepseek-flash"),
  instructions,
  tools: { read, grep, bash },
  stopWhen: stepCountIs(10),
});

const prompt = process.argv.slice(3).join(" ") || "Hello!";
const { text, steps } = await agent.generate({ prompt });

for (const step of steps) {
  for (const call of step.toolCalls) console.log(`Tool: ${call.toolName} ${JSON.stringify(call.input)}`);
}
console.log(text);
console.log(`\n(${steps.length} steps)`);
