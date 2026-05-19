import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import CaptainWallet from '../models/captainWallet.model';
import CaptainWalletTransaction from '../models/captainWalletTransaction.model';
import CaptainSettlementRequest from '../models/captainSettlementRequest.model';
import Captain from '../models/captain.model';
import {
  debitCaptainWallet,
  markCaptainSettlementAsPending,
  cancelCaptainSettlementPending,
} from '../utils/captainWalletService';

// ─────────────────────────────────────────────────────────────────────────────
// GET /captain-wallet/balance
// ─────────────────────────────────────────────────────────────────────────────
export const getCaptainWalletBalance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain)
      return res.status(404).json({ success: false, message: 'Captain profile not found' });

    let wallet = await CaptainWallet.findOne({ captainId: captain._id });
    if (!wallet) {
      wallet = await CaptainWallet.create({
        captainId: captain._id,
        balance: 0,
        totalEarned: 0,
        totalWithdrawn: 0,
        pendingSettlement: 0,
        isActive: true,
      });
    }

    const availableBalance = wallet.balance - wallet.pendingSettlement;

    // Bank details from captain onboarding profile
    const bankDetails = captain.bankDetails
      ? {
          accountHolderName: captain.bankDetails.accountHolderName,
          accountNumber: captain.bankDetails.accountNumber,
          ifscCode: captain.bankDetails.ifscCode,
          bankName: captain.bankDetails.bankName,
          branchName: captain.bankDetails.branchName,
          accountType: captain.bankDetails.accountType,
        }
      : undefined;

    return res.status(200).json({
      success: true,
      wallet: {
        balance: wallet.balance,
        availableBalance: availableBalance > 0 ? availableBalance : 0,
        totalEarned: wallet.totalEarned,
        totalWithdrawn: wallet.totalWithdrawn,
        pendingSettlement: wallet.pendingSettlement,
        isActive: wallet.isActive,
        bankDetails,
      },
    });
  } catch (error: any) {
    console.error('Get captain wallet balance error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /captain-wallet/transactions
// ─────────────────────────────────────────────────────────────────────────────
export const getCaptainWalletTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain)
      return res.status(404).json({ success: false, message: 'Captain profile not found' });

    const { page = 1, limit = 20, type, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = { captainId: captain._id };
    if (type) filter.type = type;
    if (status) filter.status = status;

    const [transactions, total] = await Promise.all([
      CaptainWalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('serviceRequestId', 'requestId deviceInfo'),
      CaptainWalletTransaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      transactions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error('Get captain wallet transactions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /captain-wallet/analytics
// ─────────────────────────────────────────────────────────────────────────────
export const getCaptainWalletAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain)
      return res.status(404).json({ success: false, message: 'Captain profile not found' });

    const wallet = await CaptainWallet.findOne({ captainId: captain._id });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [
      thisMonthTransactions,
      lastMonthTransactions,
      thisWeekTransactions,
      lastWeekTransactions,
      thisYearTransactions,
      allTransactions,
      recentTransactions,
      tripTypeBreakdown,
      typeBreakdown,
      dailyEarnings,
      monthlyEarnings,
      settlementStats,
    ] = await Promise.all([
      CaptainWalletTransaction.find({
        captainId: captain._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfMonth },
      }),
      CaptainWalletTransaction.find({
        captainId: captain._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
      }),
      CaptainWalletTransaction.find({
        captainId: captain._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfWeek },
      }),
      CaptainWalletTransaction.find({
        captainId: captain._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfLastWeek, $lt: startOfWeek },
      }),
      CaptainWalletTransaction.find({
        captainId: captain._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfYear },
      }),
      CaptainWalletTransaction.find({ captainId: captain._id, status: 'completed' }),
      CaptainWalletTransaction.find({ captainId: captain._id, status: 'completed' })
        .sort({ createdAt: -1 })
        .limit(10),
      // Breakdown by trip type (pickup vs drop)
      CaptainWalletTransaction.aggregate([
        { $match: { captainId: captain._id, type: 'credit', status: 'completed' } },
        {
          $group: {
            _id: '$metadata.tripType',
            totalAmount: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { totalAmount: -1 } },
      ]),
      // Breakdown by transaction type
      CaptainWalletTransaction.aggregate([
        { $match: { captainId: captain._id, status: 'completed' } },
        {
          $group: {
            _id: '$type',
            totalAmount: { $sum: '$amount' },
            totalNetAmount: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
      ]),
      // Daily earnings — last 7 days
      CaptainWalletTransaction.aggregate([
        {
          $match: {
            captainId: captain._id,
            type: 'credit',
            status: 'completed',
            createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            totalEarnings: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Monthly earnings — last 6 months
      CaptainWalletTransaction.aggregate([
        {
          $match: {
            captainId: captain._id,
            type: 'credit',
            status: 'completed',
            createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 6, 1) },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            totalEarnings: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Settlement statistics
      CaptainSettlementRequest.aggregate([
        { $match: { captainId: captain._id } },
        { $group: { _id: '$status', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ]);

    const thisMonthEarnings = thisMonthTransactions.reduce((s, t) => s + t.netAmount, 0);
    const lastMonthEarnings = lastMonthTransactions.reduce((s, t) => s + t.netAmount, 0);
    const thisWeekEarnings = thisWeekTransactions.reduce((s, t) => s + t.netAmount, 0);
    const lastWeekEarnings = lastWeekTransactions.reduce((s, t) => s + t.netAmount, 0);
    const thisYearEarnings = thisYearTransactions.reduce((s, t) => s + t.netAmount, 0);

    const monthlyGrowthRate =
      lastMonthEarnings > 0
        ? ((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100
        : 0;
    const weeklyGrowthRate =
      lastWeekEarnings > 0 ? ((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100 : 0;

    const totalCredits = allTransactions
      .filter(t => t.type === 'credit')
      .reduce((s, t) => s + t.netAmount, 0);
    const totalDebits = allTransactions
      .filter(t => t.type === 'debit')
      .reduce((s, t) => s + Math.abs(t.netAmount), 0);

    const settlementStatsMap = settlementStats.reduce((acc: any, s: any) => {
      acc[s._id] = s;
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      analytics: {
        wallet: {
          balance: wallet?.balance || 0,
          availableBalance: (wallet?.balance || 0) - (wallet?.pendingSettlement || 0),
          totalEarned: wallet?.totalEarned || 0,
          totalWithdrawn: wallet?.totalWithdrawn || 0,
          pendingSettlement: wallet?.pendingSettlement || 0,
          isActive: wallet?.isActive || false,
        },
        earnings: {
          thisMonth: thisMonthEarnings,
          lastMonth: lastMonthEarnings,
          monthlyGrowthRate: Math.round(monthlyGrowthRate * 10) / 10,
          thisWeek: thisWeekEarnings,
          lastWeek: lastWeekEarnings,
          weeklyGrowthRate: Math.round(weeklyGrowthRate * 10) / 10,
          thisYear: thisYearEarnings,
          total: totalCredits,
          avgPerTransaction:
            thisMonthTransactions.length > 0
              ? Math.round(thisMonthEarnings / thisMonthTransactions.length)
              : 0,
        },
        transactions: {
          total: allTransactions.length,
          thisMonth: thisMonthTransactions.length,
          lastMonth: lastMonthTransactions.length,
          thisWeek: thisWeekTransactions.length,
          lastWeek: lastWeekTransactions.length,
          thisYear: thisYearTransactions.length,
          recent: recentTransactions,
          totalCredits,
          totalDebits,
        },
        breakdown: {
          byTripType: tripTypeBreakdown,
          byType: typeBreakdown,
        },
        trends: {
          daily: dailyEarnings,
          monthly: monthlyEarnings,
        },
        settlements: {
          pending: settlementStatsMap['pending'] || { totalAmount: 0, count: 0 },
          completed: settlementStatsMap['completed'] || { totalAmount: 0, count: 0 },
          rejected: settlementStatsMap['rejected'] || { totalAmount: 0, count: 0 },
          totalRequested:
            (settlementStatsMap['pending']?.totalAmount || 0) +
            (settlementStatsMap['completed']?.totalAmount || 0) +
            (settlementStatsMap['rejected']?.totalAmount || 0),
        },
      },
    });
  } catch (error: any) {
    console.error('Get captain wallet analytics error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /captain-wallet/bank-details
// ─────────────────────────────────────────────────────────────────────────────
export const updateCaptainBankDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain)
      return res.status(404).json({ success: false, message: 'Captain profile not found' });

    const { accountHolderName, accountNumber, ifscCode, bankName, branchName, upiId } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
      return res.status(400).json({ success: false, message: 'Missing required bank details' });
    }

    const wallet = await CaptainWallet.findOneAndUpdate(
      { captainId: captain._id },
      { bankDetails: { accountHolderName, accountNumber, ifscCode, bankName, branchName, upiId } },
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true, message: 'Bank details updated', wallet });
  } catch (error: any) {
    console.error('Update captain bank details error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /captain-wallet/settlement/request
// ─────────────────────────────────────────────────────────────────────────────
export const requestCaptainSettlement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain)
      return res.status(404).json({ success: false, message: 'Captain profile not found' });

    const { amount } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum settlement amount is ₹100' });
    }

    const wallet = await CaptainWallet.findOne({ captainId: captain._id });
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });

    if (!captain.bankDetails || !captain.bankDetails.accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please complete bank details in your captain profile first',
      });
    }

    const availableBalance = wallet.balance - wallet.pendingSettlement;
    if (availableBalance < amount) {
      return res
        .status(400)
        .json({ success: false, message: 'Insufficient available balance', availableBalance });
    }

    const pendingRequest = await CaptainSettlementRequest.findOne({
      captainId: captain._id,
      status: 'pending',
    });
    if (pendingRequest) {
      return res
        .status(400)
        .json({ success: false, message: 'You already have a pending settlement request' });
    }

    const bankDetails = {
      accountHolderName: captain.bankDetails.accountHolderName,
      accountNumber: captain.bankDetails.accountNumber,
      ifscCode: captain.bankDetails.ifscCode,
      bankName: captain.bankDetails.bankName,
    };

    const settlementRequest = await CaptainSettlementRequest.create({
      captainId: captain._id,
      amount,
      status: 'pending',
      requestedAt: new Date(),
      bankDetails,
    });

    await markCaptainSettlementAsPending(captain._id.toString(), amount);

    return res.status(201).json({
      success: true,
      message: 'Settlement request created successfully',
      settlementRequest,
    });
  } catch (error: any) {
    console.error('Request captain settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /captain-wallet/settlement/my-requests
// ─────────────────────────────────────────────────────────────────────────────
export const getCaptainSettlementRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain)
      return res.status(404).json({ success: false, message: 'Captain profile not found' });

    const { status } = req.query;
    const filter: any = { captainId: captain._id };
    if (status) filter.status = status;

    const settlements = await CaptainSettlementRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'fullName email')
      .populate('rejectedBy', 'fullName email');

    return res.status(200).json({ success: true, settlements });
  } catch (error: any) {
    console.error('Get captain settlement requests error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /captain-wallet/settlement/:settlementId
// ─────────────────────────────────────────────────────────────────────────────
export const cancelCaptainSettlementRequest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { settlementId } = req.params;
    const settlement = await CaptainSettlementRequest.findById(settlementId);
    if (!settlement)
      return res.status(404).json({ success: false, message: 'Settlement request not found' });

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain || captain._id.toString() !== settlement.captainId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (settlement.status !== 'pending') {
      return res
        .status(400)
        .json({ success: false, message: 'Only pending requests can be cancelled' });
    }

    settlement.status = 'rejected';
    settlement.rejectionReason = 'Cancelled by captain';
    await settlement.save();

    await cancelCaptainSettlementPending(settlement.captainId.toString(), settlement.amount);

    return res.status(200).json({ success: true, message: 'Settlement request cancelled' });
  } catch (error: any) {
    console.error('Cancel captain settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — GET /captain-wallet/admin/settlements
// ─────────────────────────────────────────────────────────────────────────────
export const getAllCaptainSettlementRequests = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = {};
    if (status) filter.status = status;

    const [settlements, total] = await Promise.all([
      CaptainSettlementRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('captainId', 'personalInfo')
        .populate('approvedBy', 'fullName email')
        .populate('rejectedBy', 'fullName email'),
      CaptainSettlementRequest.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      settlements,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error('Get all captain settlements error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — GET /captain-wallet/admin/stats
// ─────────────────────────────────────────────────────────────────────────────
export const getCaptainWalletAdminStats = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const [
      totalWallets,
      totalBalance,
      pendingSettlements,
      completedSettlements,
      recentTransactions,
    ] = await Promise.all([
      CaptainWallet.countDocuments({ isActive: true }),
      CaptainWallet.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, total: { $sum: '$balance' } } },
      ]),
      CaptainSettlementRequest.find({ status: 'pending' })
        .populate('captainId', 'personalInfo')
        .limit(10),
      CaptainSettlementRequest.countDocuments({ status: 'completed' }),
      CaptainWalletTransaction.find({ status: 'completed' })
        .populate('captainId', 'personalInfo')
        .sort({ createdAt: -1 })
        .limit(20),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalWallets,
        totalBalance: totalBalance[0]?.total || 0,
        pendingSettlementRequests: pendingSettlements.length,
        completedSettlements,
        pendingSettlements,
        recentTransactions,
      },
    });
  } catch (error: any) {
    console.error('Get captain wallet admin stats error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — PUT /captain-wallet/admin/settlement/:settlementId/approve
// ─────────────────────────────────────────────────────────────────────────────
export const approveCaptainSettlement = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user?.userId;
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { settlementId } = req.params;
    const { transactionReference, notes } = req.body;

    const settlement = await CaptainSettlementRequest.findById(settlementId);
    if (!settlement)
      return res.status(404).json({ success: false, message: 'Settlement not found' });

    if (settlement.status !== 'pending') {
      return res
        .status(400)
        .json({ success: false, message: 'Only pending settlements can be approved' });
    }

    const result = await debitCaptainWallet(
      settlement.captainId.toString(),
      settlement.amount,
      `Settlement approved — ${transactionReference || settlementId}`,
      settlementId
    );

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }

    settlement.status = 'completed';
    settlement.approvedBy = adminId as any;
    settlement.approvedAt = new Date();
    settlement.completedAt = new Date();
    settlement.transactionReference = transactionReference;
    settlement.notes = notes;
    await settlement.save();

    // Notify captain via socket
    try {
      const captain = await Captain.findById(settlement.captainId).select('personalInfo.userId');
      if (captain?.personalInfo?.userId) {
        const io = (global as any).io;
        if (io) {
          io.to(`user-${captain.personalInfo.userId.toString()}`).emit('settlement_update', {
            status: 'completed',
            amount: settlement.amount,
            settlementId: settlement._id,
            message: `Your withdrawal of ₹${settlement.amount} has been approved and processed.`,
          });
        }
      }
    } catch (_) {}

    return res
      .status(200)
      .json({ success: true, message: 'Settlement approved successfully', settlement });
  } catch (error: any) {
    console.error('Approve captain settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — PUT /captain-wallet/admin/settlement/:settlementId/reject
// ─────────────────────────────────────────────────────────────────────────────
export const rejectCaptainSettlement = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user?.userId;
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { settlementId } = req.params;
    const { reason } = req.body;
    if (!reason)
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });

    const settlement = await CaptainSettlementRequest.findById(settlementId);
    if (!settlement)
      return res.status(404).json({ success: false, message: 'Settlement not found' });

    if (settlement.status !== 'pending') {
      return res
        .status(400)
        .json({ success: false, message: 'Only pending settlements can be rejected' });
    }

    settlement.status = 'rejected';
    settlement.rejectedBy = adminId as any;
    settlement.rejectedAt = new Date();
    settlement.rejectionReason = reason;
    await settlement.save();

    await cancelCaptainSettlementPending(settlement.captainId.toString(), settlement.amount);

    // Notify captain via socket
    try {
      const captain = await Captain.findById(settlement.captainId).select('personalInfo.userId');
      if (captain?.personalInfo?.userId) {
        const io = (global as any).io;
        if (io) {
          io.to(`user-${captain.personalInfo.userId.toString()}`).emit('settlement_update', {
            status: 'rejected',
            amount: settlement.amount,
            settlementId: settlement._id,
            reason: settlement.rejectionReason,
            message: `Your withdrawal request of ₹${settlement.amount} was rejected: ${settlement.rejectionReason}`,
          });
        }
      }
    } catch (_) {}

    return res.status(200).json({ success: true, message: 'Settlement rejected', settlement });
  } catch (error: any) {
    console.error('Reject captain settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
