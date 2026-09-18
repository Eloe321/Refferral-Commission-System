import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function playwrightEnvironment(parent = process.env) {
  const environment = { ...parent };
  delete environment.DATABASE_URL_TEST;
  return environment;
}

export async function runPlaywright(args = process.argv.slice(2)) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(executable, ["exec", "playwright", "test", ...args], {
    env: playwrightEnvironment(),
    stdio: "inherit",
  });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright stopped by ${signal}`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });
}

const executedPath = process.argv[1];
if (executedPath && fileURLToPath(import.meta.url) === resolve(executedPath)) {
  process.exitCode = await runPlaywright();
}
