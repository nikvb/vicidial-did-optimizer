const mongoose = require('mongoose');

async function checkDashboardData() {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/did-optimizer');
        console.log('Connected to MongoDB\n');

        // Check DIDs
        const DID = mongoose.model('DID', new mongoose.Schema({
            tenantId: mongoose.Schema.Types.ObjectId,
            phoneNumber: String,
            provider: String,
            state: String,
            areaCode: String,
            status: String,
            isActive: Boolean,
            monthlyCost: Number,
            perMinuteCost: Number,
            setupCost: Number,
            capabilities: [String],
            lastUsed: Date,
            usageCount: Number,
            dailyUsageCount: Number,
            lastReset: Date,
            reputation: Number
        }));

        // Count total DIDs
        const totalDids = await DID.countDocuments();
        const activeDids = await DID.countDocuments({ status: 'active' });
        const inactiveDids = await DID.countDocuments({ status: 'inactive' });

        console.log('=== DID Statistics ===');
        console.log('Total DIDs:', totalDids);
        console.log('DIDs with status="active":', activeDids);
        console.log('DIDs with status="inactive":', inactiveDids);

        // Check isActive field vs status field
        const isActiveTrue = await DID.countDocuments({ isActive: true });
        const isActiveFalse = await DID.countDocuments({ isActive: false });
        const isActiveNull = await DID.countDocuments({ isActive: null });

        console.log('\nDIDs with isActive=true:', isActiveTrue);
        console.log('DIDs with isActive=false:', isActiveFalse);
        console.log('DIDs with isActive=null/undefined:', isActiveNull);

        // Check for the specific tenant's DIDs
        const tenantId = '68c47dd70ec6f5323ce61817';
        const tenantDids = await DID.countDocuments({ tenantId: tenantId });
        console.log('\nDIDs for tenant 68c47dd70ec6f5323ce61817:', tenantDids);

        // Sample a few DIDs to see their structure
        console.log('\n=== Sample DIDs ===');
        const sampleDids = await DID.find().limit(3);
        sampleDids.forEach(did => {
            console.log({
                phoneNumber: did.phoneNumber,
                tenantId: did.tenantId,
                status: did.status,
                isActive: did.isActive,
                usageCount: did.usageCount,
                dailyUsageCount: did.dailyUsageCount,
                lastUsed: did.lastUsed,
                lastReset: did.lastReset
            });
        });

        // Check CallRecords
        const CallRecord = mongoose.model('CallRecord', new mongoose.Schema({
            tenantId: mongoose.Schema.Types.ObjectId,
            didId: mongoose.Schema.Types.ObjectId,
            campaignId: String,
            agentId: String,
            customerPhone: String,
            callDate: Date,
            duration: Number,
            status: String,
            direction: String
        }));

        const totalCalls = await CallRecord.countDocuments();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayCalls = await CallRecord.countDocuments({
            callDate: { $gte: todayStart }
        });

        console.log('\n=== Call Records ===');
        console.log('Total calls in DB:', totalCalls);
        console.log('Calls today:', todayCalls);

        // Check recent calls
        const recentCalls = await CallRecord.find().sort({ callDate: -1 }).limit(5);
        if (recentCalls.length > 0) {
            console.log('\nRecent calls:');
            recentCalls.forEach(call => {
                console.log({
                    date: call.callDate,
                    campaign: call.campaignId,
                    agent: call.agentId,
                    status: call.status,
                    didId: call.didId
                });
            });
        } else {
            console.log('No call records found in database');
        }

        // Check if we need to create call records from our testing
        console.log('\n=== Creating Test Call Records ===');

        // Get some DIDs to create call records for
        const testDids = await DID.find({ tenantId: tenantId }).limit(5);

        if (testDids.length > 0) {
            console.log(`Found ${testDids.length} DIDs to create test calls for`);

            // Create test call records for today
            const callsToCreate = [];
            const now = new Date();

            for (let i = 0; i < testDids.length; i++) {
                const did = testDids[i];
                const callRecord = {
                    tenantId: new mongoose.Types.ObjectId(tenantId),
                    didId: did._id,
                    campaignId: 'TEST001',
                    agentId: '1001',
                    customerPhone: '+1415555' + String(1000 + i).padStart(4, '0'),
                    callDate: new Date(now.getTime() - (i * 60000)), // Each call 1 minute apart
                    duration: Math.floor(Math.random() * 300) + 30, // 30-330 seconds
                    status: 'completed',
                    direction: 'outbound'
                };
                callsToCreate.push(callRecord);
            }

            // Insert the test call records
            const insertResult = await CallRecord.insertMany(callsToCreate);
            console.log(`Created ${insertResult.length} test call records`);

            // Update the DIDs with usage counts
            for (let did of testDids) {
                await DID.updateOne(
                    { _id: did._id },
                    {
                        $inc: {
                            usageCount: 1,
                            dailyUsageCount: 1
                        },
                        $set: {
                            lastUsed: now,
                            status: 'active',
                            isActive: true
                        }
                    }
                );
            }
            console.log('Updated DID usage counts and status');
        }

        // Check tenant
        const Tenant = mongoose.model('Tenant', new mongoose.Schema({
            name: String,
            isActive: Boolean,
            settings: Object,
            rotationState: Object
        }));

        const tenant = await Tenant.findById(tenantId);
        if (tenant) {
            console.log('\n=== Tenant Info ===');
            console.log('Name:', tenant.name);
            console.log('Active:', tenant.isActive);
            console.log('Rotation State:', tenant.rotationState);
        }

        // Final check after updates
        console.log('\n=== Final Statistics After Updates ===');
        const finalActiveDids = await DID.countDocuments({ status: 'active', tenantId: tenantId });
        const finalTodayCalls = await CallRecord.countDocuments({
            callDate: { $gte: todayStart },
            tenantId: tenantId
        });

        console.log('Active DIDs for tenant:', finalActiveDids);
        console.log('Calls today for tenant:', finalTodayCalls);

        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    }
}

checkDashboardData();