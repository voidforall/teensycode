import { Sandbox as JustBashSandbox } from "just-bash";
import { posix } from "node:path";
import type { Sandbox } from "./sandbox";

const MOUNT = "/home/user/project";

export async function createJustBashSandbox(dir: string): Promise<Sandbox> {
  const jb = await JustBashSandbox.create({ overlayRoot: dir });

  return {
    type: "just-bash",
    workingDirectory: MOUNT,
    readFile: async (p) => jb.readFile(posix.resolve(MOUNT, p)),
    exec: async (command) => {
      const cmd = await jb.runCommand(command, { cwd: MOUNT });
      const finished = await cmd.wait();
      return {
        stdout: await cmd.output(),
        exitCode: finished.exitCode,
      };
    },
    stop: async () => jb.stop(),
  };
}
