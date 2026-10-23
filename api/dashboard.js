import { readDashboard } from "../lib/dashboard-data.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }
  if (!requireAuth(request, response)) return;

  try {
    const data = await readDashboard(request.query?.days);
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    return response.status(200).json({ data });
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({
      configured: false,
      error: "O histórico está sendo preparado. Tente novamente em alguns minutos."
    });
  }
}

