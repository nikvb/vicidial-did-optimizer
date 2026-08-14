// Hybrid pricing model: base fee + per-DID marginal pricing.
// Tiers are selected based on active DID count; base fee + per-DID rate apply.
//
// Direct customer tiers:
// - Startup (0-2K DIDs): $99/mo base + $0.015/DID
// - Growth (2K-10K DIDs): $299/mo base + $0.010/DID
// - Enterprise (10K+ DIDs): $799/mo base + $0.005/DID
//
// Reseller tiers (wholesale, ~40-50% of direct per-DID rate):
// - Startup: $49/mo base + $0.010/DID
// - Growth: $149/mo base + $0.007/DID
// - Enterprise: $399/mo base + $0.003/DID

export const DIRECT_TIERS = [
  { name: 'Startup', minDIDs: 0, maxDIDs: 2000, baseFee: 99, rates: [
    { upTo: 2000, rate: 0.015 }
  ]},
  { name: 'Growth', minDIDs: 2001, maxDIDs: 10000, baseFee: 299, rates: [
    { upTo: 2000, rate: 0.015 },
    { upTo: 10000, rate: 0.010 }
  ]},
  { name: 'Enterprise', minDIDs: 10001, maxDIDs: Infinity, baseFee: 799, rates: [
    { upTo: 2000, rate: 0.015 },
    { upTo: 10000, rate: 0.010 },
    { upTo: Infinity, rate: 0.005 }
  ]}
];

export const RESELLER_TIERS = [
  { name: 'Startup', minDIDs: 0, maxDIDs: 2000, baseFee: 49, rates: [
    { upTo: 2000, rate: 0.010 }
  ]},
  { name: 'Growth', minDIDs: 2001, maxDIDs: 10000, baseFee: 149, rates: [
    { upTo: 2000, rate: 0.010 },
    { upTo: 10000, rate: 0.007 }
  ]},
  { name: 'Enterprise', minDIDs: 10001, maxDIDs: Infinity, baseFee: 399, rates: [
    { upTo: 2000, rate: 0.010 },
    { upTo: 10000, rate: 0.007 },
    { upTo: Infinity, rate: 0.003 }
  ]}
];

// Annual prepay: 12 months for the price of 10 (16.67% off).
// Enterprise gets better discount: 12 months for price of 9 (25% off).
export const ANNUAL_PREPAY_MONTHS_BILLED = 10;
export const ANNUAL_PREPAY_MONTHS_BILLED_ENTERPRISE = 9;

/**
 * Calculate per-DID charges for a given DID count within a tier's rate structure.
 * Applies marginal pricing (each rate bracket applies only to DIDs within that bracket).
 */
function calculateDidCharges(rates, totalDids) {
  const dids = Math.max(0, Math.floor(totalDids || 0));
  const breakdown = [];
  let remaining = dids;
  let prevCap = 0;
  let total = 0;

  for (const rate of rates) {
    if (remaining <= 0) break;
    const tierSize = rate.upTo - prevCap;
    const inTier = Math.min(remaining, tierSize);
    const subtotal = +(inTier * rate.rate).toFixed(4);
    breakdown.push({
      from: prevCap + 1,
      to: prevCap + inTier,
      rate: rate.rate,
      didsInTier: inTier,
      subtotal
    });
    total += subtotal;
    remaining -= inTier;
    prevCap = rate.upTo;
  }

  return { total: +total.toFixed(2), breakdown };
}

/**
 * Select the appropriate tier based on DID count and calculate charges.
 * Returns { tier, baseFee, didCharges, totalCharge, breakdown }.
 */
export function selectTierAndCharge(tiers, totalDids) {
  const dids = Math.max(0, Math.floor(totalDids || 0));
  const tier = tiers.find(t => dids >= t.minDIDs && dids <= t.maxDIDs);

  if (!tier) {
    throw new Error(`No tier found for ${dids} DIDs`);
  }

  const { total: didTotal, breakdown: didBreakdown } = calculateDidCharges(tier.rates, dids);
  const baseFee = tier.baseFee;
  const totalCharge = +(baseFee + didTotal).toFixed(2);

  return {
    tierName: tier.name,
    baseFee,
    didCharges: didTotal,
    totalMonthlyCharge: totalCharge,
    breakdown: [
      { label: 'Base fee', amount: baseFee },
      ...didBreakdown.map(b => ({
        ...b,
        label: `DIDs ${b.from}-${b.to} @ $${b.rate.toFixed(3)}`
      }))
    ]
  };
}

export function calculateDirectCharge(totalDids) {
  return selectTierAndCharge(DIRECT_TIERS, totalDids);
}

export function calculateResellerCharge(totalDids) {
  return selectTierAndCharge(RESELLER_TIERS, totalDids);
}

/**
 * Serialize tiers for API responses (includes base fee, tier name).
 */
export function serializeTiers(tiers) {
  return tiers.map(t => ({
    name: t.name,
    minDIDs: t.minDIDs,
    maxDIDs: t.maxDIDs === Infinity ? null : t.maxDIDs,
    baseFee: t.baseFee,
    rates: t.rates.map(r => ({ upTo: r.upTo === Infinity ? null : r.upTo, rate: r.rate }))
  }));
}
