import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { networkInterfaces } from "node:os";

export type DeliveryMode = "preview" | "disabled" | "unisms";

export type ProviderCall = Readonly<{
  url: string;
  method: string;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}>;

export type DeliveryState = Readonly<{
  challengeCount: number;
  providerCalls: ProviderCall[];
  outbox: Array<{
    provider: string;
    status: string;
    recipient: string;
    content: string | null;
    providerReference: string | null;
  }>;
}>;

export type IsolatedDeliveryApi = Readonly<{
  origin: string;
  state(): Promise<DeliveryState>;
  runWorker(): Promise<{ count: number; state: DeliveryState }>;
  close(): Promise<void>;
}>;

type ReadyMessage = Readonly<{ origin: string; controlOrigin: string; token: string }>;

function localIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function knownDockerDatabaseUrl(): string {
  const containerId = execFileSync(
    "docker",
    ["compose", "ps", "--status", "running", "-q", "postgres"],
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
  const publishedPort = execFileSync("docker", ["compose", "port", "postgres", "5432"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  if (!containerId || !publishedPort.endsWith(":5432")) {
    throw new Error("The known Docker PostgreSQL service must be running on published port 5432");
  }

  const localAddresses = localIpv4Addresses();
  const supplied = process.env.DATABASE_URL_TEST;
  const databaseUrl =
    supplied ??
    (localAddresses[0]
      ? `postgres://sandbox:sandbox@${localAddresses[0]}:5432/postgres`
      : undefined);
  if (!databaseUrl) {
    throw new Error("A non-loopback local IPv4 address is required for Docker PostgreSQL tests");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.username !== "sandbox" ||
    parsed.password !== "sandbox" ||
    parsed.port !== "5432" ||
    parsed.pathname !== "/postgres" ||
    !localAddresses.includes(parsed.hostname)
  ) {
    throw new Error(
      "DATABASE_URL_TEST must be the local Docker endpoint with sandbox credentials, port 5432, and the postgres control database",
    );
  }
  return parsed.toString();
}

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<ReadyMessage> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Delivery harness timed out.\n${stderr}`));
    }, 120_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout.split("\n").find((candidate) => candidate.startsWith("TASK17_READY "));
      if (!line) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line.slice("TASK17_READY ".length)) as ReadyMessage);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`Delivery harness exited ${String(code)} before ready.\n${stderr}\n${stdout}`),
      );
    });
  });
}

export async function createIsolatedDeliveryApi(mode: DeliveryMode): Promise<IsolatedDeliveryApi> {
  const databaseUrl = knownDockerDatabaseUrl();
  const child = spawn(
    "pnpm",
    [
      "exec",
      "tsx",
      "--tsconfig",
      "apps/api/tsconfig.json",
      "tests/e2e/support/delivery-server.ts",
      mode,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL_TEST: databaseUrl },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const ready = await waitForReady(child);
  const control = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${ready.token}`);
    const response = await fetch(`${ready.controlOrigin}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok)
      throw new Error(`Delivery control ${path} failed with ${String(response.status)}`);
    return (await response.json()) as T;
  };
  let closed = false;
  return {
    origin: ready.origin,
    state: () => control<DeliveryState>("/state"),
    runWorker: () => control<{ count: number; state: DeliveryState }>("/run", { method: "POST" }),
    async close() {
      if (closed) return;
      closed = true;
      const exited =
        child.exitCode === null
          ? new Promise<void>((resolve) => {
              child.once("exit", () => {
                resolve();
              });
            })
          : Promise.resolve();
      try {
        await control<{ ok: true }>("/close", { method: "POST" });
        await exited;
      } catch (error) {
        child.kill("SIGTERM");
        await exited;
        throw error;
      }
    },
  };
}
