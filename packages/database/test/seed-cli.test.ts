import { describe, expect, it, vi } from "vitest";
import { NORTHSTAR_IDS, runSeedCli } from "../src/index.js";

describe("seed CLI boundary", () => {
  it("prints only a neutral failure line when seeding throws sensitive context", async () => {
    const stderr = vi.fn();
    const stdout = vi.fn();
    const setExitCode = vi.fn();
    const end = vi.fn().mockResolvedValue(undefined);
    const sentinel = "jamie@example.com postgres://connection-sentinel@host/example";

    await runSeedCli({
      databaseUrl: "postgres://connection-sentinel@host/example",
      createClient: vi.fn(() => ({ db: {}, sql: { end } })),
      seed: vi.fn().mockRejectedValue(new Error(sentinel)),
      writeStdout: stdout,
      writeStderr: stderr,
      setExitCode,
    });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledExactlyOnceWith("Sandbox seed failed.\n");
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("jamie@example.com"));
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("connection-sentinel"));
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(1);
    expect(end).toHaveBeenCalledExactlyOnceWith();
  });

  it("prints the neutral success line and closes the client", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const setExitCode = vi.fn();
    const end = vi.fn().mockResolvedValue(undefined);

    await runSeedCli({
      databaseUrl: "postgres://safe@example.test/sandbox",
      createClient: vi.fn(() => ({ db: {}, sql: { end } })),
      seed: vi.fn().mockResolvedValue(undefined),
      writeStdout: stdout,
      writeStderr: stderr,
      setExitCode,
    });

    expect(stdout).toHaveBeenCalledExactlyOnceWith(
      `Seeded fictional sandbox organization ${NORTHSTAR_IDS.organization}\n`,
    );
    expect(stderr).not.toHaveBeenCalled();
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(0);
    expect(end).toHaveBeenCalledExactlyOnceWith();
  });

  it("prints a neutral failure line when DATABASE_URL is missing", async () => {
    const stderr = vi.fn();
    const createClient = vi.fn();
    const setExitCode = vi.fn();

    await runSeedCli({
      databaseUrl: undefined,
      createClient,
      seed: vi.fn(),
      writeStdout: vi.fn(),
      writeStderr: stderr,
      setExitCode,
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledExactlyOnceWith("Sandbox seed failed.\n");
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("prints a neutral failure line when client construction throws", async () => {
    const stderr = vi.fn();
    const setExitCode = vi.fn();
    const sentinel = "morgan@example.com postgres://connection-sentinel@host/example";

    await runSeedCli({
      databaseUrl: "postgres://connection-sentinel@host/example",
      createClient: vi.fn(() => {
        throw new Error(sentinel);
      }),
      seed: vi.fn(),
      writeStdout: vi.fn(),
      writeStderr: stderr,
      setExitCode,
    });

    expect(stderr).toHaveBeenCalledExactlyOnceWith("Sandbox seed failed.\n");
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("connection-sentinel"));
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("treats a client close failure after a successful seed as a neutral failure", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const setExitCode = vi.fn();
    const end = vi.fn().mockRejectedValue(new Error("jamie@example.com close-sentinel"));

    await runSeedCli({
      databaseUrl: "postgres://safe@example.test/sandbox",
      createClient: vi.fn(() => ({ db: {}, sql: { end } })),
      seed: vi.fn().mockResolvedValue(undefined),
      writeStdout: stdout,
      writeStderr: stderr,
      setExitCode,
    });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledExactlyOnceWith("Sandbox seed failed.\n");
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("close-sentinel"));
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(1);
    expect(end).toHaveBeenCalledExactlyOnceWith();
  });
});
