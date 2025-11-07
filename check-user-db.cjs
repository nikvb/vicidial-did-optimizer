const mongoose = require('mongoose');

async function checkUserInDB() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/did-optimizer');
    console.log('Connected to MongoDB');

    // Define User schema
    const UserSchema = new mongoose.Schema({
      email: String,
      password: String,
      firstName: String,
      lastName: String,
      role: String,
      isActive: Boolean,
      tenant: String
    });

    const User = mongoose.model('User', UserSchema);

    // Find client@test3.com user
    const user = await User.findOne({ email: 'client@test3.com' });

    if (user) {
      console.log('\nUser found in database:');
      console.log('  ID (raw):', user._id);
      console.log('  ID (toString):', user._id.toString());
      console.log('  Email:', user.email);
      console.log('  First Name:', user.firstName);
      console.log('  Last Name:', user.lastName);
      console.log('  Role:', user.role);
      console.log('  Tenant:', user.tenant);
      console.log('  Is Active:', user.isActive);
      console.log('\n  Full object:', JSON.stringify(user.toObject(), null, 2));
    } else {
      console.log('User client@test3.com not found in database');

      // List all users
      const allUsers = await User.find({});
      console.log('\nAll users in database:');
      allUsers.forEach(u => {
        console.log(`  - ${u.email} (ID: ${u._id}, Tenant: ${u.tenant})`);
      });
    }

    // Check tenant
    const TenantSchema = new mongoose.Schema({
      name: String,
      domain: String,
      isActive: Boolean,
      apiKeys: Array
    });

    const Tenant = mongoose.model('Tenant', TenantSchema);

    if (user && user.tenant) {
      const tenant = await Tenant.findById(user.tenant);
      if (tenant) {
        console.log('\nTenant found:');
        console.log('  ID:', tenant._id);
        console.log('  Name:', tenant.name);
        console.log('  API Keys count:', tenant.apiKeys ? tenant.apiKeys.length : 0);
        if (tenant.apiKeys && tenant.apiKeys.length > 0) {
          console.log('  API Keys:');
          tenant.apiKeys.forEach((key, index) => {
            console.log(`    ${index + 1}. ${key.name}: ${key.key ? key.key.substring(0, 20) + '...' : 'N/A'} (Active: ${key.isActive})`);
          });
        }
      } else {
        console.log('\nTenant not found with ID:', user.tenant);
      }
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUserInDB();