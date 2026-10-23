import { authenticatedUser, isAuthConfigured } from "../lib/auth.js";

export default function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }
  if (!isAuthConfigured()) {
    return response.status(503).json({ authenticated: false, configured: false });
  }
  const user = authenticatedUser(request);
  return response.status(200).json({ authenticated: Boolean(user), configured: true, user });
}

