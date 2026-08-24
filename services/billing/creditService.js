import Tenant from '../../models/Tenant.js';
import CreditTransaction from '../../models/CreditTransaction.js';

/**
 * Prepaid credit balance operations. The balance lives in
 * Tenant.billing.creditBalanceCents (single source of truth); every mutation
 * here is a single atomic findOneAndUpdate plus a ledger row.
 */

/**
 * Add credit. Returns the new balance in cents.
 */
export async function creditTenant(tenantId, amountCents, type, reference, notes = null) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`creditTenant: amountCents must be a positive integer (got ${amountCents})`);
  }
  const updated = await Tenant.findOneAndUpdate(
    { _id: tenantId },
    { $inc: { 'billing.creditBalanceCents': amountCents } },
    { new: true, select: 'billing.creditBalanceCents' }
  );
  if (!updated) throw new Error('creditTenant: tenant not found');

  const balanceAfterCents = updated.billing.creditBalanceCents;
  await CreditTransaction.create({ tenantId, type, amountCents, balanceAfterCents, reference, notes });
  console.log(`💵 Credit +$${(amountCents / 100).toFixed(2)} (${type}, ${reference || 'no ref'}) → balance $${(balanceAfterCents / 100).toFixed(2)}`);
  return balanceAfterCents;
}

/**
 * Deduct up to `wantedCents` from the balance — takes whatever is available,
 * never goes negative. The $gte guard makes concurrent deductions safe: if a
 * race shrinks the balance between read and write, we retry against the
 * smaller balance. Returns { deductedCents, balanceAfterCents }.
 */
export async function deductCredit(tenantId, wantedCents, type, reference, notes = null) {
  if (!Number.isInteger(wantedCents) || wantedCents <= 0) {
    return { deductedCents: 0, balanceAfterCents: null };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const tenant = await Tenant.findById(tenantId, 'billing.creditBalanceCents');
    if (!tenant) throw new Error('deductCredit: tenant not found');
    const balance = tenant.billing.creditBalanceCents || 0;
    const deductCents = Math.min(balance, wantedCents);
    if (deductCents === 0) return { deductedCents: 0, balanceAfterCents: balance };

    const updated = await Tenant.findOneAndUpdate(
      { _id: tenantId, 'billing.creditBalanceCents': { $gte: deductCents } },
      { $inc: { 'billing.creditBalanceCents': -deductCents } },
      { new: true, select: 'billing.creditBalanceCents' }
    );
    if (!updated) continue; // balance changed under us — retry

    const balanceAfterCents = updated.billing.creditBalanceCents;
    await CreditTransaction.create({
      tenantId, type, amountCents: -deductCents, balanceAfterCents, reference, notes
    });
    console.log(`💵 Credit -$${(deductCents / 100).toFixed(2)} (${type}, ${reference || 'no ref'}) → balance $${(balanceAfterCents / 100).toFixed(2)}`);
    return { deductedCents: deductCents, balanceAfterCents };
  }
  // Contention on 3 straight attempts — treat as no credit available rather than fail the charge.
  return { deductedCents: 0, balanceAfterCents: null };
}

export async function getCreditBalanceCents(tenantId) {
  const tenant = await Tenant.findById(tenantId, 'billing.creditBalanceCents');
  return tenant?.billing?.creditBalanceCents || 0;
}

export default { creditTenant, deductCredit, getCreditBalanceCents };
