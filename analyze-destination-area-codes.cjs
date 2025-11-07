const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/did-optimizer').then(async () => {
  const CallRecord = mongoose.model('CallRecord', {
    customerPhone: String,
    tenantId: mongoose.Schema.Types.ObjectId,
    callDate: Date,
    status: String
  });

  console.log('📊 Destination Area Code Analysis');
  console.log('='.repeat(80));

  // Extract area codes from customer phone numbers
  const results = await CallRecord.aggregate([
    {
      $match: {
        customerPhone: { $exists: true, $ne: null }
      }
    },
    {
      $addFields: {
        // Clean phone number: remove +1 prefix
        cleanPhone: {
          $cond: {
            if: { $regexMatch: { input: '$customerPhone', regex: /^\+1/ } },
            then: { $substr: ['$customerPhone', 2, 10] }, // Remove +1
            else: '$customerPhone'
          }
        }
      }
    },
    {
      $addFields: {
        // Extract first 3 digits as area code
        areaCode: {
          $cond: {
            if: { $gte: [{ $strLenCP: '$cleanPhone' }, 10] },
            then: { $substr: ['$cleanPhone', 0, 3] },
            else: null
          }
        }
      }
    },
    {
      $match: {
        areaCode: { $ne: null, $regex: /^[0-9]{3}$/ }
      }
    },
    {
      $group: {
        _id: '$areaCode',
        callCount: { $sum: 1 }
      }
    },
    { $sort: { callCount: -1 } },
    { $limit: 30 }
  ]);

  console.log('\n📍 Top 30 Destination Area Codes (Customer Locations):');
  console.log('='.repeat(80));

  results.forEach((ac, i) => {
    console.log(`${i + 1}. Area Code ${ac._id}: ${ac.callCount.toLocaleString()} calls`);
  });

  console.log(`\n📊 Total unique destination area codes: ${results.length}`);
  console.log(`📞 Total calls analyzed: ${results.reduce((sum, r) => sum + r.callCount, 0).toLocaleString()}`);

  mongoose.disconnect();
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
