"use strict";

const { metrics: outcomeMetrics } = require("./outcomes");

function planFit(subscriptions = [], rangeDays, sessions, pricingPercent) {
  const monthly = subscriptions.reduce((sum, entry) => sum + Number(entry.monthlyPrice || 0), 0);
  if (!monthly) return { configured: false, recommendation: "Set plan costs to compare subscriptions." };
  const planCost = monthly * rangeDays / 30.4375;
  const apiEquivalent = sessions.filter((session) => session.usage?.priced).reduce((sum, session) => sum + session.usage.costUSD, 0);
  let recommendation = "Insufficient pricing coverage";
  if (pricingPercent >= 80 && rangeDays >= 30) recommendation = apiEquivalent >= planCost ? "Current plan mix is cost-effective" : "Review plan utilization";
  return { configured: true, planCost, apiEquivalent, difference: apiEquivalent - planCost, pricingPercent, recommendation };
}

function buildSummary({ ledger, friction, knowledge, subscriptions, rangeDays, pricingCoverage }) {
  const outcomes = outcomeMetrics(ledger);
  const ranked = [...friction.signals, ...knowledge.signals]
    .map((item) => ({ ...item, score: (item.activeMs || item.occurrences * 60_000) * item.confidence * Math.max(1, item.occurrences) }))
    .sort((a, b) => b.score - a.score).slice(0, 3);
  const productiveMs = ledger.filter((session) => session.outcome.confidence >= 0.7)
    .reduce((sum, session) => sum + Math.max(60_000, new Date(session.lastActivityAt) - new Date(session.startedAt)), 0);
  const total = Math.max(friction.totalActiveMs, productiveMs + friction.frictionMs);
  return {
    metrics: {
      outcomeYield: outcomes.yieldPercent, outcomeCount: outcomes.outcomes, eligibleSessions: outcomes.eligible,
      frictionMs: friction.frictionMs,
      frictionCost: friction.signals.reduce((sum, item) => sum + item.attributableCost, 0),
      memoryAssisted: knowledge.metrics.assisted,
    },
    allocation: {
      productiveMs: Math.min(total, productiveMs), frictionMs: friction.frictionMs,
      explorationMs: Math.max(0, total - productiveMs - friction.frictionMs), totalMs: total,
    },
    recommendations: ranked,
    planFit: planFit(subscriptions, rangeDays, ledger, pricingCoverage),
  };
}

module.exports = { planFit, buildSummary };
