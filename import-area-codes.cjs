const fs = require('fs');
const mongoose = require('mongoose');

const AreaCodeLocationSchema = new mongoose.Schema({
  areaCode: { type: String, required: true, index: true, maxlength: 3 },
  city: { type: String, required: true, index: true, trim: true },
  state: { type: String, required: true, index: true, trim: true },
  country: { type: String, required: true, default: 'US', maxlength: 2 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  }
}, { timestamps: false, versionKey: false });

async function loadAreaCodeData() {
  try {
    await mongoose.connect('mongodb://localhost:27017/didapi');
    console.log('✅ Connected to MongoDB');

    const AreaCodeLocation = mongoose.model('AreaCodeLocation', AreaCodeLocationSchema);

    const csvData = fs.readFileSync('/home/na/didapi/temp_clone/area-code-data.csv', 'utf8');
    const lines = csvData.trim().split('\n');

    console.log(`📊 Processing ${lines.length} area code entries...`);

    let processed = 0;
    for (const line of lines) {
      const [areaCode, city, state, country, lat, lng] = line.split(',').map(field =>
        field.replace(/^"|"$/g, '').trim() // Remove quotes and trim
      );

      if (areaCode && city && state && lat && lng) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
          await AreaCodeLocation.findOneAndUpdate(
            { areaCode, city, state },
            {
              areaCode,
              city,
              state,
              country: country || 'US',
              location: {
                type: 'Point',
                coordinates: [longitude, latitude]
              }
            },
            { upsert: true, new: true }
          );
          processed++;

          if (processed % 100 === 0) {
            console.log(`📊 Processed ${processed} entries...`);
          }
        }
      }
    }

    console.log(`✅ Processed ${processed} area code locations`);

    // Test lookup for area code 605
    const test605 = await AreaCodeLocation.findOne({ areaCode: '605' });
    console.log('🔍 Test lookup for area code 605:', test605);

    // Count total entries
    const totalCount = await AreaCodeLocation.countDocuments();
    console.log(`📊 Total area code entries in database: ${totalCount}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

loadAreaCodeData();