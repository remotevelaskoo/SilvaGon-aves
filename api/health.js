export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  const accessToken = process.env.BOTMAKER_ACCESS_TOKEN;

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    status: "ok",
    application: "botmaker-dashboard",
    botmakerConfigured: Boolean(accessToken),
    databaseConfigured: Boolean(process.env.DATABASE_URL)
  });
}

