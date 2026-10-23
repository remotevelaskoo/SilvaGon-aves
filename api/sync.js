import { aggregateSessions, clickAreaForLabel } from "../lib/analytics.js";
import { fetchAgents, fetchAllSessions } from "../lib/botmaker.js";
import { ensureSchema, getSql, storeAggregateDays } from "../lib/database.js";
import { addDays, dateKeyFromUtc, saoPauloDayStart } from "../lib/dates.js";

const HISTORY_DAYS = 180;
const CHUNK_DAYS = 7;
const MAX_CHUNKS_PER_RUN = 30;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.authorization === `Bearer ${secret}`;
}

function expectedDays(from, to) {
  const days = [];
  for (let cursor = from; cursor < to; cursor = addDays(cursor, 1)) days.push(dateKeyFromUtc(cursor));
  return days;
}

async function saveState(values) {
  const sql = getSql();
  await sql.query(`
    UPDATE sync_state SET
      backfill_to = COALESCE($1::timestamptz, backfill_to),
      backfill_complete = COALESCE($2::boolean, backfill_complete),
      last_success_at = CASE WHEN $3::boolean THEN now() ELSE last_success_at END,
      last_error = $4,
      updated_at = now()
    WHERE id = 1
  `, [values.backfillTo || null, values.complete ?? null, Boolean(values.success), values.error || null]);
}

async function syncRange(from, to, agents) {
  const result = await fetchAllSessions(from, to);
  const aggregates = aggregateSessions(result.items, agents);
  await storeAggregateDays(aggregates, expectedDays(from, to), clickAreaForLabel);
  return { sessions: result.items.length, pages: result.pages };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }
  if (!isAuthorized(request)) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(401).json({ error: "Não autorizado" });
  }
  response.setHeader("Cache-Control", "no-store");

  try {
    await ensureSchema();
    const sql = getSql();
    const [state] = await sql`SELECT backfill_to, backfill_complete FROM sync_state WHERE id = 1`;
    const today = saoPauloDayStart();
    const historyStart = addDays(today, -(HISTORY_DAYS - 1));
    const agents = await fetchAgents().catch(() => []);
    let cursor = state?.backfill_to ? new Date(state.backfill_to) : addDays(today, 1);
    let chunks = 0;
    let sessions = 0;
    let pages = 0;

    if (!state?.backfill_complete) {
      while (cursor > historyStart && chunks < MAX_CHUNKS_PER_RUN) {
        const from = new Date(Math.max(addDays(cursor, -CHUNK_DAYS).getTime(), historyStart.getTime()));
        const result = await syncRange(from, cursor, agents);
        sessions += result.sessions;
        pages += result.pages;
        cursor = from;
        chunks += 1;
        const complete = cursor <= historyStart;
        await saveState({ backfillTo: cursor.toISOString(), complete, success: true });
        if (complete) break;
      }
    } else {
      const result = await syncRange(addDays(today, -1), new Date(), agents);
      sessions = result.sessions;
      pages = result.pages;
      chunks = 1;
      await saveState({ complete: true, success: true });
    }

    return response.status(200).json({
      ok: true,
      historyDays: HISTORY_DAYS,
      complete: cursor <= historyStart || Boolean(state?.backfill_complete),
      chunks,
      sessions,
      pages,
      through: cursor.toISOString()
    });
  } catch (error) {
    try {
      await saveState({ success: false, error: error?.status === 429 ? "Cota diária da Botmaker atingida" : "Falha na sincronização" });
    } catch {
      // A falha original é retornada sem expor detalhes ou credenciais.
    }
    return response.status(error?.status === 429 ? 429 : 502).json({
      ok: false,
      error: error?.status === 429 ? "Cota diária da Botmaker atingida; a carga continuará na próxima execução." : "Não foi possível sincronizar o histórico."
    });
  }
}

export const config = { maxDuration: 120 };
