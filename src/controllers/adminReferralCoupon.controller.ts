import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import ReferralEvent from '../models/referralEvent.model';
import ReferralCode from '../models/referralCode.model';
import Coupon from '../models/coupon.model';
import CouponUsage from '../models/couponUsage.model';
import SystemConfig, { DEFAULT_REFERRAL_CONFIG } from '../models/systemConfig.model';
import { releaseHeldReward, voidReward } from '../utils/rewardService';
import mongoose from 'mongoose';

// ── REFERRAL CONFIG ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/referral/config
 */
export const getReferralConfig = async (req: AuthRequest, res: Response) => {
  try {
    const keys = Object.keys(DEFAULT_REFERRAL_CONFIG);
    const configs: Record<string, any> = {};
    for (const key of keys) {
      configs[key] = await SystemConfig.getValue(key, (DEFAULT_REFERRAL_CONFIG as any)[key]);
    }
    res.json({ success: true, data: configs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/admin/referral/config
 * Body: { referral_reward_referrer, referral_reward_referee, referral_velocity_cap, ... }
 */
export const updateReferralConfig = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user?.userId;
    const updates = req.body;
    const allowedKeys = Object.keys(DEFAULT_REFERRAL_CONFIG);

    for (const key of Object.keys(updates)) {
      if (allowedKeys.includes(key)) {
        await SystemConfig.setValue(key, updates[key], adminId);
      }
    }

    res.json({ success: true, message: 'Referral config updated' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── FRAUD QUEUE ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/referral/fraud-queue
 * Returns all HELD referral events for admin review.
 */
export const getFraudQueue = async (req: AuthRequest, res: Response) => {
  try {
    const events = await ReferralEvent.find({ status: 'HELD' })
      .populate('referrerId', 'username email phone')
      .populate('refereeId', 'username email phone')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: events });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/admin/referral/release/:id
 * Approve a held referral event and release the reward.
 */
export const approveHeldReward = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await releaseHeldReward(id);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }

    // Emit socket notification
    try {
      const event = await ReferralEvent.findById(id);
      if (event) {
        const io = (global as any).io;
        if (io) {
          io.to(`user-${event.referrerId.toString()}`).emit('referral-reward-credited', {
            amount: event.rewardReferrer,
            message: `Your referral reward of ₹${event.rewardReferrer} has been approved!`,
          });
        }
      }
    } catch (_) {}

    res.json({ success: true, message: 'Reward released and wallets credited' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/admin/referral/block/:id
 * Reject a held referral event and void the reward.
 */
export const blockHeldReward = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await voidReward(id);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    res.json({ success: true, message: 'Reward voided. Event marked as BLOCKED.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── REFERRAL ANALYTICS ────────────────────────────────────────────────────────

/**
 * GET /api/admin/referral/analytics
 */
export const getReferralAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const [signupComplete, pendingReward, firstBookingDone, held, rewarded, blocked, expired] =
      await Promise.all([
        ReferralEvent.countDocuments({ status: 'SIGNUP_COMPLETE' }),
        ReferralEvent.countDocuments({ status: 'PENDING_REWARD' }),
        ReferralEvent.countDocuments({ status: 'FIRST_BOOKING_DONE' }),
        ReferralEvent.countDocuments({ status: 'HELD' }),
        ReferralEvent.countDocuments({ status: 'REWARDED' }),
        ReferralEvent.countDocuments({ status: 'BLOCKED' }),
        ReferralEvent.countDocuments({ status: 'EXPIRED' }),
      ]);

    const payoutAgg = await ReferralEvent.aggregate([
      { $match: { status: 'REWARDED' } },
      {
        $group: {
          _id: null,
          totalReferrer: { $sum: '$rewardReferrer' },
          totalReferee: { $sum: '$rewardReferee' },
        },
      },
    ]);
    const totalPayoutReferrer = payoutAgg[0]?.totalReferrer ?? 0;
    const totalPayoutReferee = payoutAgg[0]?.totalReferee ?? 0;

    const topReferrers = await ReferralEvent.aggregate([
      { $match: { status: 'REWARDED' } },
      { $group: { _id: '$referrerId', count: { $sum: 1 }, earned: { $sum: '$rewardReferrer' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          referrerId: '$_id',
          username: '$user.username',
          email: '$user.email',
          count: 1,
          earned: 1,
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        funnel: {
          signupComplete,
          pendingReward,
          firstBookingDone,
          held,
          rewarded,
          blocked,
          expired,
        },
        totalPayoutReferrer,
        totalPayoutReferee,
        topReferrers,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── COUPON MANAGEMENT ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/coupon/list
 */
export const listCoupons = async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [coupons, total] = await Promise.all([
      Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Coupon.countDocuments(filter),
    ]);

    res.json({ success: true, data: { coupons, total, page: Number(page), limit: Number(limit) } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/admin/coupon/create
 */
export const createCoupon = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user?.userId;
    const {
      code,
      type,
      discountType,
      discountValue,
      minOrderValue,
      maxDiscount,
      usageLimit,
      perUserLimit,
      applicableCategories,
      validFrom,
      validTill,
      budgetCap,
      description,
      targetSegment,
    } = req.body;

    if (
      !code ||
      !type ||
      !discountType ||
      discountValue === undefined ||
      !validFrom ||
      !validTill
    ) {
      return res.status(400).json({
        success: false,
        message: 'code, type, discountType, discountValue, validFrom, validTill are required',
      });
    }

    const coupon = await Coupon.create({
      code: code.toUpperCase(),
      type,
      discountType,
      discountValue: Number(discountValue),
      minOrderValue: Number(minOrderValue) || 0,
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      usageLimit: usageLimit ? Number(usageLimit) : null,
      perUserLimit: Number(perUserLimit) || 1,
      applicableCategories: applicableCategories || [],
      validFrom: new Date(validFrom),
      validTill: new Date(validTill),
      status: 'ACTIVE',
      createdBy: adminId,
      budgetCap: budgetCap ? Number(budgetCap) : null,
      description,
      targetSegment: targetSegment || 'all',
    });

    res.status(201).json({ success: true, data: coupon });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/admin/coupon/:id/status
 * Body: { status: 'ACTIVE' | 'DISABLED' | 'EXPIRED' }
 */
export const updateCouponStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['ACTIVE', 'DISABLED', 'EXPIRED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const coupon = await Coupon.findByIdAndUpdate(id, { status }, { new: true });
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, data: coupon });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/coupon/:id/usage
 * Returns usage records for a specific coupon.
 */
export const getCouponUsage = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const usage = await CouponUsage.find({ couponId: id })
      .populate('userId', 'username email')
      .populate('serviceRequestId', 'request_id brand model status')
      .sort({ appliedAt: -1 });
    res.json({ success: true, data: usage });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
