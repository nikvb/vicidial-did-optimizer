import mongoose from 'mongoose';

const VICIdialSettingSchema = new mongoose.Schema({
  hostname: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    // Note: Password stored in plain text because VICIdial API requires it
    // This is acceptable as VICIdial credentials are API-only and not user passwords
  },
});

const VICIdialSetting = mongoose.model('VICIdialSetting', VICIdialSettingSchema);

export default VICIdialSetting;
