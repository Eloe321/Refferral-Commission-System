import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./out/", import.meta.url)));
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function candidates(pathname) {
  const decoded = decodeURIComponent(pathname);
  const base = decoded === "/" ? "/index" : decoded.replace(/\/$/, "");
  return extname(base) ? [base] : [`${base}.html`, `${base}/index.html`];
}

async function staticFile(pathname) {
  for (const candidate of candidates(pathname)) {
    const file = resolve(root, `.${candidate}`);
    if (!file.startsWith(`${root}/`)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // Try the next route representation or return a 404 below.
    }
  }
  return undefined;
}

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = await staticFile(pathname);
    if (!file) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }

    const headers = {
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      ...(file.includes("/_next/") ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") response.end();
    else response.end(await readFile(file));
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Static web server listening on ${String(port)}`);
});
