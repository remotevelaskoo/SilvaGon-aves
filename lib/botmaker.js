const BOTMAKER_API_BASE_URL = "https://api.botmaker.com/v2.0";

export async function fetchBotmaker(pathOrUrl, params = {}) {
  if (!process.env.BOTMAKER_ACCESS_TOKEN) {
    throw new Error("BOTMAKER_ACCESS_TOKEN não configurado");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const isAbsolute = /^https:\/\//i.test(pathOrUrl);
  const url = new URL(isAbsolute ? pathOrUrl : `${BOTMAKER_API_BASE_URL}${pathOrUrl}`);
  if (!isAbsolute) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  }

  try {
    const result = await fetch(url, {
      headers: { "access-token": process.env.BOTMAKER_ACCESS_TOKEN },
      signal: controller.signal
    });

    if (!result.ok) {
      const error = new Error(`Botmaker respondeu ${result.status}`);
      error.status = result.status;
      error.retryAfter = result.headers.get("retry-after");
      throw error;
    }

    return result.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAllSessions(from, to) {
  const items = [];
  let nextPage = "/sessions";
  let firstPage = true;
  let pages = 0;

  while (nextPage) {
    const payload = await fetchBotmaker(nextPage, firstPage ? {
      from: from.toISOString(),
      to: to.toISOString(),
      "long-term-search": "true",
      "include-open-sessions": "true",
      "include-messages": "true",
      "include-variables": "true",
      "include-events": "true",
      "include-ai-analysis": "false"
    } : {});

    if (Array.isArray(payload?.items)) items.push(...payload.items);
    nextPage = payload?.nextPage || null;
    firstPage = false;
    pages += 1;

    if (pages >= 50 && nextPage) {
      throw new Error("Limite preventivo de paginação atingido");
    }
  }

  return { items, pages };
}

export async function fetchAgents() {
  const payload = await fetchBotmaker("/agents");
  return Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
}
