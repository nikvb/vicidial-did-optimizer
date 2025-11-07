const mongoose = require('mongoose');

async function fixClientDIDs() {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/did-optimizer');
        console.log('Connected to MongoDB\n');

        // Define schemas
        const userSchema = new mongoose.Schema({
            email: String,
            tenantId: mongoose.Schema.Types.ObjectId,
            tenant: mongoose.Schema.Types.ObjectId
        });

        const tenantSchema = new mongoose.Schema({
            name: String,
            isActive: Boolean
        });

        const didSchema = new mongoose.Schema({
            tenantId: mongoose.Schema.Types.ObjectId,
            phoneNumber: String,
            status: String,
            isActive: Boolean,
            provider: String,
            state: String,
            areaCode: String,
            reputation: Number
        });

        const User = mongoose.model('User', userSchema);
        const Tenant = mongoose.model('Tenant', tenantSchema);
        const DID = mongoose.model('DID', didSchema);

        // Find the user
        const email = 'client@test3.com';
        console.log(`Looking for user: ${email}`);

        const user = await User.findOne({ email: email });

        if (!user) {
            console.log(`❌ User ${email} not found!`);
            await mongoose.connection.close();
            return;
        }

        console.log(`✅ Found user: ${email}`);
        console.log(`   User ID: ${user._id}`);
        console.log(`   Tenant ID: ${user.tenantId || user.tenant || 'NOT SET'}`);

        // Get the tenant ID
        const tenantId = user.tenantId || user.tenant;

        if (!tenantId) {
            console.log('\n❌ User has no tenant assigned!');

            // Try to find or create a tenant for this user
            let tenant = await Tenant.findOne({ name: /test3/i });

            if (!tenant) {
                console.log('Creating new tenant for client@test3.com...');
                tenant = new Tenant({
                    name: "Test3 Organization",
                    isActive: true,
                    domain: 'test3.com',
                    apiKeys: [{
                        key: 'did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e',
                        name: 'Default API Key',
                        permissions: ['read', 'write'],
                        isActive: true,
                        createdAt: new Date()
                    }]
                });
                await tenant.save();
                console.log(`✅ Created tenant: ${tenant._id}`);
            }

            // Update user with tenant
            user.tenantId = tenant._id;
            user.tenant = tenant._id;
            await user.save();
            console.log(`✅ Updated user with tenant ID: ${tenant._id}`);
        }

        const finalTenantId = user.tenantId || user.tenant;

        // Check DIDs for this tenant
        console.log(`\n📊 Checking DIDs for tenant: ${finalTenantId}`);

        const totalDids = await DID.countDocuments({ tenantId: finalTenantId });
        const activeDids = await DID.countDocuments({
            tenantId: finalTenantId,
            status: 'active'
        });
        const isActiveTrueDids = await DID.countDocuments({
            tenantId: finalTenantId,
            isActive: true
        });

        console.log(`   Total DIDs: ${totalDids}`);
        console.log(`   Status='active': ${activeDids}`);
        console.log(`   isActive=true: ${isActiveTrueDids}`);

        if (totalDids === 0) {
            console.log('\n⚠️  No DIDs found for this tenant!');

            // Check if there are any unassigned DIDs we can assign
            const unassignedDids = await DID.find({
                $or: [
                    { tenantId: null },
                    { tenantId: { $exists: false } }
                ]
            }).limit(500);

            if (unassignedDids.length > 0) {
                console.log(`Found ${unassignedDids.length} unassigned DIDs. Assigning them to tenant...`);

                const updateResult = await DID.updateMany(
                    {
                        _id: { $in: unassignedDids.map(d => d._id) }
                    },
                    {
                        $set: {
                            tenantId: finalTenantId,
                            status: 'active',
                            isActive: true,
                            reputation: 85
                        }
                    }
                );

                console.log(`✅ Assigned ${updateResult.modifiedCount} DIDs to tenant`);
            } else {
                console.log('\nNo unassigned DIDs found. Creating sample DIDs...');

                // Create sample DIDs
                const didsToCreate = [];
                for (let i = 0; i < 10; i++) {
                    didsToCreate.push({
                        tenantId: finalTenantId,
                        phoneNumber: `+1415555${String(2000 + i).padStart(4, '0')}`,
                        provider: 'Telnyx',
                        state: 'CA',
                        areaCode: '415',
                        status: 'active',
                        isActive: true,
                        reputation: 85,
                        monthlyCost: 1.00,
                        perMinuteCost: 0.009
                    });
                }

                await DID.insertMany(didsToCreate);
                console.log(`✅ Created ${didsToCreate.length} sample DIDs`);
            }
        } else {
            // DIDs exist but might not be active
            if (activeDids === 0) {
                console.log('\n⚠️  DIDs exist but none are active. Activating them...');

                const updateResult = await DID.updateMany(
                    { tenantId: finalTenantId },
                    {
                        $set: {
                            status: 'active',
                            isActive: true,
                            reputation: 85
                        }
                    }
                );

                console.log(`✅ Activated ${updateResult.modifiedCount} DIDs`);
            }
        }

        // Final check
        console.log('\n=== FINAL STATUS ===');
        const finalTotal = await DID.countDocuments({ tenantId: finalTenantId });
        const finalActive = await DID.countDocuments({
            tenantId: finalTenantId,
            status: 'active',
            isActive: true
        });

        console.log(`Total DIDs for ${email}: ${finalTotal}`);
        console.log(`Active DIDs for ${email}: ${finalActive}`);

        // Sample some DIDs
        const sampleDids = await DID.find({ tenantId: finalTenantId }).limit(5);
        console.log('\nSample DIDs:');
        sampleDids.forEach(did => {
            console.log(`  ${did.phoneNumber} - Status: ${did.status}, Active: ${did.isActive}`);
        });

        // Check tenant details
        const tenant = await Tenant.findById(finalTenantId);
        if (tenant) {
            console.log('\n=== TENANT INFO ===');
            console.log(`Name: ${tenant.name}`);
            console.log(`Active: ${tenant.isActive}`);
            console.log(`ID: ${tenant._id}`);
        }

        await mongoose.connection.close();
        console.log('\n✅ Database connection closed');
        console.log('\n📌 Dashboard should now show the DIDs for client@test3.com');

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    }
}

fixClientDIDs();