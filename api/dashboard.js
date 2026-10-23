const BOTMAKER_API_BASE_URL = "https://api.botmaker.com/v2.0";
const PERIOD_DAYS = 7;
const CACHE_SECONDS = 6 * 60 * 60;
const TIME_ZONE = "America/Sao_Paulo";

function normalizeText(value, maxLength = 100) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function increment(counter, key, amount = 1) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return;
  counter[normalizedKey] = (counter[normalizedKey] || 0) + amount;
}

function ranked(counter, limit = 8) {
  return Object.entries(counter)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, limit);
}

function asItems(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function fetchBotmaker(path, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  const query = new URLSearchParams(params);
  const url = `${BOTMAKER_API_BASE_URL}${path}${query.size ? `?${query}` : ""}`;

  try {
    const result = await fetch(url, {
      headers: { "access-token": process.env.BOTMAKER_ACCESS_TOKEN },
      signal: controller.signal
    });

    if (!result.ok) {
      const error = new Error(`Botmaker respondeu ${result.status}`);
      error.status = result.status;
      throw error;
    }

    return result.json();
  } finally {
    clearTimeout(timeout);
  }
}

function dayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TIME_ZONE
  }).format(date);
}

function parseDuration(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const match = text.match(/(?:(\d+)\s+days?\s+)?(\d{1,2}):(\d{2}):(\d{2})/i);
  if (!match) return null;
  return Number(match[1] || 0) * 86400 + Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function isFalseLike(value) {
  return /^(false|falso|nao|não|0|n|inexistente|não encontrado|nao encontrado)$/i.test(normalizeText(value));
}

function clickArea(label) {
  const value = normalizeText(label).toLowerCase();
  if (/boleto|negocia|contrato|cpf|financeir|atendente|segunda via/.test(value)) return "pos-vendas";
  if (/empreendimento|portal|venda|interesse|unidade/.test(value)) return "comercial";
  return "all";
}

function agentStatus(agent) {
  if (agent?.isOnline) return { status: "online", statusLabel: "Online" };
  const status = normalizeText(agent?.status).toLowerCase();
  if (/busy|ocupad/.test(status)) return { status: "busy", statusLabel: "Ocupado" };
  return { status: "offline", statusLabel: "Offline" };
}

function buildDashboard(sessionsPayload, agentsPayload, metricsPayload, from, to) {
  const sessions = asItems(sessionsPayload);
  const agents = asItems(agentsPayload);
  const metrics = asItems(metricsPayload);
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const clicks = {};
  const developments = {};
  const agentActivity = new Map();
  const integrationErrors = new Set();
  const notFound = new Set();
  const humanSessions = new Set();
  const closedSessions = new Set();
  let identifiedDevelopments = 0;

  const trendMap = new Map();
  for (let offset = PERIOD_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(to.getTime() - offset * 24 * 60 * 60 * 1000);
    const label = dayLabel(date);
    trendMap.set(label, { label, bot: 0, human: 0 });
  }

  for (const session of sessions) {
    const sessionId = normalizeText(session?.id) || `anonymous-${sessions.indexOf(session)}`;
    const events = Array.isArray(session?.events) ? session.events : [];
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const variables = session?.chat?.variables || {};
    const eventNames = new Set(events.map((event) => event?.name));
    const touchedByHuman =
      messages.some((message) => message?.from === "agent") ||
      events.some((event) => ["central-redirect-entry", "assigned-to-agent", "queue-set", "agent-action"].includes(event?.name));

    if (touchedByHuman) humanSessions.add(sessionId);
    if (eventNames.has("conversation-close")) closedSessions.add(sessionId);
    if (eventNames.has("notification-error") || eventNames.has("blocked-content-message")) integrationErrors.add(sessionId);

    const label = dayLabel(session?.creationTime);
    const trend = trendMap.get(label);
    if (trend) trend[touchedByHuman ? "human" : "bot"] += 1;

    const sessionAgentIds = new Set();
    if (session?.chat?.agentId) sessionAgentIds.add(session.chat.agentId);
    for (const message of messages) {
      if (message?.agentId) sessionAgentIds.add(message.agentId);
      if (message?.content?.type === "button-click") increment(clicks, message?.content?.selectedButton);
    }

    for (const event of events) {
      if (event?.info?.agentId) sessionAgentIds.add(event.info.agentId);
      if (event?.name === "agent-action") increment(clicks, event?.info?.intentName);
      if (event?.name === "url-click") increment(clicks, "Clique em link");
    }

    if (!messages.some((message) => message?.content?.type === "button-click")) {
      increment(clicks, variables.lastbotoptionselected);
    }

    const enterprise = normalizeText(variables.enterprise_id, 80);
    if (enterprise) {
      identifiedDevelopments += 1;
      increment(developments, enterprise);
    }

    if (
      isFalseLike(variables.cliente_encontrado) ||
      isFalseLike(variables.boleto_encontrado) ||
      isFalseLike(variables.neg_existe)
    ) {
      notFound.add(sessionId);
    }
    if (/erro|falha/i.test(normalizeText(variables.neg_status))) integrationErrors.add(sessionId);

    for (const agentId of sessionAgentIds) {
      const current = agentActivity.get(agentId) || { sessions: new Set(), names: [] };
      current.sessions.add(sessionId);
      const eventName = events.find((event) => event?.info?.agentId === agentId)?.info?.agentName;
      if (eventName) current.names.push(eventName);
      agentActivity.set(agentId, current);
    }
  }

  const unidentified = Math.max(0, sessions.length - identifiedDevelopments);
  if (unidentified) developments["Não identificado no fluxo"] = unidentified;

  const metricsByAgent = new Map();
  for (const metric of metrics) {
    const agentId = metric?.agentId;
    if (!agentId) continue;
    const current = metricsByAgent.get(agentId) || { items: [], responseTimes: [] };
    current.items.push(metric);
    const responseTime = parseDuration(metric?.opResponseTime ?? metric?.fromSessionStartToOpFirstResponse ?? metric?.avgResponseTime);
    if (responseTime !== null) current.responseTimes.push(responseTime);
    metricsByAgent.set(agentId, current);
  }

  const allAgentIds = new Set([...agentActivity.keys(), ...metricsByAgent.keys()]);
  const agentRows = [...allAgentIds].map((agentId) => {
    const profile = agentsById.get(agentId) || {};
    const activity = agentActivity.get(agentId);
    const agentMetrics = metricsByAgent.get(agentId);
    const metricItems = agentMetrics?.items || [];
    const closed = metricItems.filter((item) => item?.closedTime || Number(item?.closedSessions) > 0).length;
    const sessionsCount = Math.max(activity?.sessions?.size || 0, metricItems.length);
    const status = agentStatus(profile);
    const fallbackName = activity?.names?.find(Boolean);

    return {
      name: normalizeText(profile?.name || fallbackName || "Agente Botmaker"),
      area: "Atendimento",
      areaId: "all",
      sessions: sessionsCount,
      firstResponseSeconds: average(agentMetrics?.responseTimes || []),
      resolution: metricItems.length ? Math.round((closed / metricItems.length) * 100) : 0,
      ...status
    };
  }).sort((a, b) => b.sessions - a.sessions);

  const responseTimes = metrics.flatMap((metric) => {
    const value = parseDuration(metric?.opResponseTime ?? metric?.fromSessionStartToOpFirstResponse ?? metric?.avgResponseTime);
    return value === null ? [] : [value];
  });
  const noHumanCount = Math.max(0, sessions.length - humanSessions.size);
  const botClosed = sessions.filter((session) => {
    const sessionId = normalizeText(session?.id);
    return sessionId && closedSessions.has(sessionId) && !humanSessions.has(sessionId);
  }).length;
  const automationOpen = Math.max(0, noHumanCount - botClosed);
  const technicalIssues = new Set([...integrationErrors, ...notFound]);
  const healthySessions = Math.max(0, sessions.length - technicalIssues.size);
  const containment = sessions.length ? Math.round((noHumanCount / sessions.length) * 1000) / 10 : 0;
  const automation = sessions.length ? Math.round((healthySessions / sessions.length) * 1000) / 10 : 0;

  return {
    meta: {
      mode: "live",
      generatedAt: new Date().toISOString(),
      source: "Botmaker API v2 · agregação sem dados pessoais",
      periodDays: PERIOD_DAYS,
      firstPageOnly: true,
      incomplete: Boolean(sessionsPayload?.nextPage),
      agentMetricsAvailable: Boolean(metricsPayload)
    },
    summary: {
      sessions: sessions.length,
      sessionsDelta: null,
      containment,
      containmentDelta: null,
      firstResponseSeconds: average(responseTimes),
      responseImprovement: null,
      automation,
      automationDelta: null
    },
    trends: [...trendMap.values()],
    outcomes: [
      { label: "Encerrado sem agente", value: botClosed },
      { label: "Com atuação humana", value: humanSessions.size },
      { label: "Em automação", value: automationOpen }
    ],
    clicks: ranked(clicks).map((item) => ({ ...item, area: clickArea(item.label) })),
    developments: ranked(developments).map((item, index) => ({
      id: `development-${index + 1}`,
      label: item.label,
      value: item.value
    })),
    agents: agentRows,
    automationHealth: [
      { id: "success", label: "Sem erro sinalizado", value: healthySessions, detail: "Sessões sem falha técnica ou ausência de informação registrada" },
      { id: "not-found", label: "Informação não localizada", value: notFound.size, detail: "Cliente, boleto ou negociação não localizada" },
      { id: "integration-error", label: "Erro de integração", value: integrationErrors.size, detail: "Falha técnica registrada nos eventos ou variáveis" }
    ]
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  if (!process.env.BOTMAKER_ACCESS_TOKEN) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ configured: false, error: "Botmaker não configurada" });
  }

  const to = new Date();
  const from = new Date(to.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const periodParams = { from: from.toISOString(), to: to.toISOString() };

  try {
    const [sessionsResult, agentsResult, metricsResult] = await Promise.allSettled([
      fetchBotmaker("/sessions", {
        ...periodParams,
        "include-open-sessions": "true",
        "include-messages": "true",
        "include-variables": "true",
        "include-events": "true",
        "include-ai-analysis": "false"
      }),
      fetchBotmaker("/agents"),
      fetchBotmaker("/dashboards/agent-metrics", {
        ...periodParams,
        "session-status": "both"
      })
    ]);

    if (sessionsResult.status !== "fulfilled") throw sessionsResult.reason;
    const data = buildDashboard(
      sessionsResult.value,
      agentsResult.status === "fulfilled" ? agentsResult.value : null,
      metricsResult.status === "fulfilled" ? metricsResult.value : null,
      from,
      to
    );

    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    response.setHeader("CDN-Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`);
    response.setHeader("Vercel-CDN-Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`);
    return response.status(200).json({ data });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(502).json({
      configured: true,
      error: error?.name === "AbortError" ? "Tempo limite na Botmaker" : "Não foi possível consolidar os dados da Botmaker"
    });
  }
}

