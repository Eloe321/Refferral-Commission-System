import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDatabaseClient } from "../../../packages/database/src/index.js";
import { OutboxWorker } from "../../../apps/api/src/notifications/outbox.worker.js";
import { createApiTestApp } from "../../../apps/api/test/support/http.js";

type ProviderCall = Readonly<{
  url: string;
  method: string;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}>;

const mode = process.argv[2];
if (mode !== "preview" && mode !== "disabled" && mode !== "unisms") {
  throw new Error("Delivery harness mode must be preview, disabled, or unisms");
}

const providerCalls: ProviderCall[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (mode !== "unisms") throw new Error(`Network is forbidden in ${mode} delivery mode`);
  if (url !== "https://unismsapi.com/api/sms" || init?.method !== "POST") {
    throw new Error(`Unexpected provider request: ${init?.method ?? "GET"} ${url}`);
  }
  if (typeof init.body !== "string") throw new Error("Expected a JSON provider request body");
  const headers = new Headers(init.headers);
  providerCalls.push({
    url,
    method: init.method,
    authorization: headers.get("authorization"),
    contentType: headers.get("content-type"),
    body: JSON.parse(init.body) as unknown,
  });
  return Promise.resolve(
    new Response(JSON.stringify({ message: { status: "sent", reference_id: "e2e-sms-ref-1" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
};

const app = await createApiTestApp({
  deliveryEnv: {
    SMS_DELIVERY_MODE: mode,
    EMAIL_DELIVERY_MODE: "disabled",
    ...(mode === "unisms"
      ? { UNISMS_API_KEY: "fictional-browser-e2e-key", UNISMS_SENDER_ID: "NORTHSTAR" }
      : {}),
  },
});
const worker = app.app.get(OutboxWorker);
worker.onApplicationShutdown();
await app.app.listen(0, "127.0.0.1");
const apiAddress = app.app.getHttpServer().address() as { port: number } | null;
if (!apiAddress) throw new Error("Delivery API did not bind a port");
const database = createDatabaseClient(app.databaseUrl, { max: 1 });
const token = crypto.randomUUID();
let closing = false;

async function state() {
  const [challenge] = await database.sql<
    { count: number }[]
  >`select count(*)::int count from otp_challenges`;
  const outbox = await database.sql<
    {
      provider: string;
      status: string;
      recipient: string;
      content: string | null;
      provider_reference: string | null;
    }[]
  >`select provider,status,recipient,content,provider_reference from notification_outbox where channel='sms' order by created_at,id`;
  return {
    challengeCount: challenge?.count ?? 0,
    providerCalls,
    outbox: outbox.map((row) => ({
      provider: row.provider,
      status: row.status,
      recipient: row.recipient,
      content: row.content,
      providerReference: row.provider_reference,
    })),
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function cleanup(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await database.sql.end();
  } finally {
    try {
      await app.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
}

const control = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { status: "unauthorized" });
      return;
    }
    if (request.method === "GET" && request.url === "/state") {
      json(response, 200, await state());
      return;
    }
    if (request.method === "POST" && request.url === "/run") {
      const count = await worker.runOnce();
      json(response, 200, { count, state: await state() });
      return;
    }
    if (request.method === "POST" && request.url === "/close") {
      json(response, 200, { ok: true });
      control.close();
      setImmediate(() => {
        void cleanup().then(() => process.exit(0));
      });
      return;
    }
    json(response, 404, { status: "not_found" });
  })().catch((error: unknown) => {
    json(response, 500, { status: "control_error" });
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
  });
});

await new Promise<void>((resolve) => control.listen(0, "127.0.0.1", resolve));
const controlAddress = control.address() as { port: number } | null;
if (!controlAddress) throw new Error("Delivery control did not bind a port");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    control.close();
    void cleanup().then(() => process.exit(0));
  });
}

process.stdout.write(
  `TASK17_READY ${JSON.stringify({
    origin: `http://127.0.0.1:${String(apiAddress.port)}`,
    controlOrigin: `http://127.0.0.1:${String(controlAddress.port)}`,
    token,
  })}\n`,
);
