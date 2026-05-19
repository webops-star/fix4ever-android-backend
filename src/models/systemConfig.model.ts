import mongoose, { Document, Schema } from 'mongoose';

export interface ISystemConfig extends Document {
  key: string;
  value: any;
  description?: string;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemConfigStatics {
  // Static helper to get a config value with a fallback default
  getValue(key: string, defaultValue: any): Promise<any>;
  // Static helper to set a config value (upsert)
  setValue(key: string, value: any, updatedBy?: string): Promise<any>;
}

export type SystemConfigModel = mongoose.Model<ISystemConfig> & SystemConfigStatics;

const systemConfigSchema = new Schema<ISystemConfig, SystemConfigModel>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
    description: { type: String },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

// Static helper to get a config value with a fallback default
systemConfigSchema.statics.getValue = async function (
  this: SystemConfigModel,
  key: string,
  defaultValue: any
) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaultValue;
};

// Static helper to set a config value (upsert)
systemConfigSchema.statics.setValue = async function (
  this: SystemConfigModel,
  key: string,
  value: any,
  updatedBy?: string
) {
  return this.findOneAndUpdate(
    { key },
    { key, value, ...(updatedBy ? { updatedBy } : {}) },
    { upsert: true, new: true }
  );
};

export const DEFAULT_REFERRAL_CONFIG = {
  referral_reward_referrer: 25,
  referral_reward_referee: 20,
  referral_velocity_cap: 10,
  referral_attribution_window_days: 30,
  referral_program_enabled: true,
  wallet_usage_cap_per_order: 50,
  wallet_balance_expiry_days: 365,
} as const;

export default mongoose.model<ISystemConfig, SystemConfigModel>('SystemConfig', systemConfigSchema);
