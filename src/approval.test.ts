import { describe, expect, test } from "bun:test";
import { createApproval } from "./approval";

describe("delegated approval", () => {
  const needsApproval = createApproval({
    mode: "delegated",
    trust: ["bun test", "bun run typecheck", "npx tsc --noEmit"],
  });

  test("permits only trusted verification commands", () => {
    expect(needsApproval({ command: "bun test" })).toBe(false);
    expect(needsApproval({ command: "bun run typecheck" })).toBe(false);
    expect(needsApproval({ command: "npx tsc --noEmit" })).toBe(false);
    expect(needsApproval({ command: "ls" })).toBe(true);
    expect(needsApproval({ command: "bun run build" })).toBe(true);
    expect(needsApproval({ command: "npx tsc --init" })).toBe(true);
  });

  test("rejects shell operators even after a trusted prefix", () => {
    expect(needsApproval({ command: "bun test && touch scratch.txt" })).toBe(true);
    expect(needsApproval({ command: "bun test > scratch.txt" })).toBe(true);
    expect(needsApproval({ command: "bun test $(touch scratch.txt)" })).toBe(true);
  });
});
