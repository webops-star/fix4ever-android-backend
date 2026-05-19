import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  getOrGenerateReferralCode,
  validateReferralCode,
  createReferralEvent,
  getReferralHistory,
} from '../utils/referralService';
import CustomerWallet from '../models/customerWallet.model';
import CustomerWalletTransaction from '../models/customerWalletTransaction.model';

/**
 * GET /api/referral/my-code
 * Returns the user's referral code (generating one if eligible).
 */
export const getMyReferralCode = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await getOrGenerateReferralCode(userId);

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }

    // Also return wallet balance
    const wallet = await CustomerWallet.findOne({ userId });

    return res.json({
      success: true,
      data: {
        code: result.code,
        shareUrl: `${process.env.FRONTEND_URL || 'https://fix4ever.com'}/auth/signup?ref=${result.code}`,
        walletBalance: wallet?.balance ?? 0,
      },
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to get referral code', error: error.message });
  }
};

/**
 * GET /api/referral/history
 * Returns list of referral events initiated by the user.
 */
export const getReferralHistoryController = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const history = await getReferralHistory(userId);
    const totalEarned = history
      .filter(h => h.status === 'REWARDED')
      .reduce((sum, h) => sum + h.rewardAmount, 0);

    return res.json({ success: true, data: { history, totalEarned } });
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to get history', error: error.message });
  }
};

/**
 * GET /api/referral/wallet
 * Returns customer wallet balance and recent transactions.
 */
export const getCustomerWallet = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const wallet = await CustomerWallet.findOne({ userId });
    const transactions = await CustomerWalletTransaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({
      success: true,
      data: {
        balance: wallet?.balance ?? 0,
        totalEarned: wallet?.totalEarned ?? 0,
        totalUsed: wallet?.totalUsed ?? 0,
        transactions,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to get wallet', error: error.message });
  }
};
