import { readDashboard } from "../lib/dashboard-data.js";

const CACHE_SECONDS = 15 * 60;

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  try {
    const data = await readDashboard(request.query?.days);
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    response.setHeader("CDN-Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`);
    response.setHeader("Vercel-CDN-Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`);
    return response.status(200).json({ data });
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({
      configured: false,
      error: "O histórico está sendo preparado. Tente novamente em alguns minutos."
    });
  }
}
