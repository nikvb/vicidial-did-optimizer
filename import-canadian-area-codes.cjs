const mongoose = require('mongoose');
const fs = require('fs');

// Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/did-optimizer').then(async () => {
  console.log('✅ Connected to MongoDB\n');

  // Define AreaCodeLocation model
  const areaCodeLocationSchema = new mongoose.Schema({
    areaCode: {
      type: String,
      required: true,
      index: true
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    country: {
      type: String,
      required: true,
      default: 'US'
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true
      }
    }
  }, {
    timestamps: false,
    versionKey: false
  });

  const AreaCodeLocation = mongoose.model('AreaCodeLocation', areaCodeLocationSchema);

  console.log('📊 Importing Canadian Area Codes\n' + '='.repeat(80));

  // Read CSV file
  const csvData = fs.readFileSync('ca-area-codes.csv', 'utf-8');
  const lines = csvData.trim().split('\n');

  console.log(`📄 Total records to import: ${lines.length}\n`);

  // Check current Canadian records
  const existingCanadian = await AreaCodeLocation.countDocuments({ country: 'CA' });
  console.log(`🍁 Existing Canadian records: ${existingCanadian}`);

  const existingUS = await AreaCodeLocation.countDocuments({ country: 'US' });
  console.log(`🇺🇸 Existing US records: ${existingUS}\n`);

  const bulkOps = [];
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse CSV line (handle quoted fields)
    const fields = [];
    let currentField = '';
    let insideQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];

      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    fields.push(currentField.trim()); // Add last field

    if (fields.length >= 6) {
      const [areaCode, city, state, country, lat, lng] = fields;

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);

      // Validate
      if (areaCode && city && state &&
          !isNaN(latitude) && !isNaN(longitude) &&
          latitude >= -90 && latitude <= 90 &&
          longitude >= -180 && longitude <= 180) {

        bulkOps.push({
          updateOne: {
            filter: {
              areaCode: areaCode,
              city: city,
              state: state,
              country: 'CA'
            },
            update: {
              $set: {
                areaCode: areaCode,
                city: city,
                state: state,
                country: 'CA',
                location: {
                  type: 'Point',
                  coordinates: [longitude, latitude]
                }
              }
            },
            upsert: true
          }
        });
        imported++;
      } else {
        skipped++;
        if (errors < 5) {
          console.log(`⚠️  Skipped invalid line ${i + 1}:`, line.substring(0, 50));
        }
        errors++;
      }
    } else {
      skipped++;
    }

    // Process in batches of 500
    if (bulkOps.length >= 500) {
      try {
        const result = await AreaCodeLocation.bulkWrite(bulkOps, { ordered: false });
        console.log(`✅ Batch processed: ${result.upsertedCount} upserted, ${result.modifiedCount} modified`);
      } catch (error) {
        console.error('❌ Bulk write error:', error.message);
      }
      bulkOps.length = 0;
    }
  }

  // Process remaining operations
  if (bulkOps.length > 0) {
    try {
      const result = await AreaCodeLocation.bulkWrite(bulkOps, { ordered: false });
      console.log(`✅ Final batch: ${result.upsertedCount} upserted, ${result.modifiedCount} modified`);
    } catch (error) {
      console.error('❌ Final bulk write error:', error.message);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 Import Summary:');
  console.log(`  ✅ Successfully imported: ${imported}`);
  console.log(`  ⚠️  Skipped: ${skipped}`);

  // Verify import
  const finalCanadian = await AreaCodeLocation.countDocuments({ country: 'CA' });
  const finalUS = await AreaCodeLocation.countDocuments({ country: 'US' });
  const total = await AreaCodeLocation.countDocuments({});

  console.log('\n📊 Database Totals:');
  console.log(`  🍁 Canadian records: ${finalCanadian} (${finalCanadian - existingCanadian > 0 ? '+' : ''}${finalCanadian - existingCanadian})`);
  console.log(`  🇺🇸 US records: ${finalUS}`);
  console.log(`  🌍 Total records: ${total}`);

  // Show sample Canadian area codes
  console.log('\n🍁 Sample Canadian Area Codes:');
  const samples = await AreaCodeLocation.find({ country: 'CA' })
    .limit(10)
    .sort({ areaCode: 1 });

  samples.forEach(sample => {
    console.log(`  - ${sample.areaCode}: ${sample.city}, ${sample.state} [${sample.location.coordinates[1]}, ${sample.location.coordinates[0]}]`);
  });

  // Count unique Canadian area codes
  const uniqueAreaCodes = await AreaCodeLocation.distinct('areaCode', { country: 'CA' });
  console.log(`\n📞 Unique Canadian area codes: ${uniqueAreaCodes.length}`);
  console.log(`   ${uniqueAreaCodes.sort().join(', ')}`);

  mongoose.disconnect();
  console.log('\n✅ Import completed and database disconnected');
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
