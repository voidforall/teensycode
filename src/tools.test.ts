import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { z } from "zod";
import type { Sandbox } from "./sandbox";
import { createLocalSandbox } from "./sandbox-local";
import {
  createAskUserTool,
  createBashTool,
  createGrepTool,
  createLoadSkillTool,
  createReadTool,
  createTaskTool,
  createTodoTool,
} from "./tools";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sandbox(overrides: Partial<Sandbox> = {}): Sandbox {
  return {
    type: "test",
    workingDirectory: "/project",
    readFile: async () => "first\nsecond\nthird",
    exec: async () => ({ stdout: "done", exitCode: 0 }),
    stop: async () => {},
    ...overrides,
  };
}

describe("createReadTool", () => {
  test("reads a file with 1-indexed offset and limit", async () => {
    const paths: string[] = [];
    const read = createReadTool(sandbox({
      readFile: async (path) => {
        paths.push(path);
        return "first\nsecond\nthird";
      },
    }));

    expect(await read.execute!({ path: "src/file.ts", offset: 2, limit: 2 }, {} as never))
      .toBe("2: second\n3: third");
    expect(paths).toEqual(["src/file.ts"]);
  });

  test("caps output at 500 numbered lines", async () => {
    const read = createReadTool(sandbox({
      readFile: async () => Array.from({ length: 501 }, (_, i) => `line ${i + 1}`).join("\n"),
    }));

    const result = await read.execute!({ path: "large.txt" }, {} as never);
    expect(result).toContain("500: line 500");
    expect(result).not.toContain("501: line 501");
    expect(result).toEndWith("... (truncated at 500 lines)");
  });
});

describe("createLoadSkillTool", () => {
  test("loads full markdown by name and rejects unknown names", async () => {
    const root = mkdtempSync(join(tmpdir(), "teensycode-load-skill-"));
    try {
      const path = join(root, "SKILL.md");
      const content = "---\ndescription: A test skill\n---\n# Test Skill\nFollow these steps.\n";
      writeFileSync(path, content);
      const loadSkill = createLoadSkillTool([{ name: "test-skill", description: "A test skill", path }]);

      expect(await loadSkill.execute!({ name: "test-skill" }, {} as never)).toBe(content);
      expect(await loadSkill.execute!({ name: "missing" }, {} as never)).toBe("Unknown skill: missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("caps long skill content", async () => {
    const root = mkdtempSync(join(tmpdir(), "teensycode-load-skill-"));
    try {
      const path = join(root, "SKILL.md");
      writeFileSync(path, "x".repeat(4_001));
      const loadSkill = createLoadSkillTool([{ name: "long", description: "Long", path }]);

      const result = await loadSkill.execute!({ name: "long" }, {} as never);
      expect(result).toBe("x".repeat(4_000) + "\n... (truncated at 4000 chars)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("createGrepTool", () => {
  test("returns the first 50 matches and reports the total", async () => {
    const stdout = Array.from({ length: 51 }, (_, i) => `file.ts:${i + 1}:match`).join("\n") + "\n";
    const grep = createGrepTool(sandbox({
      exec: async () => ({ stdout, exitCode: 0 }),
    }));

    const result = await grep.execute!({ pattern: "match" }, {} as never);
    expect(result).toContain("file.ts:50:match");
    expect(result).not.toContain("file.ts:51:match");
    expect(result).toEndWith("... (51 total, showing first 50)");
  });
});

describe("createBashTool", () => {
  test("blocks commands requiring approval without executing", async () => {
    let executed = false;
    const bash = createBashTool(sandbox({
      exec: async () => {
        executed = true;
        return { stdout: "", exitCode: 0 };
      },
    }), () => true);

    expect(await bash.execute!({ command: "unsafe" }, {} as never))
      .toBe('Blocked: "unsafe" requires approval.');
    expect(executed).toBe(false);
  });

  test("returns output and reports non-zero exit codes", async () => {
    const bash = createBashTool(sandbox({
      exec: async (command) => command === "ok"
        ? { stdout: "done", exitCode: 0 }
        : { stdout: "failed", exitCode: 2 },
    }), () => false);

    expect(await bash.execute!({ command: "ok" }, {} as never)).toBe("done");
    expect(await bash.execute!({ command: "fail" }, {} as never)).toBe("Exit 2: failed");
  });

  test("keeps the last 5,000 characters and signals truncation", async () => {
    const stdout = "head" + "x".repeat(5_000);
    const bash = createBashTool(sandbox({
      exec: async () => ({ stdout, exitCode: 2 }),
    }), () => false);

    const result = await bash.execute!({ command: "build" }, {} as never);
    expect(result).toStartWith("Exit 2: " + "x".repeat(5_000));
    expect(result).not.toContain("head");
    expect(result).toEndWith("... (truncated, showing last 5000 chars)");
  });

  test("does not truncate output at the 5,000-character boundary", async () => {
    const stdout = "x".repeat(5_000);
    const bash = createBashTool(sandbox({
      exec: async () => ({ stdout, exitCode: 0 }),
    }), () => false);

    expect(await bash.execute!({ command: "build" }, {} as never)).toBe(stdout);
  });
});

describe("createTaskTool", () => {
  test("defaults to explorer and accepts executor", () => {
    const testSandbox = sandbox();
    const task = createTaskTool(testSandbox, {
      read: createReadTool(testSandbox),
      grep: createGrepTool(testSandbox),
    }, () => true);
    const schema = task.inputSchema as z.ZodTypeAny;

    expect(schema.parse({ description: "Search the codebase" }).subagentType)
      .toBe("explorer");
    expect(schema.parse({ description: "Run verification", subagentType: "executor" }).subagentType)
      .toBe("executor");
    expect(schema.safeParse({ description: "Run verification", subagentType: "unknown" }).success)
      .toBe(false);
  });
});

describe("createAskUserTool", () => {
  test("accepts two to four answer options", () => {
    const askUser = createAskUserTool();
    const schema = askUser.inputSchema as z.ZodTypeAny;

    expect(schema.safeParse({ question: "Which database?", options: ["Postgres"] }).success)
      .toBe(false);
    expect(schema.safeParse({ question: "Which database?", options: ["Postgres", "SQLite"] }).success)
      .toBe(true);
    expect(schema.safeParse({
      question: "Which database?",
      options: ["Postgres", "SQLite", "MySQL", "MariaDB", "MongoDB"],
    }).success).toBe(false);
  });

  test("returns the pending question as a numbered list", async () => {
    const askUser = createAskUserTool();

    expect(await askUser.execute!({
      question: "Which authentication strategy should I use?",
      options: ["OAuth", "JWT", "Session cookies"],
    }, {} as never)).toBe(
      'Asked: "Which authentication strategy should I use?"\n' +
      "Options:\n" +
      "1. OAuth\n" +
      "2. JWT\n" +
      "3. Session cookies\n\n" +
      "(Awaiting user response.)",
    );
  });
});

describe("createTodoTool", () => {
  test("allows only one in_progress item at a time", async () => {
    const todo = createTodoTool();
    const first = await todo.execute!({ action: "add", description: "First" }, {} as never) as string;
    const second = await todo.execute!({ action: "add", description: "Second" }, {} as never) as string;
    const firstId = first.match(/\[([^\]]+)\]/)?.[1];
    const secondId = second.match(/\[([^\]]+)\]/)?.[1];

    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(await todo.execute!({ action: "start", id: firstId }, {} as never))
      .toBe(`Started: [${firstId}] First`);
    expect(await todo.execute!({ action: "start", id: secondId }, {} as never))
      .toBe(`Already working on: [${firstId}] First. Complete it first.`);
    expect(await todo.execute!({ action: "list" }, {} as never))
      .toContain(`[in_progress] ${firstId}: First`);

    await todo.execute!({ action: "complete", id: firstId }, {} as never);
    await todo.execute!({ action: "complete", id: secondId }, {} as never);
  });
});

describe("local sandbox integration", () => {
  const local = createLocalSandbox(resolve(import.meta.dir, ".."));

  test("reads project files and runs commands in the project directory", async () => {
    expect(local.type).toBe("local");
    expect(await createReadTool(local).execute!({ path: "package.json", limit: 1 }, {} as never))
      .toBe('1: {');
    expect(await createBashTool(local, () => false).execute!({ command: "pwd" }, {} as never))
      .toBe(`${local.workingDirectory}\n`);
    await local.stop();
  });

  test("grep finds matches and handles no matches", async () => {
    const grep = createGrepTool(local);
    const result = await grep.execute!({ pattern: "createReadTool", path: "src", glob: "*.ts" }, {} as never);
    expect(result).toContain("src/tools.ts:");
    expect(await grep.execute!({ pattern: "__no_such_pattern__", path: "src/tools.ts" }, {} as never))
      .toBe("No matches found.");
  });

  test("exec returns a non-zero result instead of throwing", async () => {
    expect(await local.exec("false")).toEqual({ stdout: "", exitCode: 1 });
  });
});
