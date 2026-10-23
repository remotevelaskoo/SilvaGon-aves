import { ensureSchema, getSql } from "./database.js";
import { addDays, dateKeyFromUtc, dayLabels, saoPauloDayStart } from "./dates.js";

const ALLOWED_PERIODS = new Set([1, 7, 30, 90, 180]);

function number(value) {
  return Number(value || 0);
}

function percentage(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function delta(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function readDashboard(requestedDays) {
  const days = ALLOWED_PERIODS.has(Number(requestedDays)) ? Number(requestedDays) : 7;
  await ensureSchema();
  const sql = getSql();
  const labels = dayLabels(days);
  const fromDay = labels[0];
  const throughDay = dateKeyFromUtc(addDays(saoPauloDayStart(), 1));
  const previousFrom = dateKeyFromUtc(addDays(saoPauloDayStart(), -(days * 2 - 1)));

  const [daily, clickRows, developmentRows, agentRows, syncRows, previousRows] = await Promise.all([
    sql.query(`
      SELECT day::text, sessions, human_sessions, bot_closed, automation_open,
             healthy_sessions, not_found, integration_errors
      FROM daily_summary WHERE day >= $1 AND day < $2 ORDER BY day
    `, [fromDay, throughDay]),
    sql.query(`
      SELECT label, area, SUM(value)::int AS value
      FROM daily_clicks WHERE day >= $1 AND day < $2
      GROUP BY label, area ORDER BY value DESC, label LIMIT 12
    `, [fromDay, throughDay]),
    sql.query(`
      SELECT label, SUM(value)::int AS value
      FROM daily_developments WHERE day >= $1 AND day < $2
      GROUP BY label ORDER BY value DESC, label LIMIT 12
    `, [fromDay, throughDay]),
    sql.query(`
      SELECT agent_id, MAX(name) AS name, SUM(sessions)::int AS sessions
      FROM daily_agents WHERE day >= $1 AND day < $2
      GROUP BY agent_id ORDER BY sessions DESC, name
    `, [fromDay, throughDay]),
    sql`SELECT backfill_complete, last_success_at, last_error FROM sync_state WHERE id = 1`,
    sql.query(`
      SELECT COALESCE(SUM(sessions), 0)::int AS sessions,
             COALESCE(SUM(human_sessions), 0)::int AS human_sessions,
             COALESCE(SUM(healthy_sessions), 0)::int AS healthy_sessions
      FROM daily_summary WHERE day >= $1 AND day < $2
    `, [previousFrom, fromDay])
  ]);

  const dailyByDate = new Map(daily.map((row) => [row.day, row]));
  const totals = daily.reduce((acc, row) => {
    for (const key of ["sessions", "human_sessions", "bot_closed", "automation_open", "healthy_sessions", "not_found", "integration_errors"]) {
      acc[key] += number(row[key]);
    }
    return acc;
  }, { sessions: 0, human_sessions: 0, bot_closed: 0, automation_open: 0, healthy_sessions: 0, not_found: 0, integration_errors: 0 });

  const previous = previousRows[0] || {};
  const containment = percentage(totals.sessions - totals.human_sessions, totals.sessions);
  const previousContainment = percentage(number(previous.sessions) - number(previous.human_sessions), number(previous.sessions));
  const automation = percentage(totals.healthy_sessions, totals.sessions);
  const previousAutomation = percentage(number(previous.healthy_sessions), number(previous.sessions));
  const sync = syncRows[0] || {};

  return {
    meta: {
      mode: "historical",
      generatedAt: new Date().toISOString(),
      source: "Botmaker API v2 · histórico agregado no Neon",
      periodDays: days,
      backfillComplete: Boolean(sync.backfill_complete),
      lastSyncAt: sync.last_success_at || null,
      availableDays: daily.length
    },
    summary: {
      sessions: totals.sessions,
      sessionsDelta: delta(totals.sessions, number(previous.sessions)),
      containment,
      containmentDelta: number(previous.sessions) ? Math.round((containment - previousContainment) * 10) / 10 : null,
      firstResponseSeconds: null,
      responseImprovement: null,
      automation,
      automationDelta: number(previous.sessions) ? Math.round((automation - previousAutomation) * 10) / 10 : null
    },
    trends: labels.map((day) => {
      const row = dailyByDate.get(day);
      const date = new Date(`${day}T12:00:00-03:00`);
      return {
        label: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date),
        bot: Math.max(0, number(row?.sessions) - number(row?.human_sessions)),
        human: number(row?.human_sessions)
      };
    }),
    outcomes: [
      { label: "Encerrado sem agente", value: totals.bot_closed },
      { label: "Com atuação humana", value: totals.human_sessions },
      { label: "Em automação", value: totals.automation_open }
    ],
    clicks: clickRows.map((row) => ({ label: row.label, area: row.area, value: number(row.value) })),
    developments: developmentRows.map((row, index) => ({ id: `development-${index + 1}`, label: row.label, value: number(row.value) })),
    agents: agentRows.map((row) => ({
      name: row.name,
      area: "Atendimento",
      areaId: "all",
      sessions: number(row.sessions),
      firstResponseSeconds: null,
      resolution: 0,
      status: "offline",
      statusLabel: "Histórico"
    })),
    automationHealth: [
      { id: "success", label: "Sem erro sinalizado", value: totals.healthy_sessions, detail: "Sessões sem falha técnica ou ausência de informação registrada" },
      { id: "not-found", label: "Informação não localizada", value: totals.not_found, detail: "Cliente, boleto ou negociação não localizada" },
      { id: "integration-error", label: "Erro de integração", value: totals.integration_errors, detail: "Falha técnica registrada nos eventos ou variáveis" }
    ]
  };
}
