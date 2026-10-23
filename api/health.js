const BOTMAKER_API_BASE_URL = "https://api.botmaker.com/v2.0";

async function probeBotmaker(accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const probeResponse = await fetch(`${BOTMAKER_API_BASE_URL}/agents?online=false`, {
      headers: { "access-token": accessToken },
      signal: controller.signal
    });

    return {
      ok: probeResponse.ok,
      status: probeResponse.status,
      endpoint: "/agents"
    };
  } catch (error) {
    return {
      ok: false,
      status: error.name === "AbortError" ? 504 : 502,
      endpoint: "/agents"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  const accessToken = process.env.BOTMAKER_ACCESS_TOKEN;
  const shouldProbe = request.query?.probe === "botmaker";
  const botmakerConnection =
    shouldProbe && accessToken ? await probeBotmaker(accessToken) : undefined;

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    status: "ok",
    application: "botmaker-dashboard",
    botmakerConfigured: Boolean(accessToken),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    ...(botmakerConnection ? { botmakerConnection } : {})
  });
}

