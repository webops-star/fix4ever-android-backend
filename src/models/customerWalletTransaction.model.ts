import mongoose, { Document, Schema } from 'mongoose';

export type CustomerWalletTxType =
  | 'REFERRAL_REWARD'
  | 'COUPON_BENEFIT'
  | 'COUPON_USAGE'
  | 'REFERRAL_BONUS'
  | 'ADJUSTMENT';

export type CustomerWalletTxStatus = 'PENDING' | 'HELD' | 'CREDITED' | 'BLOCKED' | 'EXPIRED';

export interface ICustomerWalletTransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: CustomerWalletTxType;
  status: CustomerWalletTxStatus;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  referralEventId?: mongoose.Types.ObjectId;
  couponUsageId?: mongoose.Types.ObjectId;
  serviceRequestId?: mongoose.Types.ObjectId;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const customerWalletTransactionSchema = new Schema<ICustomerWalletTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['REFERRAL_REWARD', 'COUPON_BENEFIT', 'COUPON_USAGE', 'REFERRAL_BONUS', 'ADJUSTMENT'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'HELD', 'CREDITED', 'BLOCKED', 'EXPIRED'],
      default: 'PENDING',
    },
    amount: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    description: { type: String, required: true },
    referralEventId: {
      type: Schema.Types.ObjectId,
      ref: 'ReferralEvent',
    },
    couponUsageId: {
      type: Schema.Types.ObjectId,
      ref: 'CouponUsage',
    },
    serviceRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
    },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

customerWalletTransactionSchema.index({ userId: 1, createdAt: -1 });
customerWalletTransactionSchema.index({ referralEventId: 1 });
customerWalletTransactionSchema.index({ status: 1 });

export default mongoose.model<ICustomerWalletTransaction>(
  'CustomerWalletTransaction',
  customerWalletTransactionSchema
);
