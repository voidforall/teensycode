import { expect, test } from "bun:test";
import { buildSystemPrompt } from "./system";

test("instructs the agent to search, ask, then act on ambiguous tasks", () => {
  const prompt = buildSystemPrompt({
    workingDirectory: "/project",
    sandboxType: "test",
    toolNames: ["read", "grep", "askUser"],
  });

  expect(prompt).toContain("# Handling Ambiguity");
  expect(prompt).toContain("1. Search the code or docs to gather context first");
  expect(prompt).toContain("2. Use askUser to let the user choose. Do NOT guess.");
  expect(prompt).toContain("Specific tasks");
  expect(prompt).toContain("Act directly.");
  expect(prompt).toContain("If a precise target does not exist, report that directly without asking");
});

test("requires todo planning before implementing clear multi-step tasks", () => {
  const prompt = buildSystemPrompt({
    workingDirectory: "/project",
    sandboxType: "test",
    toolNames: ["read", "grep", "todo"],
  });

  expect(prompt).toContain("# Planning");
  expect(prompt).toContain("After ambiguity is resolved");
  expect(prompt).toContain("you MUST use todo");
  expect(prompt).toContain("your first implementation tool calls MUST add");
  expect(prompt).toContain("until the first todo is in_progress");
  expect(prompt).toContain("Do not create todos for exploration or while waiting for a user answer");
});

test("lists discovered verification gates and requires scoped claims", () => {
  const prompt = buildSystemPrompt({
    workingDirectory: "/project",
    sandboxType: "test",
    toolNames: ["bash"],
    verificationCommands: ["bun run typecheck", "bun test"],
  });

  expect(prompt).toContain("1. `bun run typecheck`");
  expect(prompt).toContain("2. `bun test`");
  expect(prompt).toContain("Distinguish failures you caused from failures that were already there");
  expect(prompt).toContain("Run each gate, capture the output, and report what passed and what didn't");
});

test("states when no verification commands were discovered", () => {
  const prompt = buildSystemPrompt({
    workingDirectory: "/project",
    sandboxType: "test",
    toolNames: [],
    verificationCommands: [],
  });

  expect(prompt).toContain("(no verification commands discovered for this project)");
});

test("lists skill names and descriptions without embedding their content", () => {
  const prompt = buildSystemPrompt({
    workingDirectory: "/project",
    sandboxType: "test",
    toolNames: ["loadSkill"],
    skills: [{ name: "auth-patterns", description: "Authentication guidance" }],
  });

  expect(prompt).toContain("# Skills");
  expect(prompt).toContain("- auth-patterns: Authentication guidance");
  expect(prompt).toContain("call `loadSkill`");
  expect(prompt).not.toContain("# Auth Patterns");
});
