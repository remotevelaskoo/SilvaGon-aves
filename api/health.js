export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  return response.status(200).json({
    status: "ok",
    application: "botmaker-dashboard",
    botmakerConfigured: Boolean(process.env.BOTMAKER_ACCESS_TOKEN),
    databaseConfigured: Boolean(process.env.DATABASE_URL)
  });
}

