import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Extract NPANXX from phone number (JavaScript)
function extractNPANXX(phoneNumber) {
  if (!phoneNumber) return null;
  const cleanNumber = String(phoneNumber).replace(/\D/g, '');

  if (cleanNumber.length >= 10) {
    let digits = cleanNumber;
    // Handle country code (1)
    if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
      digits = cleanNumber.substring(1);
    } else if (cleanNumber.length !== 10) {
      return null;
    }

    return digits.substring(0, 6);
  }
  return null;
}

async function migrateNPANXX() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Count total DIDs without NPANXX
    const total = await mongoose.connection.db.collection('dids').countDocuments({
      $or: [
        { npanxx: { $exists: false } },
        { npanxx: null }
      ]
    });
    console.log(`📊 Found ${total} DIDs without NPANXX field`);

    if (total === 0) {
      console.log('✅ All DIDs already have NPANXX field');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Fetch DIDs in batches and update
    let updatedCount = 0;
    const batchSize = 500;
    let skip = 0;

    while (skip < total) {
      const dids = await mongoose.connection.db.collection('dids').find({
        $or: [
          { npanxx: { $exists: false } },
          { npanxx: null }
        ]
      }).skip(skip).limit(batchSize).toArray();

      if (dids.length === 0) break;

      const bulkOps = dids.map(did => {
        const npanxx = extractNPANXX(did.phoneNumber);
        return {
          updateOne: {
            filter: { _id: did._id },
            update: { $set: { npanxx: npanxx } }
          }
        };
      });

      const result = await mongoose.connection.db.collection('dids').bulkWrite(bulkOps);
      updatedCount += result.modifiedCount;

      console.log(`✅ Processed ${skip + dids.length}/${total} DIDs (updated: ${updatedCount})`);

      skip += batchSize;
    }

    console.log(`\n✅ Total updated: ${updatedCount} DIDs with NPANXX field`);

    // Verify results
    const updated = await mongoose.connection.db.collection('dids').countDocuments({
      npanxx: { $exists: true, $ne: null }
    });
    console.log(`📊 Total DIDs with NPANXX: ${updated}`);

    // Show sample results
    const samples = await mongoose.connection.db.collection('dids').find({
      npanxx: { $exists: true, $ne: null }
    }).limit(5).toArray();

    console.log('\n📋 Sample DIDs with NPANXX:');
    samples.forEach(did => {
      console.log(`  ${did.phoneNumber} → ${did.npanxx}`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

migrateNPANXX();
