export async function proxyApiRequest(
  request: Request,
  path: string[],
  apiOrigin: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const target = new URL(path.map(encodeURIComponent).join("/"), `${apiOrigin.replace(/\/$/, "")}/`);
  target.search = new URL(request.url).search;
  const headers = new Headers(request.headers);
  headers.delete("host");

  return fetcher(new Request(target, request), { headers, redirect: "manual" });
}
