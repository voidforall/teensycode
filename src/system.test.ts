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
