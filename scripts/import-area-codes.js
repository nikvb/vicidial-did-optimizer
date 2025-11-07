import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AreaCodeLocation from '../models/AreaCodeLocation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function importAreaCodes() {
  try {
    console.log('🚀 Starting area code geolocation import...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/did-optimizer');
    console.log('✅ Connected to MongoDB');

    // Read CSV file
    const csvPath = path.join(__dirname, '../area-code-data.csv');
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found at: ${csvPath}`);
    }

    const csvData = fs.readFileSync(csvPath, 'utf8');
    console.log(`📁 Read CSV file: ${csvData.split('\n').length} lines`);

    // Clear existing data (optional - comment out if you want to preserve existing data)
    console.log('🗑️ Clearing existing area code data...');
    await AreaCodeLocation.deleteMany({});

    // Import data
    console.log('📤 Importing area code data...');
    const result = await AreaCodeLocation.bulkImportFromCSV(csvData);
    console.log(`✅ Successfully imported ${result.imported} area code records`);

    // Create indexes
    console.log('🔍 Creating database indexes...');
    await AreaCodeLocation.createIndexes();
    console.log('✅ Indexes created successfully');

    // Verify import
    const totalRecords = await AreaCodeLocation.countDocuments();
    const uniqueAreaCodes = await AreaCodeLocation.distinct('areaCode');
    const uniqueStates = await AreaCodeLocation.distinct('state');

    console.log('\n📊 Import Summary:');
    console.log(`   Total records: ${totalRecords.toLocaleString()}`);
    console.log(`   Unique area codes: ${uniqueAreaCodes.length}`);
    console.log(`   States covered: ${uniqueStates.length}`);

    // Test distance calculation
    console.log('\n🧪 Testing distance calculation...');
    const testDistance = await AreaCodeLocation.calculateDistance('212', '213');
    if (testDistance && testDistance[0] && testDistance[0].distance) {
      console.log(`   Distance between NYC (212) and LA (213): ${Math.round(testDistance[0].distance)} miles`);
    }

    // Test nearby area codes
    console.log('\n🔍 Testing nearby area codes search...');
    const nearbyAreaCodes = await AreaCodeLocation.findNearbyAreaCodes('212', 100);
    console.log(`   Found ${nearbyAreaCodes.length} area codes within 100 miles of NYC (212)`);
    if (nearbyAreaCodes.length > 0) {
      console.log(`   Closest: ${nearbyAreaCodes[0].areaCode} (${nearbyAreaCodes[0].city}, ${nearbyAreaCodes[0].state}) - ${Math.round(nearbyAreaCodes[0].distance)} miles`);
    }

    console.log('\n🎉 Area code import completed successfully!');

  } catch (error) {
    console.error('❌ Error importing area codes:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the import
importAreaCodes();