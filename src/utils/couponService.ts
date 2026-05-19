import mongoose from 'mongoose';
import Coupon from '../models/coupon.model';
import CouponUsage from '../models/couponUsage.model';
import { checkCouponFraud } from './fraudService';

export interface CouponValidationResult {
  valid: boolean;
  discountAmount?: number;
  coupon?: any;
  error?: string;
}

/**
 * Validate a coupon code at checkout time.
 * Returns the discount amount if valid.
 */
export const validateCoupon = async (
  code: string,
  userId: string,
  orderValue: number,
  serviceCategory?: string
): Promise<CouponValidationResult> => {
  try {
    const coupon = await Coupon.findOne({ code: code.toUpperCase(), status: 'ACTIVE' });

    if (!coupon) return { valid: false, error: 'Invalid or inactive coupon code' };

    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validTill) {
      return { valid: false, error: 'Coupon has expired or is not yet active' };
    }

    if (orderValue < coupon.minOrderValue) {
      return {
        valid: false,
        error: `Minimum order value of ₹${coupon.minOrderValue} required for this coupon`,
      };
    }

    // Usage limit check
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return { valid: false, error: 'Coupon usage limit has been reached' };
    }

    // Budget cap check
    if (coupon.budgetCap !== null && coupon.budgetUsed >= coupon.budgetCap) {
      return { valid: false, error: 'Coupon budget has been exhausted' };
    }

    // Category check (empty = all categories)
    if (
      coupon.applicableCategories.length > 0 &&
      serviceCategory &&
      !coupon.applicableCategories.includes(serviceCategory)
    ) {
      return { valid: false, error: 'Coupon is not applicable for this service category' };
    }

    // Per-user usage limit
    const userUsageCount = await CouponUsage.countDocuments({
      couponId: coupon._id,
      userId,
      status: { $in: ['APPLIED', 'REDEEMED'] },
    });
    if (userUsageCount >= coupon.perUserLimit) {
      return { valid: false, error: 'You have already used this coupon' };
    }

    // Fraud check
    const fraudResult = await checkCouponFraud(userId, code);
    if (!fraudResult.passed) {
      return { valid: false, error: 'Coupon cannot be applied at this time' };
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === 'FLAT') {
      discountAmount = Math.min(coupon.discountValue, orderValue);
    } else {
      // PERCENT
      discountAmount = (orderValue * coupon.discountValue) / 100;
      if (coupon.maxDiscount !== null) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      }
    }
    discountAmount = Math.round(discountAmount * 100) / 100;

    return { valid: true, discountAmount, coupon };
  } catch (error: any) {
    console.error('validateCoupon error:', error);
    return { valid: false, error: 'Failed to validate coupon' };
  }
};

/**
 * Record coupon as APPLIED (before payment). Does NOT increment usedCount yet.
 */
export const applyCoupon = async (
  couponId: string,
  userId: string,
  serviceRequestId: string,
  discountAmount: number
): Promise<{ success: boolean; usageId?: string; error?: string }> => {
  try {
    // Cancel any previous APPLIED usage for the same service request
    await CouponUsage.updateMany(
      { userId, serviceRequestId, status: 'APPLIED' },
      { status: 'CANCELLED' }
    );

    const usage = await CouponUsage.create({
      couponId,
      userId,
      serviceRequestId,
      status: 'APPLIED',
      discountAmount,
      appliedAt: new Date(),
    });

    return { success: true, usageId: usage._id.toString() };
  } catch (error: any) {
    console.error('applyCoupon error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark coupon as REDEEMED after payment completes. Increments counters.
 */
export const markCouponUsed = async (couponUsageId: string): Promise<void> => {
  try {
    const usage = await CouponUsage.findById(couponUsageId).populate('couponId');
    if (!usage || usage.status === 'REDEEMED') return;

    usage.status = 'REDEEMED';
    usage.redeemedAt = new Date();
    await usage.save();

    // Increment coupon counters
    await Coupon.findByIdAndUpdate(usage.couponId, {
      $inc: { usedCount: 1, budgetUsed: usage.discountAmount },
    });

    // Auto-disable coupon if budget or usage limit exhausted
    const coupon = await Coupon.findById(usage.couponId);
    if (coupon) {
      const budgetExhausted = coupon.budgetCap !== null && coupon.budgetUsed >= coupon.budgetCap;
      const usageLimitReached = coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit;
      if (budgetExhausted || usageLimitReached) {
        coupon.status = 'DISABLED';
        await coupon.save();
      }
    }
  } catch (error: any) {
    console.error('markCouponUsed error:', error);
  }
};

/**
 * Get all coupons available to a user (active, not expired, not already used per-limit).
 */
export const getAvailableCouponsForUser = async (userId: string) => {
  const now = new Date();
  const activeCoupons = await Coupon.find({
    status: 'ACTIVE',
    validFrom: { $lte: now },
    validTill: { $gte: now },
  }).select('-createdBy');

  // Filter out coupons the user has already used up to their per-user limit
  const result = [];
  for (const coupon of activeCoupons) {
    const usage = await CouponUsage.countDocuments({
      couponId: coupon._id,
      userId,
      status: { $in: ['APPLIED', 'REDEEMED'] },
    });
    if (usage < coupon.perUserLimit) {
      result.push(coupon);
    }
  }
  return result;
};

/**
 * Get coupon usage history for a user.
 */
export const getUserCouponHistory = async (userId: string) => {
  return CouponUsage.find({ userId })
    .populate('couponId', 'code type discountType discountValue description')
    .populate('serviceRequestId', 'request_id brand model status')
    .sort({ createdAt: -1 });
};
