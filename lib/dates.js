const DAY_MS = 24 * 60 * 60 * 1000;
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

export function saoPauloDayStart(date = new Date()) {
  const shifted = new Date(date.getTime() - SAO_PAULO_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + SAO_PAULO_OFFSET_MS);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function dateKeyFromUtc(date) {
  return new Date(date.getTime() - SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

export function dayLabels(days, end = new Date()) {
  const today = saoPauloDayStart(end);
  const labels = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    labels.push(dateKeyFromUtc(addDays(today, -offset)));
  }
  return labels;
}
