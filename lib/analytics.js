const TIME_ZONE = "America/Sao_Paulo";

function normalizeText(value, maxLength = 100) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TIME_ZONE
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function increment(counter, key, amount = 1) {
  const normalized = normalizeText(key);
  if (!normalized) return;
  counter[normalized] = (counter[normalized] || 0) + amount;
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

function createDay(day) {
  return {
    day,
    sessions: 0,
    humanSessions: 0,
    botClosed: 0,
    automationOpen: 0,
    healthySessions: 0,
    notFound: 0,
    integrationErrors: 0,
    clicks: {},
    developments: {},
    agents: new Map()
  };
}

export function aggregateSessions(sessions, agents = []) {
  const days = new Map();
  const agentNames = new Map(agents.map((agent) => [agent.id, normalizeText(agent.name) || "Agente Botmaker"]));

  sessions.forEach((session, index) => {
    const day = dateKey(session?.creationTime);
    if (!day) return;
    const aggregate = days.get(day) || createDay(day);
    days.set(day, aggregate);
    aggregate.sessions += 1;

    const sessionId = normalizeText(session?.id) || `${day}-${index}`;
    const events = Array.isArray(session?.events) ? session.events : [];
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const variables = session?.chat?.variables || {};
    const eventNames = new Set(events.map((event) => event?.name));
    const touchedByHuman = messages.some((message) => message?.from === "agent") ||
      events.some((event) => ["central-redirect-entry", "assigned-to-agent", "queue-set", "agent-action"].includes(event?.name));
    const hasIntegrationError = eventNames.has("notification-error") ||
      eventNames.has("blocked-content-message") ||
      /erro|falha/i.test(normalizeText(variables.neg_status));
    const hasNotFound = isFalseLike(variables.cliente_encontrado) ||
      isFalseLike(variables.boleto_encontrado) ||
      isFalseLike(variables.neg_existe);

    if (touchedByHuman) aggregate.humanSessions += 1;
    if (!touchedByHuman && eventNames.has("conversation-close")) aggregate.botClosed += 1;
    if (hasIntegrationError) aggregate.integrationErrors += 1;
    else if (hasNotFound) aggregate.notFound += 1;
    else aggregate.healthySessions += 1;

    let hasButtonClick = false;
    const sessionAgentIds = new Set();
    if (session?.chat?.agentId) sessionAgentIds.add(session.chat.agentId);

    for (const message of messages) {
      if (message?.agentId) sessionAgentIds.add(message.agentId);
      if (message?.content?.type === "button-click") {
        hasButtonClick = true;
        increment(aggregate.clicks, message?.content?.selectedButton);
      }
    }

    for (const event of events) {
      if (event?.info?.agentId) {
        sessionAgentIds.add(event.info.agentId);
        const eventName = normalizeText(event.info.agentName);
        if (eventName && !agentNames.has(event.info.agentId)) agentNames.set(event.info.agentId, eventName);
      }
      if (event?.name === "agent-action") increment(aggregate.clicks, event?.info?.intentName);
      if (event?.name === "url-click") increment(aggregate.clicks, "Clique em link");
    }

    if (!hasButtonClick) increment(aggregate.clicks, variables.lastbotoptionselected);

    const enterprise = normalizeText(variables.enterprise_id, 80);
    increment(aggregate.developments, enterprise || "Não identificado no fluxo");

    for (const agentId of sessionAgentIds) {
      const current = aggregate.agents.get(agentId) || {
        agentId: normalizeText(agentId, 120),
        name: agentNames.get(agentId) || "Agente Botmaker",
        sessions: new Set()
      };
      current.sessions.add(sessionId);
      aggregate.agents.set(agentId, current);
    }
  });

  for (const aggregate of days.values()) {
    aggregate.automationOpen = Math.max(0, aggregate.sessions - aggregate.humanSessions - aggregate.botClosed);
  }

  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function clickAreaForLabel(label) {
  return clickArea(label);
}
