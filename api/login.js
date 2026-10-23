import {
  createSessionToken,
  isAuthConfigured,
  setSessionCookie,
  verifyAdminCredentials,
} from "../lib/auth.js";

function requestBody(request) {
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body || {};
}

export default function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido" });
  }
  if (!isAuthConfigured()) {
    return response.status(503).json({ error: "Autenticação ainda não configurada" });
  }

  const body = requestBody(request);
  const username = String(body.username || "").slice(0, 100);
  const password = String(body.password || "").slice(0, 256);
  if (!verifyAdminCredentials(username, password)) {
    return response.status(401).json({ error: "Usuário ou senha inválidos" });
  }

  setSessionCookie(response, createSessionToken(username.trim()));
  return response.status(200).json({ ok: true, user: { username: username.trim() } });
}

