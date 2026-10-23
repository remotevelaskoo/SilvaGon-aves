export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  return response.status(503).json({
    configured: false,
    error: "Fonte Botmaker ainda não configurada",
    nextStep: "Conectar banco e implementar a coleta incremental antes de habilitar esta rota."
  });
}

