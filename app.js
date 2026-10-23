const DASHBOARD_API_URL = "/api/dashboard";
const SAMPLE_DATA_URL = "./data/dashboard.sample.json";

const state = {
  data: null,
  filters: { period: "7", area: "all", development: "all" },
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadData() {
  try {
    const apiResponse = await fetch(DASHBOARD_API_URL);
    if (apiResponse.ok) {
      const payload = await apiResponse.json();
      if (payload?.data) return payload.data;
    }
  } catch {
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
  if (data.meta?.mode === "live") {
    const developments = data.developments.filter(
      (item) => state.filters.development === "all" || item.id === state.filters.development
    );
    const outcomesTotal = data.outcomes.reduce((sum, item) => sum + item.value, 0);

    return {
      ...data,
      developments,
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
  const isLive = model.meta?.mode === "live";
  $("#totalSessions").textContent = numberFormat.format(summary.sessions);
  $("#sessionsDelta").textContent = isLive
    ? "Período consolidado de 7 dias"
    : `${summary.sessionsDelta >= 0 ? "+" : ""}${percentFormat.format(summary.sessionsDelta)}% vs. período anterior`;
  $("#sessionsDelta").className = `kpi-delta ${!isLive && summary.sessionsDelta < 0 ? "negative" : "positive"}`;

  $("#containmentRate").textContent = `${percentFormat.format(summary.containment)}%`;
  $("#containmentDelta").textContent = isLive
    ? "Sessões sem atuação de agente"
    : `+${percentFormat.format(summary.containmentDelta)} p.p. no período`;
  $("#containmentProgress").style.width = `${summary.containment}%`;

  $("#firstResponse").textContent = formatDuration(summary.firstResponseSeconds);
  $("#responseDelta").textContent = isLive
    ? (summary.firstResponseSeconds === null ? "Métrica não retornada pela API" : "Média do período")
    : `${summary.responseImprovement}% mais rápido`;

  $("#automationRate").textContent = `${percentFormat.format(summary.automation)}%`;
  $("#automationDelta").textContent = isLive
    ? "Sem falha ou ausência de informação sinalizada"
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
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / Math.max(1, max - min)) * (height - 5) - 2;
    return `${x},${y}`;
  }).join(" ");
  $("#sessionsSparkline").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#bfd943" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderTrendChart(items) {
  const width = 760;
  const height = 255;
  const pad = { top: 8, right: 18, bottom: 30, left: 38 };
  const values = items.flatMap((item) => [item.bot, item.human]);
  const max = Math.max(...values, 10);
  const yMax = Math.ceil(max / 20) * 20;
  const x = (index) => pad.left + (index / (items.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);
  const botPoints = items.map((item, index) => `${x(index)},${y(item.bot)}`).join(" ");
  const humanPoints = items.map((item, index) => `${x(index)},${y(item.human)}`).join(" ");
  const areaPoints = `${x(0)},${height - pad.bottom} ${botPoints} ${x(items.length - 1)},${height - pad.bottom}`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = Math.round((yMax / 4) * (4 - index));
    const gy = pad.top + index * ((height - pad.top - pad.bottom) / 4);
    return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}"/><text class="chart-axis" x="0" y="${gy + 4}">${value}</text>`;
  }).join("");
  const labels = items.map((item, index) => `<text class="chart-axis" x="${x(index)}" y="${height - 6}" text-anchor="middle">${escapeHtml(item.label)}</text>`).join("");
  const botDots = items.map((item, index) => `<circle class="chart-point" cx="${x(index)}" cy="${y(item.bot)}" r="4" fill="#3a8f7b"><title>${item.label}: ${item.bot} via bot</title></circle>`).join("");
  const humanDots = items.map((item, index) => `<circle class="chart-point" cx="${x(index)}" cy="${y(item.human)}" r="4" fill="#7f941c"><title>${item.label}: ${item.human} via humano</title></circle>`).join("");

  $("#trendChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3a8f7b" stop-opacity="0.18"/><stop offset="1" stop-color="#3a8f7b" stop-opacity="0.01"/></linearGradient></defs>
    ${grid}<polygon class="chart-area" points="${areaPoints}"/><polyline class="chart-bot" points="${botPoints}"/><polyline class="chart-human" points="${humanPoints}"/>${botDots}${humanDots}${labels}
  </svg>`;
}

function renderOutcomes(model) {
  const colors = ["#3a8f7b", "#bfd943", "#e9aa3b", "#d7dfda"];
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
    <td>${percentFormat.format(agent.resolution)}%</td>
    <td><span class="status-pill ${escapeHtml(agent.status)}">${escapeHtml(agent.statusLabel)}</span></td>
  </tr>`).join("");
}

function renderAutomation(model) {
  const successful = model.automationHealth.find((item) => item.id === "success")?.value ?? 0;
  const total = model.automationHealth.reduce((sum, item) => sum + item.value, 0) || 1;
  const rate = Math.round(successful / total * 100);
  $("#automationRing").style.background = `conic-gradient(var(--teal) 0 ${rate}%, #dfe7e1 ${rate}% 100%)`;
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
  const isLive = state.data.meta?.mode === "live";
  const generatedAt = state.data.meta?.generatedAt ? new Date(state.data.meta.generatedAt) : null;
  $("#connectionTitle").textContent = isLive ? "Integração ativa" : "Modo demonstração";
  $("#connectionDetail").textContent = isLive ? "Botmaker API conectada" : "API indisponível; usando amostra";
  $("#dataBadge").innerHTML = `<span aria-hidden="true">●</span> ${isLive ? "Dados reais · 7 dias" : "Dados demonstrativos"}`;
  $("#dataBadge").classList.toggle("live", isLive);
  $("#lastUpdated").textContent = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? generatedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "Base demonstrativa";
  $("#footerSource").textContent = isLive ? "Integração ativa via Botmaker API v2 · cache de 6 horas" : "Base demonstrativa de contingência";
  $("#aboutPrimary").textContent = isLive
    ? "Os indicadores são agregados no servidor a partir dos últimos sete dias da Botmaker. Mensagens, telefones, e-mails, CPF e valores sensíveis não são enviados ao navegador."
    : "Os números atuais são demonstrativos e servem apenas para validar o desenho da dashboard.";
  $("#aboutSecondary").textContent = isLive
    ? "A resposta fica em cache por seis horas para reduzir o consumo da cota de BI. A consulta atual utiliza somente a primeira página, com até 500 sessões."
    : "A interface usa esta amostra quando a API não está disponível.";

  $("#periodFilter").value = isLive ? "7" : state.filters.period;
  $("#periodFilter").disabled = isLive;
  $("#areaFilter").value = "all";
  $("#areaFilter").disabled = isLive;
  if (isLive) {
    state.filters.period = "7";
    state.filters.area = "all";
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function bindInteractions() {
  [["#periodFilter", "period"], ["#areaFilter", "area"], ["#developmentFilter", "development"]].forEach(([selector, key]) => {
    $(selector).addEventListener("change", (event) => {
      state.filters[key] = event.target.value;
      render();
    });
  });

  $("#refreshButton").addEventListener("click", async () => {
    $("#refreshButton").animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 450 });
    try {
      state.data = await loadData();
      state.filters.development = "all";
      populateFilters();
      applyDataMode();
      render();
      showToast(state.data.meta?.mode === "live" ? "Dados reais atualizados a partir do cache seguro." : "Base demonstrativa carregada.");
    } catch {
      showToast("Não foi possível atualizar os dados.");
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

async function init() {
  try {
    state.data = await loadData();
    populateFilters();
    applyDataMode();
    bindInteractions();
    render();
  } catch (error) {
    console.error(error);
    showToast("Não foi possível carregar a base demonstrativa.");
  }
}

init();

