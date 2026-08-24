import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import bs58check from 'bs58check';
import mongoose from 'mongoose';
import Tenant from '../../models/Tenant.js';

// USDT TRC-20 contract on Tron mainnet
export const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
// USDT has 6 decimal places on Tron
const USDT_DECIMALS = 1_000_000;

export const TRONGRID_BASE = 'https://api.trongrid.io';

function trongridHeaders() {
  const apiKey = process.env.TRONGRID_API_KEY || '';
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return headers;
}

// Derive a unique Tron address for a deposit index using BIP44 HD wallet.
// Path: m/44'/195'/0'/0/{index}. Master mnemonic in TRON_MNEMONIC env var
// (didapi has its OWN seed — never share a seed between apps).
export function deriveTronAddress(index) {
  const child = deriveChild(index);
  const uncompressed = secp256k1.getPublicKey(child.privateKey, false);
  const pubBytes = uncompressed.slice(1); // drop 0x04 prefix
  const hash = keccak_256(pubBytes);
  const full = new Uint8Array(21);
  full[0] = 0x41; // Tron mainnet prefix
  full.set(hash.slice(12), 1);
  return bs58check.encode(full);
}

// Derive the private key for a deposit index (for sweeping funds).
// WARNING: full control of the address — fund management only.
export function deriveTronPrivateKey(index) {
  return deriveChild(index).privateKey;
}

function deriveChild(index) {
  const mnemonic = process.env.TRON_MNEMONIC;
  if (!mnemonic) throw new Error('TRON_MNEMONIC not configured');
  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  return root.derive(`m/44'/195'/0'/0/${index}`);
}

/**
 * Get (or assign) the tenant's USDT deposit address. Index comes from an
 * atomic counter in the `counters` collection so two tenants can never share
 * a derivation path. Idempotent — returns the cached address on repeat calls.
 */
export async function getTenantTronAddress(tenant) {
  if (tenant.billing?.tron?.address) return tenant.billing.tron.address;

  const counter = await mongoose.connection.collection('counters').findOneAndUpdate(
    { _id: 'tron_deposit_index' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const index = counter.seq;
  const address = deriveTronAddress(index);

  // Guard: only claim the slot if the tenant still has no address (a
  // concurrent request may have won). If we lose, return the winner's address.
  const updated = await Tenant.findOneAndUpdate(
    { _id: tenant._id, 'billing.tron.address': null },
    { $set: { 'billing.tron.depositIndex': index, 'billing.tron.address': address } },
    { new: true, select: 'billing.tron' }
  );
  if (!updated) {
    const fresh = await Tenant.findById(tenant._id, 'billing.tron');
    return fresh.billing.tron.address;
  }
  console.log(`🪙 Assigned TRON deposit address to tenant ${tenant._id}: index ${index} → ${address}`);
  return address;
}

/**
 * Poll TronGrid for incoming USDT transfers to an address since `sinceMs`.
 * Returns [{ tx_id, from, to, amount_usdt, block_timestamp }] (confirmed only).
 */
export async function getIncomingUsdt(toAddress, sinceMs = Date.now() - 60 * 60 * 1000) {
  const url = `${TRONGRID_BASE}/v1/accounts/${toAddress}/transactions/trc20` +
    `?only_to=true&contract_address=${USDT_CONTRACT}&limit=50&order_by=block_timestamp,asc`;

  const res = await fetch(url, { headers: trongridHeaders() });
  if (!res.ok) {
    console.error('[tronWallet] TronGrid error:', res.status, await res.text());
    return [];
  }

  const data = await res.json();
  if (!data.data?.length) return [];

  return data.data
    .filter((tx) => tx.block_timestamp >= sinceMs)
    .map((tx) => ({
      tx_id: tx.transaction_id,
      from: tx.from,
      to: tx.to,
      amount_usdt: Number(tx.value) / USDT_DECIMALS,
      block_timestamp: tx.block_timestamp
    }));
}

/**
 * Current USDT balance of an address (human-readable).
 */
export async function getUsdtBalance(address) {
  const res = await fetch(`${TRONGRID_BASE}/v1/accounts/${address}`, { headers: trongridHeaders() });
  if (!res.ok) throw new Error(`TronGrid error: ${res.status}`);

  const data = await res.json();
  const trc20 = data.data?.[0]?.trc20 ?? [];
  const entry = trc20.find((t) => Object.keys(t)[0] === USDT_CONTRACT);
  return entry ? Number(Object.values(entry)[0]) / USDT_DECIMALS : 0;
}

/**
 * Send 10 TRX to activate a fresh deposit address if it isn't on-chain yet.
 * Uses the activator wallet (TRON_ACTIVATOR_PRIVATE_KEY). Failures are logged,
 * never thrown — activation can be retried on the next deposit.
 */
export async function activateAddressIfNeeded(address) {
  const activatorKey = process.env.TRON_ACTIVATOR_PRIVATE_KEY;
  if (!activatorKey) return;
  try {
    const TronWeb = (await import('tronweb')).TronWeb;
    const apiKey = process.env.TRONGRID_API_KEY || '';
    const tronWeb = new TronWeb({
      fullHost: TRONGRID_BASE,
      headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
      privateKey: activatorKey
    });
    const accountInfo = await tronWeb.trx.getAccount(address);
    if (!accountInfo?.address) {
      await tronWeb.trx.sendTransaction(address, tronWeb.toSun(10));
      console.log(`🪙 Activated TRON address ${address} (10 TRX sent)`);
    }
  } catch (err) {
    console.error(`[tronWallet] Failed to activate ${address}:`, err.message || err);
  }
}

/**
 * Sweep the full USDT balance of a tenant's deposit address to `destination`
 * (defaults to TRON_TREASURY_ADDRESS). Returns { amount, txHash, from, to }.
 */
export async function sweepTenantUsdt(tenant, destination = process.env.TRON_TREASURY_ADDRESS) {
  if (!destination || !destination.startsWith('T') || destination.length !== 34) {
    throw new Error('Invalid or missing destination Tron address');
  }
  const index = tenant.billing?.tron?.depositIndex;
  const address = tenant.billing?.tron?.address;
  if (index == null || !address) throw new Error('Tenant has no TRON deposit address');

  const balance = await getUsdtBalance(address);
  if (balance < 1) throw new Error(`Balance too low to sweep (${balance.toFixed(2)} USDT < 1)`);

  const TronWeb = (await import('tronweb')).TronWeb;
  const apiKey = process.env.TRONGRID_API_KEY || '';
  const tronWeb = new TronWeb({
    fullHost: TRONGRID_BASE,
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
    privateKey: Buffer.from(deriveTronPrivateKey(index)).toString('hex')
  });

  const contract = await tronWeb.contract().at(USDT_CONTRACT);
  const amountRaw = Math.floor(balance * USDT_DECIMALS);
  const txHash = await contract.methods
    .transfer(destination, amountRaw)
    .send({ feeLimit: 100_000_000 }); // 100 TRX fee limit

  console.log(`🪙 Swept ${balance.toFixed(2)} USDT from ${address} → ${destination} (${txHash})`);
  return { amount: balance, txHash, from: address, to: destination };
}
