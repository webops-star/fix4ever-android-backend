import mongoose, { Document, Schema } from 'mongoose';

export type ReferralEventStatus =
  | 'SIGNUP_COMPLETE'
  | 'PENDING_REWARD'
  | 'FIRST_BOOKING_DONE'
  | 'HELD'
  | 'REWARDED'
  | 'BLOCKED'
  | 'EXPIRED';

export interface IReferralEvent extends Document {
  referrerId: mongoose.Types.ObjectId;
  refereeId: mongoose.Types.ObjectId;
  code: string;
  status: ReferralEventStatus;
  rewardReferrer: number;
  rewardReferee: number;
  firstBookingId?: mongoose.Types.ObjectId;
  fraudFlags: {
    deviceMatch: boolean;
    addressMatch: boolean;
    velocityExceeded: boolean;
    selfReferral: boolean;
    manualBlock: boolean;
  };
  deviceFingerprint?: string;
  ipAddress?: string;
  attributionWindowDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const referralEventSchema = new Schema<IReferralEvent>(
  {
    referrerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refereeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // one referee can only be referred once
      index: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: [
        'SIGNUP_COMPLETE',
        'PENDING_REWARD',
        'FIRST_BOOKING_DONE',
        'HELD',
        'REWARDED',
        'BLOCKED',
        'EXPIRED',
      ],
      default: 'SIGNUP_COMPLETE',
    },
    rewardReferrer: {
      type: Number,
      default: 0,
    },
    rewardReferee: {
      type: Number,
      default: 0,
    },
    firstBookingId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
    },
    fraudFlags: {
      deviceMatch: { type: Boolean, default: false },
      addressMatch: { type: Boolean, default: false },
      velocityExceeded: { type: Boolean, default: false },
      selfReferral: { type: Boolean, default: false },
      manualBlock: { type: Boolean, default: false },
    },
    deviceFingerprint: { type: String },
    ipAddress: { type: String },
    attributionWindowDays: { type: Number, default: 30 },
  },
  { timestamps: true }
);

referralEventSchema.index({ referrerId: 1, status: 1, createdAt: -1 });
referralEventSchema.index({ code: 1 });

export default mongoose.model<IReferralEvent>('ReferralEvent', referralEventSchema);
