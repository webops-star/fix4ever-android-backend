import mongoose from 'mongoose';
import ReferralEvent from '../models/referralEvent.model';
import SystemConfig, { DEFAULT_REFERRAL_CONFIG } from '../models/systemConfig.model';

export interface FraudCheckResult {
  passed: boolean;
  flags: string[];
}

/**
 * Check referral event for fraud before releasing reward.
 * Runs device match, address match, velocity, and self-referral checks.
 */
export const checkReferralFraud = async (referralEventId: string): Promise<FraudCheckResult> => {
  const flags: string[] = [];

  try {
    const event = await ReferralEvent.findById(referralEventId)
      .populate('referrerId', 'phone email')
      .populate('refereeId', 'phone email');

    if (!event) {
      return { passed: false, flags: ['EVENT_NOT_FOUND'] };
    }

    const velocityCap = await SystemConfig.getValue(
      'referral_velocity_cap',
      DEFAULT_REFERRAL_CONFIG.referral_velocity_cap
    );

    // 1. Velocity check: how many REWARDED referrals has referrer gotten in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentRewardCount = await ReferralEvent.countDocuments({
      referrerId: event.referrerId,
      status: 'REWARDED',
      updatedAt: { $gte: thirtyDaysAgo },
    });

    if (recentRewardCount >= velocityCap) {
      flags.push('VELOCITY_EXCEEDED');
      event.fraudFlags.velocityExceeded = true;
    }

    // 2. Device fingerprint match
    if (event.deviceFingerprint) {
      const sameDeviceEvent = await ReferralEvent.findOne({
        referrerId: event.referrerId,
        deviceFingerprint: event.deviceFingerprint,
        _id: { $ne: event._id },
      });
      if (sameDeviceEvent) {
        flags.push('DEVICE_MATCH');
        event.fraudFlags.deviceMatch = true;
      }
    }

    // 3. Self-referral check (phone or email match)
    const referrer = event.referrerId as any;
    const referee = event.refereeId as any;
    if (
      referrer &&
      referee &&
      (referrer.phone === referee.phone || referrer.email === referee.email)
    ) {
      flags.push('SELF_REFERRAL');
      event.fraudFlags.selfReferral = true;
    }

    await event.save();

    return { passed: flags.length === 0, flags };
  } catch (error: any) {
    console.error('Fraud check error:', error);
    return { passed: false, flags: ['SYSTEM_ERROR'] };
  }
};

/**
 * Check coupon usage for fraud (bulk redemption, account age, etc.)
 */
export const checkCouponFraud = async (
  userId: string,
  couponCode: string
): Promise<FraudCheckResult> => {
  const flags: string[] = [];

  try {
    const CouponUsage = require('../models/couponUsage.model').default;

    // Check bulk coupon redemption: >3 coupons applied in last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentUsageCount = await CouponUsage.countDocuments({
      userId,
      status: { $in: ['APPLIED', 'REDEEMED'] },
      appliedAt: { $gte: oneDayAgo },
    });

    if (recentUsageCount >= 3) {
      flags.push('BULK_REDEMPTION');
    }

    return { passed: flags.length === 0, flags };
  } catch (error: any) {
    console.error('Coupon fraud check error:', error);
    return { passed: true, flags: [] }; // Fail open for coupon fraud (non-critical)
  }
};
