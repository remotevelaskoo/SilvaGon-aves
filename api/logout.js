import { clearSessionCookie } from "../lib/auth.js";

export default function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido" });
  }
  clearSessionCookie(response);
  return response.status(200).json({ ok: true });
}

