const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/did-optimizer').then(async () => {
  const DID = mongoose.model('DID', {
    phoneNumber: String,
    capacity: Number,
    status: String,
    usage: {
      totalCalls: Number,
      dailyUsage: [{
        date: Date,
        count: Number
      }],
      lastUsed: Date,
      lastCampaign: String,
      lastAgent: String
    },
    location: {
      areaCode: String,
      city: String,
      state: String,
      country: String
    }
  });

  console.log('📊 DID Capacity Analysis');
  console.log('='.repeat(80));

  // Get total DIDs
  const totalDIDs = await DID.countDocuments({ status: 'active' });
  console.log(`\n📱 Total Active DIDs: ${totalDIDs}`);

  // Get DIDs with usage in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const activeDIDs = await DID.countDocuments({
    status: 'active',
    'usage.lastUsed': { $gte: sevenDaysAgo }
  });
  console.log(`✅ DIDs used in last 7 days: ${activeDIDs}`);

  // Capacity analysis
  const capacityStats = await DID.aggregate([
    { $match: { status: 'active' } },
    {
      $project: {
        phoneNumber: 1,
        capacity: 1,
        totalCalls: '$usage.totalCalls',
        lastUsed: '$usage.lastUsed',
        location: 1,
        utilizationRate: {
          $cond: {
            if: { $and: [{ $gt: ['$capacity', 0] }, { $gt: ['$usage.totalCalls', 0] }] },
            then: { $multiply: [{ $divide: ['$usage.totalCalls', '$capacity'] }, 100] },
            else: 0
          }
        }
      }
    },
    { $sort: { utilizationRate: -1 } }
  ]);

  // Find over-capacity DIDs (>80% utilization)
  const overCapacity = capacityStats.filter(d => d.utilizationRate > 80);
  console.log(`\n⚠️  DIDs over 80% capacity: ${overCapacity.length}`);

  if (overCapacity.length > 0) {
    console.log('\nTop 10 Over-Capacity DIDs:');
    overCapacity.slice(0, 10).forEach(did => {
      console.log(`  ${did.phoneNumber} (${did.location?.areaCode || 'N/A'}): ${did.utilizationRate.toFixed(1)}% (${did.totalCalls || 0}/${did.capacity} calls)`);
    });
  }

  // Area code analysis
  console.log('\n\n📍 Area Code Traffic Analysis');
  console.log('='.repeat(80));

  const areaCodeStats = await DID.aggregate([
    { $match: { status: 'active', 'location.areaCode': { $exists: true } } },
    {
      $group: {
        _id: '$location.areaCode',
        state: { $first: '$location.state' },
        didCount: { $sum: 1 },
        totalCalls: { $sum: '$usage.totalCalls' },
        totalCapacity: { $sum: '$capacity' },
        avgUtilization: {
          $avg: {
            $cond: {
              if: { $and: [{ $gt: ['$capacity', 0] }, { $gt: ['$usage.totalCalls', 0] }] },
              then: { $multiply: [{ $divide: ['$usage.totalCalls', '$capacity'] }, 100] },
              else: 0
            }
          }
        }
      }
    },
    { $sort: { totalCalls: -1 } },
    { $limit: 20 }
  ]);

  console.log('\nTop 20 Area Codes by Traffic:');
  areaCodeStats.forEach((ac, i) => {
    const utilization = ac.avgUtilization || 0;
    const status = utilization > 80 ? '⚠️ ' : utilization > 50 ? '⚡' : '✅';
    console.log(`${i + 1}. ${status} ${ac._id} (${ac.state || 'N/A'}): ${ac.totalCalls || 0} calls, ${ac.didCount} DIDs, ${utilization.toFixed(1)}% avg utilization`);
  });

  // Recommendations
  console.log('\n\n💡 Recommendations');
  console.log('='.repeat(80));

  const highTrafficLowDIDs = areaCodeStats.filter(ac => {
    const callsPerDID = (ac.totalCalls || 0) / ac.didCount;
    return callsPerDID > 50 && ac.didCount < 10;
  });

  if (highTrafficLowDIDs.length > 0) {
    console.log('\n🎯 Suggested Area Codes to Purchase:');
    highTrafficLowDIDs.forEach(ac => {
      const callsPerDID = Math.round((ac.totalCalls || 0) / ac.didCount);
      const suggestedDIDs = Math.ceil(callsPerDID / 50); // Assume 50 calls per DID is optimal
      console.log(`  • ${ac._id} (${ac.state}): Add ${suggestedDIDs} DIDs (currently ${ac.didCount}, handling ${callsPerDID} calls/DID)`);
    });
  } else {
    console.log('\n✅ No immediate DID purchases needed');
  }

  // Overall capacity warning
  const totalCapacity = capacityStats.reduce((sum, d) => sum + (d.capacity || 0), 0);
  const totalUsage = capacityStats.reduce((sum, d) => sum + (d.totalCalls || 0), 0);
  const overallUtilization = (totalUsage / totalCapacity) * 100;

  console.log(`\n📈 Overall System Capacity:`);
  console.log(`  Total Capacity: ${totalCapacity.toLocaleString()} calls`);
  console.log(`  Total Usage: ${totalUsage.toLocaleString()} calls`);
  console.log(`  Utilization: ${overallUtilization.toFixed(1)}%`);

  if (overallUtilization > 70) {
    console.log(`\n⚠️  WARNING: System is running at ${overallUtilization.toFixed(1)}% capacity!`);
    console.log(`  Recommendation: Purchase ${Math.ceil((totalUsage - totalCapacity * 0.7) / 100)} additional DIDs`);
  } else {
    console.log(`\n✅ System capacity is healthy`);
  }

  mongoose.disconnect();
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
