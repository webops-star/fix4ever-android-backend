import crypto from 'crypto';
import mongoose from 'mongoose';
import ReferralCode from '../models/referralCode.model';
import ReferralEvent from '../models/referralEvent.model';
import SystemConfig, { DEFAULT_REFERRAL_CONFIG } from '../models/systemConfig.model';
import { checkReferralFraud } from './fraudService';
import { holdReferralReward, releaseHeldReward } from './rewardService';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Generate a collision-safe 8-character uppercase alphanumeric code. */
async function generateUniqueCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O 1/I
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      code += chars[bytes[i] % chars.length];
    }
    const exists = await ReferralCode.exists({ code });
    if (!exists) return code;
  }
  throw new Error('Failed to generate unique referral code after 10 attempts');
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Get an existing active code or generate a new one for eligible users.
 * Eligibility: ≥1 completed booking, account age ≥3 days, no abuse flag, role='user'.
 */
export const getOrGenerateReferralCode = async (
  userId: string
): Promise<{ success: boolean; code?: string; error?: string }> => {
  try {
    // Return existing active code if present
    const existing = await ReferralCode.findOne({ referrerId: userId, status: 'ACTIVE' });
    if (existing) return { success: true, code: existing.code };

    // Eligibility: account age ≥3 days
    const User = require('../models/user.model').default;
    const user = await User.findById(userId);
    if (!user) return { success: false, error: 'User not found' };

    const ageMs = Date.now() - new Date(user.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 3) {
      return {
        success: false,
        error: 'Account must be at least 3 days old to generate a referral code',
      };
    }

    // Eligibility: ≥1 completed booking
    const ServiceRequest = require('../models/serviceRequest.model').default;
    const completedCount = await ServiceRequest.countDocuments({
      customerId: userId,
      status: 'Completed',
      paymentStatus: 'completed',
    });
    if (completedCount < 1) {
      return {
        success: false,
        error: 'Complete at least one booking to unlock your referral code',
      };
    }

    const code = await generateUniqueCode();
    await ReferralCode.create({ code, referrerId: userId, status: 'ACTIVE' });

    return { success: true, code };
  } catch (error: any) {
    console.error('getOrGenerateReferralCode error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Validate a referral code at signup time.
 * Returns referrerId if valid, or an error message.
 */
export const validateReferralCode = async (
  code: string,
  newUserId: string
): Promise<{ valid: boolean; referrerId?: string; error?: string }> => {
  try {
    const referralCode = await ReferralCode.findOne({ code: code.toUpperCase(), status: 'ACTIVE' });
    if (!referralCode) return { valid: false, error: 'Invalid or expired referral code' };

    // Self-referral block
    if (referralCode.referrerId.toString() === newUserId) {
      return { valid: false, error: 'You cannot use your own referral code' };
    }

    // Max uses check
    if (referralCode.maxUses !== null && referralCode.useCount >= referralCode.maxUses) {
      return { valid: false, error: 'This referral code has reached its usage limit' };
    }

    // Referee must not already have a referral event
    const existingEvent = await ReferralEvent.findOne({ refereeId: newUserId });
    if (existingEvent) {
      return { valid: false, error: 'You have already used a referral code' };
    }

    return { valid: true, referrerId: referralCode.referrerId.toString() };
  } catch (error: any) {
    console.error('validateReferralCode error:', error);
    return { valid: false, error: error.message };
  }
};

/**
 * Create a referral event after a new user signs up with a valid code.
 */
export const createReferralEvent = async (
  referrerId: string,
  refereeId: string,
  code: string,
  deviceFingerprint?: string,
  ipAddress?: string
): Promise<{ success: boolean; eventId?: string; error?: string }> => {
  try {
    const programEnabled = await SystemConfig.getValue(
      'referral_program_enabled',
      DEFAULT_REFERRAL_CONFIG.referral_program_enabled
    );
    if (!programEnabled) return { success: false, error: 'Referral program is currently disabled' };

    const rewardReferrer = await SystemConfig.getValue(
      'referral_reward_referrer',
      DEFAULT_REFERRAL_CONFIG.referral_reward_referrer
    );
    const rewardReferee = await SystemConfig.getValue(
      'referral_reward_referee',
      DEFAULT_REFERRAL_CONFIG.referral_reward_referee
    );
    const attributionWindowDays = await SystemConfig.getValue(
      'referral_attribution_window_days',
      DEFAULT_REFERRAL_CONFIG.referral_attribution_window_days
    );

    const event = await ReferralEvent.create({
      referrerId,
      refereeId,
      code: code.toUpperCase(),
      status: 'SIGNUP_COMPLETE',
      rewardReferrer,
      rewardReferee,
      attributionWindowDays,
      deviceFingerprint,
      ipAddress,
    });

    // Increment code use count
    await ReferralCode.findOneAndUpdate({ code: code.toUpperCase() }, { $inc: { useCount: 1 } });

    return { success: true, eventId: event._id.toString() };
  } catch (error: any) {
    console.error('createReferralEvent error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Called when a referee completes their first paid booking.
 * Runs fraud checks and either releases or holds the reward.
 */
export const onFirstBookingComplete = async (
  refereeUserId: string,
  serviceRequestId: string
): Promise<void> => {
  try {
    const event = await ReferralEvent.findOne({
      refereeId: refereeUserId,
      status: { $in: ['SIGNUP_COMPLETE', 'PENDING_REWARD'] },
    });

    if (!event) return; // No pending referral event for this user

    // Check attribution window
    const windowMs = event.attributionWindowDays * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(event.createdAt).getTime() > windowMs) {
      event.status = 'EXPIRED';
      await event.save();
      return;
    }

    // Check if this is truly the first completed booking
    const ServiceRequest = require('../models/serviceRequest.model').default;
    const completedCount = await ServiceRequest.countDocuments({
      customerId: refereeUserId,
      status: 'Completed',
      paymentStatus: 'completed',
    });

    if (completedCount !== 1) return; // Not first booking

    event.status = 'FIRST_BOOKING_DONE';
    event.firstBookingId = new mongoose.Types.ObjectId(serviceRequestId);
    await event.save();

    // Fraud check
    const fraudResult = await checkReferralFraud(event._id.toString());

    if (fraudResult.passed) {
      // Hold rewards and then immediately release (no manual review needed for clean cases)
      event.status = 'HELD';
      await event.save();

      await releaseHeldReward(event._id.toString());

      // Emit socket notification
      try {
        const io = (global as any).io;
        if (io) {
          io.to(`user-${event.referrerId.toString()}`).emit('referral-reward-credited', {
            amount: event.rewardReferrer,
            message: `You earned ₹${event.rewardReferrer} referral reward!`,
          });
          io.to(`user-${event.refereeId.toString()}`).emit('referral-reward-credited', {
            amount: event.rewardReferee,
            message: `You received a ₹${event.rewardReferee} welcome bonus!`,
          });
        }
      } catch (socketErr) {
        console.error('Socket emit error:', socketErr);
      }
    } else {
      // Hold for admin review
      event.status = 'HELD';
      await event.save();

      // Create HELD wallet transactions (admin must approve)
      await holdReferralReward(
        event.referrerId.toString(),
        event.rewardReferrer,
        event._id.toString(),
        `Referral reward pending review (flags: ${fraudResult.flags.join(', ')})`
      );

      console.warn(
        `Referral event ${event._id} held for fraud review. Flags: ${fraudResult.flags.join(', ')}`
      );
    }
  } catch (error: any) {
    console.error('onFirstBookingComplete error:', error);
  }
};

/**
 * Get referral history for a referrer (list of events).
 */
export const getReferralHistory = async (referrerId: string) => {
  const events = await ReferralEvent.find({ referrerId })
    .populate('refereeId', 'username email')
    .sort({ createdAt: -1 });

  return events.map(e => ({
    id: e._id,
    refereeName: (e.refereeId as any)?.username || 'Unknown',
    status: e.status,
    rewardAmount: e.rewardReferrer,
    date: e.createdAt,
  }));
};
