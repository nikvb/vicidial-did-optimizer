/**
 * Patches areacodelocations with missing overlay/new area codes,
 * then re-runs location update for DIDs that still have source="Unknown".
 *
 * Overlay NPAs cover the same geography as their parent NPA, so we copy
 * the parent's coordinates/state/city and just change the areaCode.
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer';

// overlay NPA → parent NPA  (all US overlays introduced 2011-2024)
const OVERLAY_MAP = {
  '279': '916',  // Sacramento/Central CA
  '341': '415',  // San Francisco Bay Area
  '380': '740',  // SE Ohio (Columbus area)
  '382': '765',  // Central Indiana
  '385': '801',  // Utah
  '430': '903',  // East Texas
  '437': '416',  // Toronto area (CA)
  '447': '217',  // Central Illinois
  '463': '317',  // Indianapolis, IN
  '464': '708',  // Chicago suburbs, IL
  '470': '404',  // Atlanta, GA
  '531': '402',  // Nebraska
  '534': '715',  // Wisconsin
  '551': '201',  // NE New Jersey
  '564': '360',  // Western Washington
  '567': '419',  // NW Ohio
  '572': '918',  // Tulsa, OK
  '580': '580',  // SW Oklahoma (keep same)
  '628': '415',  // San Francisco
  '629': '615',  // Nashville, TN
  '636': '314',  // St. Louis area, MO
  '640': '732',  // Central NJ
  '657': '714',  // Orange County, CA
  '659': '256',  // N Alabama
  '669': '408',  // San Jose, CA
  '680': '315',  // Central New York
  '681': '304',  // West Virginia
  '689': '407',  // Orlando, FL
  '726': '210',  // San Antonio, TX
  '737': '512',  // Austin, TX
  '743': '336',  // Greensboro, NC
  '747': '818',  // San Fernando Valley, CA
  '762': '706',  // NE Georgia
  '764': '650',  // San Francisco Peninsula
  '769': '601',  // Mississippi
  '771': '301',  // Maryland
  '779': '815',  // N Illinois
  '785': '785',  // Kansas (keep)
  '786': '305',  // Miami, FL
  '820': '805',  // Santa Barbara/Ventura, CA
  '826': '540',  // Western Virginia
  '828': '828',  // Western NC (keep)
  '829': '809',  // Dominican Republic
  '832': '713',  // Houston, TX
  '838': '518',  // Albany, NY
  '840': '909',  // Inland Empire, CA
  '854': '803',  // South Carolina
  '857': '617',  // Boston, MA
  '872': '312',  // Chicago, IL
  '878': '412',  // Pittsburgh, PA
  '938': '256',  // N Alabama
  '940': '817',  // Fort Worth, TX
  '945': '214',  // Dallas, TX
  '947': '248',  // SE Michigan
  '948': '757',  // Hampton Roads, VA
  '959': '860',  // Connecticut
  '971': '503',  // Portland, OR
  '984': '919',  // Raleigh, NC
  '986': '208',  // Idaho
};

async function run() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const col = db.collection('areacodelocations');

  let added = 0, skipped = 0;

  for (const [npa, parentNpa] of Object.entries(OVERLAY_MAP)) {
    // Skip if already exists
    const exists = await col.findOne({ areaCode: npa });
    if (exists) { skipped++; continue; }

    // Find parent
    const parent = await col.findOne({ areaCode: parentNpa });
    if (!parent) {
      console.log(`⚠️  Parent NPA ${parentNpa} for ${npa} not found — skipping`);
      skipped++;
      continue;
    }

    await col.insertOne({
      areaCode: npa,
      city: parent.city,
      state: parent.state,
      country: parent.country || 'US',
      stateAbbrev: parent.stateAbbrev,
      location: parent.location,
      distanceCache: {},
      updatedAt: new Date(),
      note: `Overlay of ${parentNpa} — auto-patched`
    });
    console.log(`✅ Added NPA ${npa} → ${parent.state} (${parent.city}) [overlay of ${parentNpa}]`);
    added++;
  }

  console.log(`\n📊 areacodelocations patch: ${added} added, ${skipped} skipped`);

  // Now re-backfill DID location for all DIDs with source=Unknown
  console.log('\n🔄 Re-backfilling Unknown DIDs...');
  const dids = await db.collection('dids').find({
    'location.source': 'Unknown'
  }).toArray();

  console.log(`Found ${dids.length} DIDs with Unknown source`);

  let updated = 0, notFound = 0;
  const batchOps = [];

  for (const did of dids) {
    const phone = String(did.phoneNumber || '').replace(/\D/g, '');
    let npa = null;
    if (phone.length === 11 && phone.startsWith('1')) npa = phone.substring(1, 4);
    else if (phone.length === 10) npa = phone.substring(0, 3);
    if (!npa) continue;

    const loc = await col.findOne({ areaCode: npa });
    if (!loc) { notFound++; continue; }

    const coords = loc.location && loc.location.coordinates;
    const setFields = {
      'location.areaCode': loc.areaCode,
      'location.city': loc.city || null,
      'location.state': loc.state || null,
      'location.country': loc.country || 'US',
      'location.source': 'NPANXX',
      'location.updatedAt': new Date(),
    };
    if (coords && coords.length === 2) {
      setFields['location.coordinates'] = coords;
      setFields['location.latitude'] = coords[1];
      setFields['location.longitude'] = coords[0];
    }

    batchOps.push({
      updateOne: {
        filter: { _id: did._id },
        update: { $set: setFields }
      }
    });
    updated++;

    if (batchOps.length >= 500) {
      await db.collection('dids').bulkWrite(batchOps);
      batchOps.length = 0;
      process.stdout.write(`  Updated ${updated}...\r`);
    }
  }
  if (batchOps.length > 0) await db.collection('dids').bulkWrite(batchOps);

  console.log(`\n✅ Re-backfill: ${updated} DIDs updated, ${notFound} still without NPA data`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
