const BOTMAKER_API_BASE_URL = "https://api.botmaker.com/v2.0";

function increment(counter, key) {
  if (!key) return;
  const normalizedKey = String(key).trim();
  if (!normalizedKey) return;
  counter[normalizedKey] = (counter[normalizedKey] || 0) + 1;
}

function ranked(counter, limit = 50) {
  return Object.entries(counter)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  const accessToken = process.env.BOTMAKER_ACCESS_TOKEN;
  if (!accessToken) {
    return response.status(503).json({ error: "Botmaker não configurada" });
  }

  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    "include-open-sessions": "true",
    "include-messages": "false",
    "include-variables": "true",
    "include-events": "true",
    "include-ai-analysis": "false"
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const botmakerResponse = await fetch(
      `${BOTMAKER_API_BASE_URL}/sessions?${query.toString()}`,
      {
        headers: { "access-token": accessToken },
        signal: controller.signal
      }
    );

    if (!botmakerResponse.ok) {
      response.setHeader("Cache-Control", "no-store");
      return response.status(502).json({
        ok: false,
        sourceStatus: botmakerResponse.status,
        error: "A Botmaker recusou a consulta de descoberta"
      });
    }

    const payload = await botmakerResponse.json();
    const sessions = Array.isArray(payload?.items) ? payload.items : [];
    const eventNames = {};
    const variableNames = {};
    const intentNames = {};
    const startingCauses = {};
    const agentIds = new Set();
    const queueIds = new Set();

    for (const session of sessions) {
      increment(startingCauses, session?.startingCause);
      const chat = session?.chat || {};
      if (chat.agentId) agentIds.add(chat.agentId);
      if (chat.queueId) queueIds.add(chat.queueId);
      for (const variableName of Object.keys(chat.variables || {})) {
        increment(variableNames, variableName);
      }

      for (const event of session?.events || []) {
        increment(eventNames, event?.name);
        increment(variableNames, event?.info?.variableName);
        increment(intentNames, event?.info?.intentName);
        increment(intentNames, event?.info?.executingIntents);
        if (event?.info?.agentId) agentIds.add(event.info.agentId);
      }
    }

    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      ok: true,
      privacy: "Somente agregados; mensagens e valores de variáveis não foram solicitados.",
      period: { from: from.toISOString(), to: to.toISOString() },
      scannedSessions: sessions.length,
      firstPageOnly: true,
      hasNextPage: Boolean(payload?.nextPage),
      uniqueAgentIds: agentIds.size,
      uniqueQueueIds: queueIds.size,
      eventNames: ranked(eventNames),
      variableNames: ranked(variableNames),
      intentNames: ranked(intentNames),
      startingCauses: ranked(startingCauses)
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(error.name === "AbortError" ? 504 : 502).json({
      ok: false,
      error: error.name === "AbortError" ? "Tempo limite na consulta" : "Falha ao consultar a Botmaker"
    });
  } finally {
    clearTimeout(timeout);
  }
}

