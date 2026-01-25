import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function showProfilingSummary() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get profiling status
    const status = await mongoose.connection.db.command({ profile: -1 });
    console.log('📊 Profiling Status:', status);
    console.log('');

    // Get recent slow queries
    const slowQueries = await mongoose.connection.db.collection('system.profile')
      .find({ millis: { $gt: 50 } })
      .sort({ ts: -1 })
      .limit(10)
      .toArray();

    if (slowQueries.length === 0) {
      console.log('✅ No slow queries found (all queries under 50ms)');
    } else {
      console.log(`⚠️ Found ${slowQueries.length} slow queries:\n`);
      slowQueries.forEach((query, idx) => {
        console.log(`${idx + 1}. ${query.op} on ${query.ns} - ${query.millis}ms`);
        if (query.command) {
          console.log(`   Command: ${JSON.stringify(query.command).substring(0, 150)}...`);
        }
        console.log('');
      });
    }

    // Get all recent queries (last 20)
    const recentQueries = await mongoose.connection.db.collection('system.profile')
      .find({})
      .sort({ ts: -1 })
      .limit(20)
      .toArray();

    console.log(`\n📋 Last 20 database operations:`);
    console.log('Operation | Collection | Time | Type');
    console.log('----------|------------|------|-----');

    recentQueries.forEach(q => {
      const collection = q.ns.split('.')[1] || q.ns;
      const time = q.millis || 0;
      const op = q.op;
      const type = q.command?.update ? 'update' : q.command?.find ? 'find' : q.command?.count ? 'count' : 'other';
      console.log(`${op.padEnd(10)} | ${collection.padEnd(10)} | ${time.toString().padStart(4)}ms | ${type}`);
    });

    // Index statistics
    console.log('\n\n📊 Index Statistics for DIDs collection:');
    const indexStats = await mongoose.connection.db.collection('dids').aggregate([
      { $indexStats: {} }
    ]).toArray();

    indexStats.forEach(stat => {
      console.log(`\nIndex: ${stat.name}`);
      console.log(`  Accesses: ${stat.accesses.ops}`);
      console.log(`  Since: ${stat.accesses.since}`);
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

showProfilingSummary();
