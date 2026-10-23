const DASHBOARD_API_URL = "/api/dashboard";
const SAMPLE_DATA_URL = "./data/dashboard.sample.json";
const AUTH_SESSION_URL = "/api/session";
const AUTH_LOGIN_URL = "/api/login";
const AUTH_LOGOUT_URL = "/api/logout";

const CHART_COLORS = {
  bot: "#2f6fed",
  human: "#eb6a52",
  success: "#2f9d67",
  violet: "#7a5af8",
  amber: "#e1a325",
};

class AuthRequiredError extends Error {}

const state = {
  data: null,
  filters: { period: "7", area: "all", development: "all" },
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function showLogin(message = "") {
  $("#dashboardShell").hidden = true;
  $("#authGate").hidden = false;
  $("#loginMessage").textContent = message;
  $("#loginPassword").value = "";
  window.setTimeout(() => $("#loginUsername").focus(), 0);
}

function unlockDashboard(user) {
  $("#signedUsername").textContent = user?.username || "admin";
  $("#authGate").hidden = true;
  $("#dashboardShell").hidden = false;
}

async function readSession() {
  const response = await fetch(AUTH_SESSION_URL, { credentials: "same-origin", cache: "no-store" });
  if (response.status === 503) return { authenticated: false, configured: false };
  if (!response.ok) return { authenticated: false, configured: true };
  return response.json();
}

async function login(event) {
  event.preventDefault();
  const button = $("#loginButton");
  const username = $("#loginUsername").value.trim();
  const password = $("#loginPassword").value;
  button.disabled = true;
  button.textContent = "Validando acesso...";
  $("#loginMessage").textContent = "";

  try {
    const response = await fetch(AUTH_LOGIN_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível entrar.");
    unlockDashboard(payload.user);
    await startDashboard();
  } catch (error) {
    showLogin(error.message || "Usuário ou senha inválidos.");
  } finally {
    button.disabled = false;
    button.textContent = "Entrar no dashboard";
  }
}

async function logout() {
  $("#logoutButton").disabled = true;
  try {
    await fetch(AUTH_LOGOUT_URL, { method: "POST", credentials: "same-origin" });
  } finally {
    state.data = null;
    $("#logoutButton").disabled = false;
    showLogin("Sessão encerrada com segurança.");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadData(days = state.filters.period) {
  try {
    const apiResponse = await fetch(`${DASHBOARD_API_URL}?days=${encodeURIComponent(days)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (apiResponse.status === 401) throw new AuthRequiredError("Sua sessão expirou.");
    if (apiResponse.ok) {
      const payload = await apiResponse.json();
      if (payload?.data) return payload.data;
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) throw error;
    // O servidor estático local não expõe /api; a amostra é carregada abaixo.
  }

  const sampleResponse = await fetch(SAMPLE_DATA_URL, { cache: "no-store" });
  if (!sampleResponse.ok) throw new Error("Não foi possível carregar a base demonstrativa.");
  return sampleResponse.json();
}

function scaled(value, multiplier, minimum = 0) {
  return Math.max(minimum, Math.round(value * multiplier));
}

function getMultiplier() {
  const period = { "30": 1, "7": 0.28, "1": 0.045 }[state.filters.period] ?? 1;
  const area = { all: 1, "pos-vendas": 0.64, comercial: 0.36 }[state.filters.area] ?? 1;
  const development = state.filters.development === "all" ? 1 : 0.32;
  return period * area * development;
}

function filteredModel() {
  const data = state.data;
  if (data.meta?.mode !== "demo") {
    const clicks = data.clicks.filter(
      (item) => state.filters.area === "all" || item.area === state.filters.area || item.area === "all"
    );
    const developments = data.developments.filter(
      (item) => state.filters.development === "all" || item.id === state.filters.development
    );
    const agents = data.agents.filter(
      (agent) => state.filters.area === "all" || agent.areaId === state.filters.area
    );
    const outcomesTotal = data.outcomes.reduce((sum, item) => sum + item.value, 0);

    return {
      ...data,
      clicks,
      developments,
      agents,
      outcomesTotal,
    };
  }

  const multiplier = getMultiplier();
  const periodRate = state.filters.period === "1" ? -1.2 : state.filters.period === "7" ? 3.6 : data.summary.sessionsDelta;
  const areaAdjustment = state.filters.area === "comercial" ? -4 : state.filters.area === "pos-vendas" ? 2 : 0;

  const trends = data.trends.map((point) => ({
    ...point,
    bot: scaled(point.bot, multiplier, 1),
    human: scaled(point.human, multiplier, 1),
  }));

  const clicks = data.clicks
    .filter((item) => state.filters.area === "all" || item.area === state.filters.area || item.area === "all")
    .map((item) => ({ ...item, value: scaled(item.value, multiplier, 1) }));

  const developments = data.developments
    .filter((item) => state.filters.development === "all" || item.id === state.filters.development)
    .map((item) => ({ ...item, value: scaled(item.value, multiplier, 1) }));

  const agents = data.agents
    .filter((agent) => state.filters.area === "all" || agent.areaId === state.filters.area)
    .map((agent) => ({ ...agent, sessions: scaled(agent.sessions, multiplier, 1) }));

  const sessions = scaled(data.summary.sessions, multiplier, 1);
  const containment = Math.min(92, Math.max(35, data.summary.containment + areaAdjustment));
  const automation = Math.min(99, Math.max(70, data.summary.automation + areaAdjustment * 0.25));

  const containedSessions = Math.round(sessions * containment / 100);
  const remainingSessions = Math.max(0, sessions - containedSessions);
  const remainingBase = data.outcomes.slice(1).reduce((sum, item) => sum + item.value, 0) || 1;
  const outcomes = data.outcomes.map((item, index) => ({
    ...item,
    value: index === 0
      ? containedSessions
      : Math.round(remainingSessions * item.value / remainingBase),
  }));
  const roundingDifference = sessions - outcomes.reduce((sum, item) => sum + item.value, 0);
  outcomes[outcomes.length - 1].value += roundingDifference;
  const outcomesTotal = outcomes.reduce((sum, item) => sum + item.value, 0);

  return {
    ...data,
    summary: {
      ...data.summary,
      sessions,
      sessionsDelta: periodRate,
      containment,
      automation,
      firstResponseSeconds: Math.round(data.summary.firstResponseSeconds * (state.filters.area === "comercial" ? 1.16 : 1)),
    },
    trends,
    clicks,
    developments,
    agents,
    outcomes,
    outcomesTotal,
    automationHealth: data.automationHealth.map((item) => ({ ...item, value: scaled(item.value, multiplier, item.value ? 1 : 0) })),
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "n/d";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}min ${String(remaining).padStart(2, "0")}s`;
}

function initials(name) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function renderSummary(model) {
  const { summary } = model;
  const isReal = model.meta?.mode !== "demo";
  $("#totalSessions").textContent = numberFormat.format(summary.sessions);
  $("#sessionsDelta").textContent = isReal
    ? (summary.sessionsDelta === null
      ? `Período consolidado de ${model.meta.periodDays} dia${model.meta.periodDays === 1 ? "" : "s"}`
      : `${summary.sessionsDelta >= 0 ? "+" : ""}${percentFormat.format(summary.sessionsDelta)}% vs. período anterior`)
    : `${summary.sessionsDelta >= 0 ? "+" : ""}${percentFormat.format(summary.sessionsDelta)}% vs. período anterior`;
  $("#sessionsDelta").className = `kpi-delta ${summary.sessionsDelta < 0 ? "negative" : "positive"}`;

  $("#containmentRate").textContent = `${percentFormat.format(summary.containment)}%`;
  $("#containmentDelta").textContent = isReal
    ? (summary.containmentDelta === null ? "Sessões sem atuação de agente" : `${summary.containmentDelta >= 0 ? "+" : ""}${percentFormat.format(summary.containmentDelta)} p.p. vs. período anterior`)
    : `+${percentFormat.format(summary.containmentDelta)} p.p. no período`;
  $("#containmentProgress").style.width = `${summary.containment}%`;

  $("#firstResponse").textContent = formatDuration(summary.firstResponseSeconds);
  $("#responseDelta").textContent = isReal
    ? (summary.firstResponseSeconds === null ? "Métrica não retornada pela API" : "Média do período")
    : `${summary.responseImprovement}% mais rápido`;

  $("#automationRate").textContent = `${percentFormat.format(summary.automation)}%`;
  $("#automationDelta").textContent = isReal
    ? (summary.automationDelta === null ? "Sem falha ou ausência de informação sinalizada" : `${summary.automationDelta >= 0 ? "+" : ""}${percentFormat.format(summary.automationDelta)} p.p. vs. período anterior`)
    : `+${percentFormat.format(summary.automationDelta)} p.p. no período`;
  $("#automationProgress").style.width = `${summary.automation}%`;

  renderSparkline(model.trends.map((item) => item.bot + item.human));
}

function renderSparkline(values) {
  const width = 220;
  const height = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - ((value - min) / Math.max(1, max - min)) * (height - 5) - 2;
    return `${x},${y}`;
  }).join(" ");
  $("#sessionsSparkline").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="${CHART_COLORS.bot}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderTrendChart(items) {
  const width = 760;
  const height = 255;
  const pad = { top: 8, right: 18, bottom: 30, left: 38 };
  const values = items.flatMap((item) => [item.bot, item.human]);
  const max = Math.max(...values, 10);
  const yMax = Math.ceil(max / 20) * 20;
  const x = (index) => pad.left + (index / Math.max(1, items.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);
  const botPoints = items.map((item, index) => `${x(index)},${y(item.bot)}`).join(" ");
  const humanPoints = items.map((item, index) => `${x(index)},${y(item.human)}`).join(" ");
  const areaPoints = `${x(0)},${height - pad.bottom} ${botPoints} ${x(items.length - 1)},${height - pad.bottom}`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = Math.round((yMax / 4) * (4 - index));
    const gy = pad.top + index * ((height - pad.top - pad.bottom) / 4);
    return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}"/><text class="chart-axis" x="0" y="${gy + 4}">${value}</text>`;
  }).join("");
  const labelStep = Math.max(1, Math.ceil(items.length / 8));
  const labels = items.map((item, index) => index % labelStep === 0 || index === items.length - 1
    ? `<text class="chart-axis" x="${x(index)}" y="${height - 6}" text-anchor="middle">${escapeHtml(item.label)}</text>`
    : "").join("");
  const pointRadius = items.length > 31 ? 2 : 4;
  const botDots = items.map((item, index) => `<circle class="chart-point" cx="${x(index)}" cy="${y(item.bot)}" r="${pointRadius}" fill="${CHART_COLORS.bot}"><title>${item.label}: ${item.bot} via bot</title></circle>`).join("");
  const humanDots = items.map((item, index) => `<circle class="chart-point" cx="${x(index)}" cy="${y(item.human)}" r="${pointRadius}" fill="${CHART_COLORS.human}"><title>${item.label}: ${item.human} via humano</title></circle>`).join("");

  $("#trendChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${CHART_COLORS.bot}" stop-opacity="0.18"/><stop offset="1" stop-color="${CHART_COLORS.bot}" stop-opacity="0.01"/></linearGradient></defs>
    ${grid}<polygon class="chart-area" points="${areaPoints}"/><polyline class="chart-bot" points="${botPoints}"/><polyline class="chart-human" points="${humanPoints}"/>${botDots}${humanDots}${labels}
  </svg>`;
}

function renderOutcomes(model) {
  const colors = [CHART_COLORS.success, CHART_COLORS.bot, CHART_COLORS.violet, CHART_COLORS.amber];
  const actualTotal = model.outcomesTotal || 0;
  const total = actualTotal || 1;
  let cursor = 0;
  const segments = model.outcomes.map((item, index) => {
    const start = cursor;
    cursor += item.value / total * 100;
    return `${colors[index]} ${start}% ${cursor}%`;
  });
  $("#outcomeDonut").style.background = `conic-gradient(${segments.join(",")})`;
  $("#donutTotal").textContent = numberFormat.format(actualTotal);
  $("#outcomeList").innerHTML = model.outcomes.map((item, index) => {
    const percentage = item.value / total * 100;
    return `<li><i style="background:${colors[index]}"></i><span>${escapeHtml(item.label)}</span><strong>${percentFormat.format(percentage)}%</strong></li>`;
  }).join("");
}

function renderBars(selector, items) {
  if (!items.length) {
    $(selector).innerHTML = '<p class="empty-state">Nenhum dado identificado no período.</p>';
    return;
  }
  const max = Math.max(...items.map((item) => item.value), 1);
  $(selector).innerHTML = items.map((item) => `<div class="bar-row">
    <div class="bar-label"><span>${escapeHtml(item.label)}</span><strong>${numberFormat.format(item.value)}</strong></div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, item.value / max * 100)}%"></div></div>
  </div>`).join("");
}

function renderAgents(agents) {
  if (!agents.length) {
    $("#agentsTable").innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum atendimento humano identificado no período.</td></tr>';
    return;
  }
  $("#agentsTable").innerHTML = agents.map((agent) => `<tr>
    <td><div class="agent-cell"><span class="avatar">${escapeHtml(initials(agent.name))}</span><strong>${escapeHtml(agent.name)}</strong></div></td>
    <td>${escapeHtml(agent.area)}</td>
    <td><strong>${numberFormat.format(agent.sessions)}</strong></td>
    <td>${agent.firstResponse || formatDuration(agent.firstResponseSeconds)}</td>
    <td>${Number.isFinite(agent.resolution) ? `${percentFormat.format(agent.resolution)}%` : "n/d"}</td>
    <td><span class="status-pill ${escapeHtml(agent.status)}">${escapeHtml(agent.statusLabel)}</span></td>
  </tr>`).join("");
}

function renderAutomation(model) {
  const successful = model.automationHealth.find((item) => item.id === "success")?.value ?? 0;
  const total = model.automationHealth.reduce((sum, item) => sum + item.value, 0) || 1;
  const rate = Math.round(successful / total * 100);
  $("#automationRing").style.background = `conic-gradient(${CHART_COLORS.success} 0 ${rate}%, #e5dccf ${rate}% 100%)`;
  $("#automationRingValue").textContent = `${rate}%`;
  $("#successfulExecutions").textContent = numberFormat.format(successful);
  $("#healthList").innerHTML = model.automationHealth.map((item) => `<div class="health-row">
    <span>${escapeHtml(item.label)}</span><strong>${numberFormat.format(item.value)}</strong><small>${escapeHtml(item.detail)}</small>
  </div>`).join("");
}

function render() {
  const model = filteredModel();
  renderSummary(model);
  renderTrendChart(model.trends);
  renderOutcomes(model);
  renderBars("#clicksChart", model.clicks);
  renderBars("#developmentsChart", model.developments);
  renderAgents(model.agents);
  renderAutomation(model);
}

function populateFilters() {
  const select = $("#developmentFilter");
  select.innerHTML = '<option value="all">Todos os empreendimentos</option>';
  state.data.developments.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    select.append(option);
  });
}

function applyDataMode() {
  const isReal = state.data.meta?.mode !== "demo";
  const generatedAt = state.data.meta?.generatedAt ? new Date(state.data.meta.generatedAt) : null;
  const period = state.data.meta?.periodDays || Number(state.filters.period);
  $("#connectionTitle").textContent = isReal ? "Integração ativa" : "Modo demonstração";
  $("#connectionDetail").textContent = isReal ? "Botmaker + Neon conectados" : "API indisponível; usando amostra";
  $("#dataBadge").innerHTML = `<span aria-hidden="true">●</span> ${isReal ? `Dados reais · ${period} dia${period === 1 ? "" : "s"}` : "Dados demonstrativos"}`;
  $("#dataBadge").classList.toggle("live", isReal);
  $("#lastUpdated").textContent = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? generatedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "Base demonstrativa";
  $("#footerSource").textContent = isReal ? "Botmaker API v2 · histórico agregado no Neon · atualização diária" : "Base demonstrativa de contingência";
  $("#aboutPrimary").textContent = isReal
    ? "Os indicadores são agregados no servidor a partir da Botmaker e armazenados por dia. Mensagens, telefones, e-mails, CPF e valores sensíveis não são gravados no histórico nem enviados ao navegador."
    : "Os números atuais são demonstrativos e servem apenas para validar o desenho da dashboard.";
  $("#aboutSecondary").textContent = isReal
    ? `${state.data.meta.backfillComplete ? "O histórico de 180 dias está consolidado" : "A carga inicial do histórico está em andamento"}. A resposta fica em cache por 15 minutos e a sincronização segue todas as páginas retornadas pela API.`
    : "A interface usa esta amostra quando a API não está disponível.";

  $("#periodFilter").value = state.filters.period;
  $("#periodFilter").disabled = false;
  $("#areaFilter").value = state.filters.area;
  $("#areaFilter").disabled = false;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function bindInteractions() {
  [["#areaFilter", "area"], ["#developmentFilter", "development"]].forEach(([selector, key]) => {
    $(selector).addEventListener("change", (event) => {
      state.filters[key] = event.target.value;
      render();
    });
  });

  $("#periodFilter").addEventListener("change", async (event) => {
    state.filters.period = event.target.value;
    event.target.disabled = true;
    try {
      state.data = await loadData(state.filters.period);
      state.filters.development = "all";
      populateFilters();
      applyDataMode();
      render();
    } catch (error) {
      if (error instanceof AuthRequiredError) showLogin("Sua sessão expirou. Entre novamente.");
      else showToast("Não foi possível atualizar o período.");
    } finally {
      event.target.disabled = false;
    }
  });

  $("#refreshButton").addEventListener("click", async () => {
    $("#refreshButton").animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 450 });
    try {
      state.data = await loadData(state.filters.period);
      state.filters.development = "all";
      populateFilters();
      applyDataMode();
      render();
      showToast(state.data.meta?.mode !== "demo" ? "Dados reais atualizados a partir do histórico seguro." : "Base demonstrativa carregada.");
    } catch (error) {
      if (error instanceof AuthRequiredError) showLogin("Sua sessão expirou. Entre novamente.");
      else showToast("Não foi possível atualizar os dados.");
    }
  });

  const dialog = $("#aboutDataDialog");
  $("#aboutDataButton").addEventListener("click", () => dialog.showModal());

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === visible.target.id));
  }, { rootMargin: "-15% 0px -65% 0px", threshold: [0.1, 0.4] });
  ["visao-geral", "fluxos", "empreendimentos", "atendimento", "automacao"].forEach((id) => observer.observe(document.getElementById(id)));
}

let dashboardStarted = false;

async function startDashboard() {
  try {
    state.data = await loadData();
    populateFilters();
    applyDataMode();
    if (!dashboardStarted) {
      bindInteractions();
      dashboardStarted = true;
    }
    render();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      showLogin("Sua sessão expirou. Entre novamente.");
      return;
    }
    console.error(error);
    showToast("Não foi possível carregar a base demonstrativa.");
  }
}

async function init() {
  $("#loginForm").addEventListener("submit", login);
  $("#logoutButton").addEventListener("click", logout);
  try {
    const session = await readSession();
    if (!session.configured) {
      showLogin("O acesso administrativo ainda está sendo configurado.");
      return;
    }
    if (!session.authenticated) {
      showLogin();
      return;
    }
    unlockDashboard(session.user);
    await startDashboard();
  } catch {
    showLogin("Não foi possível verificar o acesso. Tente novamente.");
  }
}

init();

