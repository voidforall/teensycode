import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync, spawnSync } from "node:child_process";

const cwd = process.argv[2] || process.cwd();

const SAFE_PREFIXES = [
  "ls", "cat", "echo", "pwd", "which", "find",
  "head", "tail", "wc", "git log", "git status", "git diff",
];

function isSafe(command: string): boolean {
  return SAFE_PREFIXES.some((p) => command.trim().startsWith(p));
}

const read = tool({
  description: `Read a file from the project. Returns numbered lines.
    WHEN TO USE: viewing file contents, checking configs, reading source code.
    WHEN NOT TO USE: searching across files (use grep instead).
    DO NOT USE FOR: running commands, listing directories.
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
    WHEN NOT TO USE: reading a known file (use read instead).
    DO NOT USE FOR: running commands, listing directories.
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

const bash = tool({
  description: `Execute a shell command in the working directory.
WHEN TO USE: running build commands, installing packages, running tests,
  git operations, directory listings.
WHEN NOT TO USE: reading file contents (use read instead).
  Searching for patterns (use grep instead).
DO NOT USE FOR: reading files (use read), searching code (use grep).`,
  inputSchema: z.object({
    command: z.string().describe("Shell command to execute"),
  }),
  execute: async ({ command }) => {
    if (!isSafe(command)) {
      return `Blocked: "${command}" requires approval. Only safe commands (${SAFE_PREFIXES.join(", ")}) run automatically`;
    }
    try {
      const stdout = execSync(command, {
        cwd,
        encoding: "utf-8",
        timeout: 30_000,
      });
      return stdout || "(no output)";
    } catch (e: any) {
      return `Exit ${e.status ?? 1}: ${e.stdout || e.stderr || e.message || ""}`;
    }
  }
});

const agent = new ToolLoopAgent({
  model: deepseek("deepseek-flash"),
  instructions: `You are a coding agent.\nWorking directory: ${cwd}`,
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
