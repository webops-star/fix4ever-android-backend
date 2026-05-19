import mongoose, { Document, Schema } from 'mongoose';

export interface IReferralCode extends Document {
  code: string;
  referrerId: mongoose.Types.ObjectId;
  status: 'ACTIVE' | 'DISABLED';
  useCount: number;
  maxUses: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const referralCodeSchema = new Schema<IReferralCode>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    referrerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'DISABLED'],
      default: 'ACTIVE',
    },
    useCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxUses: {
      type: Number,
      default: null, // null = unlimited
    },
  },
  { timestamps: true }
);

referralCodeSchema.index({ referrerId: 1, status: 1 });

export default mongoose.model<IReferralCode>('ReferralCode', referralCodeSchema);
