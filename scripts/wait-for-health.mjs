import { pathToFileURL } from "node:url";

export async function waitForHealth(
  url,
  {
    timeoutMs = 120_000,
    intervalMs = 500,
    fetchImpl = fetch,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { headers: { accept: "application/json" } });
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Health check timed out for ${url}`, { cause: lastError });
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  const url = process.argv[2];
  if (!url) {
    process.stderr.write("Usage: node scripts/wait-for-health.mjs <url>\n");
    process.exitCode = 2;
  } else {
    waitForHealth(url)
      .then(() => process.stdout.write(`Healthy: ${url}\n`))
      .catch(() => {
        process.stderr.write(`Health check failed: ${url}\n`);
        process.exitCode = 1;
      });
  }
}
