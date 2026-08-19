// Flat per-DID pricing — the single source of truth for what we charge.
// This MUST match the landing page (temp_clone/frontend/src/pages/LandingPage.js):
//   - $0.15/DID/month when we provide the DIDs
//   - $0.10/DID/month when the tenant brings their own (BYO — service only)
// No base fee, no volume tiers. A tenant's rate class comes from
// tenant.subscription.didSource ('provided' | 'byo'), and
// tenant.subscription.perDidPricing.customRate overrides it (hand-priced deals).

export const FLAT_RATES = {
  provided: 0.15, // we source/provision the numbers
  byo: 0.10       // tenant brings their own DIDs — optimization service only
};

// Reseller wholesale service rate (per client DID). Resellers bring their
// clients' own DIDs, so this mirrors the BYO service rate. Adjust when a
// wholesale discount is negotiated (Reseller.customRate overrides per reseller).
export const RESELLER_RATE = 0.10;

// Annual prepay: 12 months for the price of 10 (matches the landing page).
export const ANNUAL_PREPAY_MONTHS_BILLED = 10;
export const ANNUAL_PREPAY_MONTHS_BILLED_ENTERPRISE = 9;

// Early-adopter promo: the first N clients to activate get a launch rate on
// their BYO DIDs for the first M months, then roll to the standard flat rate.
export const EARLY_ADOPTER_PROMO = {
  label: 'early10',
  rate: 0.03,      // $/DID/mo during the promo
  months: 3,
  maxClients: 10,
  appliesTo: 'byo' // BYO (DIY) DIDs only
};

/**
 * Resolve the per-DID rate for a rate class, with optional custom override.
 */
export function rateFor(didSource = 'byo', customRate = null) {
  if (customRate != null && Number.isFinite(+customRate) && +customRate >= 0) {
    return +customRate;
  }
  return FLAT_RATES[didSource] ?? FLAT_RATES.byo;
}

/**
 * Flat charge for a DID count at a given rate.
 * Return shape is compatible with the old selectTierAndCharge() consumers:
 * { tierName, baseFee, didCharges, totalMonthlyCharge, breakdown }.
 */
export function calculateFlatCharge(totalDids, rate) {
  const dids = Math.max(0, Math.floor(totalDids || 0));
  const total = +(dids * rate).toFixed(2);
  return {
    tierName: 'Flat',
    baseFee: 0,
    didCharges: total,
    totalMonthlyCharge: total,
    total, // alias — some consumers read .total
    breakdown: dids > 0
      ? [{ from: 1, to: dids, rate, didsInTier: dids, subtotal: total, label: `${dids} DIDs @ $${rate.toFixed(2)}/mo` }]
      : []
  };
}

/**
 * Direct tenant charge. didSource: 'provided' | 'byo'; customRate overrides.
 */
export function calculateDirectCharge(totalDids, didSource = 'byo', customRate = null) {
  return calculateFlatCharge(totalDids, rateFor(didSource, customRate));
}

/**
 * Reseller wholesale charge across all client DIDs.
 */
export function calculateResellerCharge(totalDids, customRate = null) {
  const rate = (customRate != null && Number.isFinite(+customRate) && +customRate >= 0)
    ? +customRate
    : RESELLER_RATE;
  return calculateFlatCharge(totalDids, rate);
}

// ── Legacy-compat exports ────────────────────────────────────────────────────
// Old consumers serialized tier tables for API responses. The flat model is
// expressed as one open-ended "tier" per rate class so those responses stay
// well-formed without a base fee.
export const DIRECT_TIERS = [
  { name: 'Flat — we provide DIDs', minDIDs: 0, maxDIDs: Infinity, baseFee: 0, rates: [{ upTo: Infinity, rate: FLAT_RATES.provided }] },
  { name: 'Flat — bring your own DIDs', minDIDs: 0, maxDIDs: Infinity, baseFee: 0, rates: [{ upTo: Infinity, rate: FLAT_RATES.byo }] }
];

export const RESELLER_TIERS = [
  { name: 'Flat — reseller wholesale', minDIDs: 0, maxDIDs: Infinity, baseFee: 0, rates: [{ upTo: Infinity, rate: RESELLER_RATE }] }
];

export function serializeTiers(tiers) {
  return tiers.map(t => ({
    name: t.name,
    minDIDs: t.minDIDs,
    maxDIDs: t.maxDIDs === Infinity ? null : t.maxDIDs,
    baseFee: t.baseFee,
    rates: t.rates.map(r => ({ upTo: r.upTo === Infinity ? null : r.upTo, rate: r.rate }))
  }));
}
