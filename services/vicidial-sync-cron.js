/**
 * Cron registration for the VICIdial DID sync.
 *
 * The cron ticks every 5 minutes and lets the service-level per-tenant
 * interval (didSyncIntervalMinutes) decide which tenants are actually due.
 * That way the global cadence (every 5 min) is decoupled from per-tenant
 * frequency (default 60 min, range 5-1440 min).
 */
import cron from 'node-cron';
import { syncAllEnabledTenants } from './vicidial-sync-service.js';

let running = false;

export function startVicidialDidSyncJob() {
  // Allow ops override (e.g. set DID_SYNC_CRON='*/15 * * * *' for less load).
  const expr = process.env.DID_SYNC_CRON || '*/5 * * * *';
  cron.schedule(expr, async () => {
    if (running) {
      console.log('[vicidial-sync] previous tick still running, skipping');
      return;
    }
    running = true;
    const startedAt = Date.now();
    try {
      const result = await syncAllEnabledTenants();
      if (result.ran > 0 || result.failed > 0) {
        console.log(`[vicidial-sync] tick done in ${Date.now() - startedAt}ms — scanned:${result.scanned} ran:${result.ran} ok:${result.succeeded} failed:${result.failed} skipped:${result.skipped}`);
      }
    } catch (err) {
      console.error('[vicidial-sync] tick error:', err.message);
    } finally {
      running = false;
    }
  });
  console.log(`✅ VICIdial DID sync job scheduled (${expr})`);
}

export default { startVicidialDidSyncJob };
