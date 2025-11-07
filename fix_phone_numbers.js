#!/usr/bin/env node

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// DID Schema
const didSchema = new mongoose.Schema({
  phoneNumber: String,
  isActive: Boolean
});

const DID = mongoose.model('DID', didSchema);

async function fixPhoneNumbers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find DIDs without +1 prefix
    const didsWithoutPlus = await DID.find({
      phoneNumber: { $not: /^\+/ }
    });

    console.log(`\nFound ${didsWithoutPlus.length} DIDs without +1 prefix`);
    console.log('Updating...\n');

    let updated = 0;
    for (const did of didsWithoutPlus) {
      let newNumber = did.phoneNumber;

      // Remove any existing +1 or 1 at start
      newNumber = newNumber.replace(/^\+?1?/, '');

      // Add +1 prefix
      newNumber = '+1' + newNumber;

      // Update the DID
      await DID.updateOne(
        { _id: did._id },
        { $set: { phoneNumber: newNumber } }
      );

      updated++;
      if (updated % 100 === 0) {
        console.log(`Updated ${updated} DIDs...`);
      }
    }

    console.log(`✅ Updated ${updated} DIDs to have +1 prefix\n`);

    // Verify
    const withoutAfter = await DID.countDocuments({ phoneNumber: { $not: /^\+/ } });
    const withAfter = await DID.countDocuments({ phoneNumber: /^\+1/ });

    console.log('Verification:');
    console.log(`  With +1: ${withAfter}`);
    console.log(`  Without +1: ${withoutAfter}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixPhoneNumbers();
