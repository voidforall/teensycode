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
