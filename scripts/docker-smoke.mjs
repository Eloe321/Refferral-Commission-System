import { spawnSync } from "node:child_process";
import { waitForHealth } from "./wait-for-health.mjs";

const API_URL = process.env.SMOKE_API_URL ?? "http://localhost:4000";
const WEB_URL = process.env.SMOKE_WEB_URL ?? "http://localhost:3000";
const WEB_ORIGIN = process.env.SMOKE_WEB_ORIGIN ?? WEB_URL;
const MAILPIT_URL = process.env.SMOKE_MAILPIT_URL ?? "http://localhost:8025";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? "120000");
const POLL_MS = 500;
const SUBJECT = "Your claim verification code";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(check, message, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(message, { cause: lastError });
}

async function jsonRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", WEB_ORIGIN);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  assert(response.ok, `${init.method ?? "GET"} ${path} returned ${response.status}`);
  return { response, body: await response.json() };
}

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie, "Demo session did not set a cookie");
  return cookie;
}

async function createSession(role, actorId) {
  const { response } = await jsonRequest("/demo/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, actorId }),
  });
  assert(
    response.headers.get("access-control-allow-origin") === WEB_ORIGIN,
    "API did not allow the browser web origin",
  );
  return cookieFrom(response);
}

function composeSql(query) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "sandbox",
      "-d",
      "referral_sandbox",
      "-tAc",
      query,
    ],
    { encoding: "utf8" },
  );
  assert(result.status === 0, "Could not inspect the sandbox outbox");
  return result.stdout.trim();
}

async function mailpitMessageIds() {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  assert(response.ok, `Mailpit messages returned ${response.status}`);
  const payload = await response.json();
  assert(Array.isArray(payload.messages), "Mailpit response did not include messages");
  return new Set(payload.messages.map((message) => String(message.ID ?? message.Id ?? message.id)));
}

async function main() {
  const health = await waitForHealth(`${API_URL}/health`, { timeoutMs: TIMEOUT_MS });
  const healthBody = await health.json();
  assert(healthBody.status === "ok", "API health response was not ready");

  await waitFor(async () => {
    const web = await fetch(WEB_URL);
    return web.status === 200;
  }, "Web root did not become ready");

  const initialOwnerCookie = await createSession("owner", "11111111-1111-4111-8111-000000000002");
  await jsonRequest("/demo/reset", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: initialOwnerCookie },
    body: JSON.stringify({ confirmation: "RESET SANDBOX" }),
  });

  const mailBefore = await mailpitMessageIds();
  const rileyId = "11111111-1111-4111-8111-000000000004";
  const partnerCookie = await createSession("partner", rileyId);
  const { body: earnings } = await jsonRequest("/earnings", {
    headers: { cookie: partnerCookie },
  });
  const eligible = earnings.items?.find((earning) => earning.status === "eligible");
  assert(typeof eligible?.id === "string", "Partner has no eligible earning for smoke test");

  const { body: sms } = await jsonRequest("/otp-challenges", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: partnerCookie },
    body: JSON.stringify({ earningIds: [eligible.id], channel: "sms" }),
  });
  assert(sms.delivery?.mode === "preview", "SMS challenge did not use preview delivery");
  assert(
    composeSql("select count(*) from notification_outbox where provider='unisms'") === "0",
    "UniSMS outbox work was created in preview mode",
  );

  const ownerCookie = await createSession("owner", "11111111-1111-4111-8111-000000000002");
  await jsonRequest("/demo/reset", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ confirmation: "RESET SANDBOX" }),
  });

  const emailPartnerCookie = await createSession("partner", rileyId);
  const { body: resetEarnings } = await jsonRequest("/earnings", {
    headers: { cookie: emailPartnerCookie },
  });
  const resetEligible = resetEarnings.items?.find((earning) => earning.status === "eligible");
  assert(typeof resetEligible?.id === "string", "Reset partner has no eligible earning");
  const { body: email } = await jsonRequest("/otp-challenges", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: emailPartnerCookie },
    body: JSON.stringify({ earningIds: [resetEligible.id], channel: "email" }),
  });
  assert(email.delivery?.mode === "provider", "Email challenge was not queued locally");

  await waitFor(
    async () => {
      const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
      if (!response.ok) return false;
      const payload = await response.json();
      return payload.messages?.some((message) => {
        const id = String(message.ID ?? message.Id ?? message.id);
        return !mailBefore.has(id) && message.Subject === SUBJECT;
      });
    },
    "Mailpit did not capture the verification email",
    20_000,
  );

  process.stdout.write(
    "Docker smoke PASS: web, preview SMS, outbox safety, and Mailpit email verified.\n",
  );
}

main().catch((error) => {
  process.stderr.write(
    `Docker smoke FAIL: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
