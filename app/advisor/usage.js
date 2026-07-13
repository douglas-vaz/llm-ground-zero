"use strict";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matches(session, usage) {
  if (session.agent !== usage.agent) return false;
  const period = String(usage.period || "");
  if (session.agent === "claude") return period === session.sourceId;
  return period.includes(session.sourceId) || period.includes(session.usageKey);
}

function joinUsage(sessions, payload = {}) {
  const rows = Array.isArray(payload.session) ? payload.session : [];
  let matched = 0;
  let priced = 0;
  let matchedTokens = 0;
  let pricedTokens = 0;
  const joined = sessions.map((session) => {
    const candidates = rows.filter((row) => matches(session, row));
    const row = candidates.length === 1 ? candidates[0] : null;
    const totalTokens = number(row?.totalTokens);
    const costUSD = number(row?.totalCost);
    const isPriced = Boolean(row && costUSD > 0);
    if (row) { matched += 1; matchedTokens += totalTokens; }
    if (isPriced) { priced += 1; pricedTokens += totalTokens; }
    return {
      ...session,
      usage: {
        inputTokens: number(row?.inputTokens), outputTokens: number(row?.outputTokens),
        cacheTokens: number(row?.cacheReadTokens) + number(row?.cacheCreationTokens),
        totalTokens, costUSD, priced: isPriced, matched: Boolean(row),
      },
    };
  });
  return {
    sessions: joined,
    coverage: {
      matchedSessions: matched, totalSessions: sessions.length,
      pricedSessions: priced,
      sessionPercent: sessions.length ? Math.round(100 * matched / sessions.length) : 0,
      pricingPercent: matchedTokens ? Math.round(100 * pricedTokens / matchedTokens) : 0,
    },
  };
}

module.exports = { joinUsage, matches };
