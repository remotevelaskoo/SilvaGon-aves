import { neon } from "@neondatabase/serverless";

let client;

export function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || "";
}

export function getSql() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) throw new Error("Banco de dados não configurado");
  if (!client) client = neon(connectionString);
  return client;
}

export async function ensureSchema() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS daily_summary (
      day date PRIMARY KEY,
      sessions integer NOT NULL DEFAULT 0,
      human_sessions integer NOT NULL DEFAULT 0,
      bot_closed integer NOT NULL DEFAULT 0,
      automation_open integer NOT NULL DEFAULT 0,
      healthy_sessions integer NOT NULL DEFAULT 0,
      not_found integer NOT NULL DEFAULT 0,
      integration_errors integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_clicks (
      day date NOT NULL,
      label text NOT NULL,
      area text NOT NULL,
      value integer NOT NULL DEFAULT 0,
      PRIMARY KEY (day, label)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_developments (
      day date NOT NULL,
      label text NOT NULL,
      value integer NOT NULL DEFAULT 0,
      PRIMARY KEY (day, label)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_agents (
      day date NOT NULL,
      agent_id text NOT NULL,
      name text NOT NULL,
      sessions integer NOT NULL DEFAULT 0,
      PRIMARY KEY (day, agent_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sync_state (
      id integer PRIMARY KEY CHECK (id = 1),
      backfill_to timestamptz,
      backfill_complete boolean NOT NULL DEFAULT false,
      last_success_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO sync_state (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function storeAggregateDays(days, expectedDays, clickAreaForLabel) {
  const sql = getSql();
  const byDay = new Map(days.map((item) => [item.day, item]));
  const statements = [];

  for (const day of expectedDays) {
    const item = byDay.get(day) || {
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

    statements.push(sql`
      INSERT INTO daily_summary (
        day, sessions, human_sessions, bot_closed, automation_open,
        healthy_sessions, not_found, integration_errors, updated_at
      ) VALUES (
        ${day}, ${item.sessions}, ${item.humanSessions}, ${item.botClosed}, ${item.automationOpen},
        ${item.healthySessions}, ${item.notFound}, ${item.integrationErrors}, now()
      )
      ON CONFLICT (day) DO UPDATE SET
        sessions = EXCLUDED.sessions,
        human_sessions = EXCLUDED.human_sessions,
        bot_closed = EXCLUDED.bot_closed,
        automation_open = EXCLUDED.automation_open,
        healthy_sessions = EXCLUDED.healthy_sessions,
        not_found = EXCLUDED.not_found,
        integration_errors = EXCLUDED.integration_errors,
        updated_at = now()
    `);
    statements.push(sql`DELETE FROM daily_clicks WHERE day = ${day}`);
    statements.push(sql`DELETE FROM daily_developments WHERE day = ${day}`);
    statements.push(sql`DELETE FROM daily_agents WHERE day = ${day}`);

    for (const [label, value] of Object.entries(item.clicks)) {
      statements.push(sql`
        INSERT INTO daily_clicks (day, label, area, value)
        VALUES (${day}, ${label}, ${clickAreaForLabel(label)}, ${value})
      `);
    }

    for (const [label, value] of Object.entries(item.developments)) {
      statements.push(sql`
        INSERT INTO daily_developments (day, label, value)
        VALUES (${day}, ${label}, ${value})
      `);
    }

    for (const agent of item.agents.values()) {
      statements.push(sql`
        INSERT INTO daily_agents (day, agent_id, name, sessions)
        VALUES (${day}, ${agent.agentId}, ${agent.name}, ${agent.sessions.size})
      `);
    }
  }

  await sql.transaction(statements);
}
