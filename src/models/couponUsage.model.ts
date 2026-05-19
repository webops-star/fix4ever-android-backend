import mongoose, { Document, Schema } from 'mongoose';

export type CouponUsageStatus = 'APPLIED' | 'REDEEMED' | 'FAILED' | 'CANCELLED';

export interface ICouponUsage extends Document {
  couponId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  serviceRequestId?: mongoose.Types.ObjectId;
  status: CouponUsageStatus;
  discountAmount: number;
  appliedAt: Date;
  redeemedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const couponUsageSchema = new Schema<ICouponUsage>(
  {
    couponId: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    serviceRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
    },
    status: {
      type: String,
      enum: ['APPLIED', 'REDEEMED', 'FAILED', 'CANCELLED'],
      default: 'APPLIED',
    },
    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    redeemedAt: { type: Date },
  },
  { timestamps: true }
);

couponUsageSchema.index({ couponId: 1, userId: 1 });
couponUsageSchema.index({ serviceRequestId: 1 });

export default mongoose.model<ICouponUsage>('CouponUsage', couponUsageSchema);
