import mongoose, { Document, Schema } from 'mongoose';

export type CouponType = 'REFERRAL' | 'ADMIN' | 'LOYALTY' | 'WINBACK' | 'CATEGORY' | 'B2B';
export type DiscountType = 'FLAT' | 'PERCENT';
export type CouponStatus = 'CREATED' | 'ACTIVE' | 'DISABLED' | 'EXPIRED';

export interface ICoupon extends Document {
  code: string;
  type: CouponType;
  discountType: DiscountType;
  discountValue: number;
  minOrderValue: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  applicableCategories: string[];
  validFrom: Date;
  validTill: Date;
  status: CouponStatus;
  createdBy?: mongoose.Types.ObjectId;
  budgetCap: number | null;
  budgetUsed: number;
  description?: string;
  targetSegment?: 'all' | 'new_users' | 'existing' | 'lapsed';
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['REFERRAL', 'ADMIN', 'LOYALTY', 'WINBACK', 'CATEGORY', 'B2B'],
      required: true,
    },
    discountType: {
      type: String,
      enum: ['FLAT', 'PERCENT'],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    minOrderValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxDiscount: {
      type: Number,
      default: null, // null = no cap on discount (relevant for PERCENT type)
    },
    usageLimit: {
      type: Number,
      default: null, // null = unlimited
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    perUserLimit: {
      type: Number,
      default: 1,
      min: 1,
    },
    applicableCategories: {
      type: [String],
      default: [], // empty = all categories
    },
    validFrom: {
      type: Date,
      required: true,
    },
    validTill: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['CREATED', 'ACTIVE', 'DISABLED', 'EXPIRED'],
      default: 'CREATED',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    budgetCap: {
      type: Number,
      default: null, // null = no budget cap
    },
    budgetUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: { type: String },
    targetSegment: {
      type: String,
      enum: ['all', 'new_users', 'existing', 'lapsed'],
      default: 'all',
    },
  },
  { timestamps: true }
);

couponSchema.index({ status: 1, validTill: 1 });
couponSchema.index({ type: 1, status: 1 });

export default mongoose.model<ICoupon>('Coupon', couponSchema);
