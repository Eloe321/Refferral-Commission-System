import { proxyApiRequest } from "../../src/lib/api-proxy";

type PagesContext = {
  env: { API_ORIGIN?: string };
  params: { path?: string | string[] };
  request: Request;
};

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const apiOrigin = context.env.API_ORIGIN?.trim();
  if (!apiOrigin) return Response.json({ status: "api_unavailable" }, { status: 503 });

  const path = context.params.path;
  const segments = Array.isArray(path) ? path : path ? path.split("/") : [];
  return proxyApiRequest(context.request, segments, apiOrigin);
};
