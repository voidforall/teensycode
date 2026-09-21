const SAFE_PREFIXES = [
  "ls", "cat", "echo", "pwd", "which",
  "head", "tail", "wc", "git log", "git status", "git diff",
];

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

export function createApproval(config: ApprovalConfig) {
  return ({ command }: { command: string }) => {
    if (config.mode === "background") return false;

    if (config.mode === "delegated") {
      return !matchesTrustedCommand(command, config.trust);
    }

    return !matchesTrustedCommand(command, SAFE_PREFIXES);
  };
}
