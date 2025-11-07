const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/did-optimizer').then(async () => {
  const DID = mongoose.model('DID', {
    phoneNumber: String,
    reputation: {
      score: Number,
      status: String,
      lastChecked: Date,
      robokillerData: {
        userReports: Number,
        reputationStatus: String,
        totalCalls: Number,
        lastCallDate: String,
        robokillerStatus: String,
        spamScore: Number,
        callerName: String,
        location: String,
        carrier: String,
        commentsCount: Number
      }
    },
    isActive: Boolean,
    createdAt: Date,
    updatedAt: Date
  });

  // Get phone number from command line argument
  const phoneNumber = process.argv[2];

  if (!phoneNumber) {
    console.log('❌ Please provide a phone number as argument');
    console.log('Usage: node query_dids.cjs +12097999082');
    process.exit(1);
  }

  // Try with and without + prefix
  const searchNumbers = [phoneNumber, phoneNumber.replace(/^\+/, ''), '+' + phoneNumber.replace(/^\+/, '')];

  console.log(`🔍 Searching for: ${searchNumbers.join(', ')}`);

  const did = await DID.findOne({ phoneNumber: { $in: searchNumbers } }).lean();

  if (!did) {
    console.log(`\n❌ DID ${phoneNumber} not found in database`);
    process.exit(0);
  }

  console.log('\n📱 DID Record Details:');
  console.log('='.repeat(80));
  console.log(`Phone: ${did.phoneNumber}`);
  console.log(`ID: ${did._id}`);
  console.log(`Score: ${did.reputation?.score || 'N/A'}/100`);
  console.log(`Status: ${did.reputation?.status || 'Unknown'}`);
  const lastChecked = did.reputation?.lastChecked ? new Date(did.reputation.lastChecked) : null;
  console.log(`Last Checked: ${lastChecked ? lastChecked.toISOString() : 'Never'}`);
  console.log(`Last Checked (Local): ${lastChecked ? lastChecked.toLocaleString() : 'Never'}`);

  const rk = did.reputation?.robokillerData || {};
  console.log(`\n🤖 RoboKiller Data:`);
  console.log(`  • User Reports: ${rk.userReports || 0}`);
  console.log(`  • Total Calls: ${rk.totalCalls || 0}`);
  console.log(`  • Reputation Status: ${rk.reputationStatus || 'Unknown'}`);
  console.log(`  • RoboKiller Status: ${rk.robokillerStatus || 'Unknown'}`);
  console.log(`  • Spam Score: ${rk.spamScore || 'N/A'}`);
  console.log(`  • Caller Name: ${rk.callerName || 'N/A'}`);
  console.log(`  • Location: ${rk.location || 'N/A'}`);
  console.log(`  • Carrier: ${rk.carrier || 'N/A'}`);
  console.log(`  • Comments Count: ${rk.commentsCount || 0}`);
  console.log(`  • Last Call Date: ${rk.lastCallDate || 'N/A'}`);

  const created = did.createdAt ? new Date(did.createdAt) : null;
  const updated = did.updatedAt ? new Date(did.updatedAt) : null;
  const active = did.isActive !== false ? 'Yes' : 'No';
  console.log(`\n📅 Timestamps:`);
  console.log(`  Created: ${created ? created.toISOString() : 'N/A'}`);
  console.log(`  Updated: ${updated ? updated.toISOString() : 'N/A'}`);
  console.log(`  Active: ${active}`);

  console.log(`\n📄 Full JSON Document:`);
  console.log(JSON.stringify(did, null, 2));

  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});