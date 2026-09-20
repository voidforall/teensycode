import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sandbox } from "./sandbox";

export function createLocalSandbox(dir: string): Sandbox {
  return {
    type: "local",
    workingDirectory: dir,
    readFile: async (path) => readFileSync(resolve(dir, path), "utf-8"),
    exec: async (command) => {
      try {
        const stdout = execSync(command, {
          cwd: dir,
          encoding: "utf-8",
          timeout: 30_000,
        });
        return { stdout, exitCode: 0 };
      } catch (error) {
        const failure = error as {
          stdout?: string | Buffer;
          stderr?: string | Buffer;
          message?: string;
          status?: number | null;
        };
        return {
          stdout: String(failure.stdout || failure.stderr || (failure.status == null ? failure.message : "") || ""),
          exitCode: failure.status ?? 1,
        };
      }
    },
    stop: async () => {},
  };
}
