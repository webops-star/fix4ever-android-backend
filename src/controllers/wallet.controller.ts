import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import TechnicianWallet from '../models/technicianWallet.model';
import WalletTransaction from '../models/walletTransaction.model';
import SettlementRequest from '../models/settlementRequest.model';
import Vendor from '../models/vendor.model';
import {
  debitTechnicianWallet,
  markSettlementAsPending,
  cancelSettlementPending,
} from '../utils/walletService';
import { emitVendorSettlementUpdate } from '../utils/realTimeNotifications';

export const getWalletBalance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Technician profile not found' });
    }

    let wallet = await TechnicianWallet.findOne({ technicianId: vendor._id });
    if (!wallet) {
      wallet = await TechnicianWallet.create({
        technicianId: vendor._id,
        balance: 0,
        totalEarned: 0,
        totalWithdrawn: 0,
        pendingSettlement: 0,
        isActive: true,
      });
    }

    const availableBalance = wallet.balance - wallet.pendingSettlement;

    // Fetch bank details from vendor onboarding data
    const bankDetails = vendor.bankDetails
      ? {
          accountHolderName: vendor.bankDetails.accountHolderName,
          accountNumber: vendor.bankDetails.accountNumber,
          ifscCode: vendor.bankDetails.ifscCode,
          bankName: vendor.bankDetails.bankName,
          branchName: vendor.bankDetails.branchName,
          accountType: vendor.bankDetails.accountType,
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
        bankDetails: bankDetails,
      },
    });
  } catch (error: any) {
    console.error('Get wallet balance error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getWalletTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Technician profile not found' });
    }

    const { page = 1, limit = 20, type, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = { technicianId: vendor._id };
    if (type) filter.type = type;
    if (status) filter.status = status;

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('serviceRequestId', 'requestId deviceInfo'),
      WalletTransaction.countDocuments(filter),
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
    console.error('Get wallet transactions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateBankDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Technician profile not found' });
    }

    const { accountHolderName, accountNumber, ifscCode, bankName, branchName, upiId } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
      return res.status(400).json({ success: false, message: 'Missing required bank details' });
    }

    const wallet = await TechnicianWallet.findOneAndUpdate(
      { technicianId: vendor._id },
      {
        bankDetails: {
          accountHolderName,
          accountNumber,
          ifscCode,
          bankName,
          branchName,
          upiId,
        },
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true, message: 'Bank details updated', wallet });
  } catch (error: any) {
    console.error('Update bank details error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const requestSettlement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Technician profile not found' });
    }

    const { amount } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum settlement amount is ₹100' });
    }

    const wallet = await TechnicianWallet.findOne({ technicianId: vendor._id });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    // Check bank details from vendor onboarding data
    if (!vendor.bankDetails || !vendor.bankDetails.accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please complete bank details in your onboarding profile first',
      });
    }

    const availableBalance = wallet.balance - wallet.pendingSettlement;
    if (availableBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient available balance',
        availableBalance,
      });
    }

    const pendingRequest = await SettlementRequest.findOne({
      technicianId: vendor._id,
      status: 'pending',
    });

    if (pendingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending settlement request',
      });
    }

    // Use bank details from vendor onboarding
    const bankDetails = {
      accountHolderName: vendor.bankDetails.accountHolderName,
      accountNumber: vendor.bankDetails.accountNumber,
      ifscCode: vendor.bankDetails.ifscCode,
      bankName: vendor.bankDetails.bankName,
      branchName: vendor.bankDetails.branchName,
    };

    const settlementRequest = await SettlementRequest.create({
      technicianId: vendor._id,
      amount,
      status: 'pending',
      requestedAt: new Date(),
      bankDetails: bankDetails,
    });

    await markSettlementAsPending(vendor._id.toString(), amount);

    return res.status(201).json({
      success: true,
      message: 'Settlement request created successfully',
      settlementRequest,
    });
  } catch (error: any) {
    console.error('Request settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getSettlementRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Technician profile not found' });
    }

    const { status } = req.query;
    const filter: any = { technicianId: vendor._id };
    if (status) filter.status = status;

    const settlements = await SettlementRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'fullName email')
      .populate('rejectedBy', 'fullName email');

    return res.status(200).json({ success: true, settlements });
  } catch (error: any) {
    console.error('Get settlement requests error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const cancelSettlementRequest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { settlementId } = req.params;

    const settlement = await SettlementRequest.findById(settlementId);
    if (!settlement) {
      return res.status(404).json({ success: false, message: 'Settlement request not found' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor || vendor._id.toString() !== settlement.technicianId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (settlement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending requests can be cancelled',
      });
    }

    settlement.status = 'rejected';
    settlement.rejectionReason = 'Cancelled by technician';
    await settlement.save();

    await cancelSettlementPending(settlement.technicianId.toString(), settlement.amount);

    return res.status(200).json({ success: true, message: 'Settlement request cancelled' });
  } catch (error: any) {
    console.error('Cancel settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAllSettlementRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = {};
    if (status) filter.status = status;

    const [settlements, total] = await Promise.all([
      SettlementRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('technicianId', 'pocInfo businessDetails')
        .populate('approvedBy', 'fullName email')
        .populate('rejectedBy', 'fullName email'),
      SettlementRequest.countDocuments(filter),
    ]);
    console.log(settlements);
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
    console.error('Get all settlements error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const approveSettlement = async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const adminId = req.user?.userId;

    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { settlementId } = req.params;
    const { transactionReference, notes } = req.body;

    const settlement = await SettlementRequest.findById(settlementId);
    if (!settlement) {
      return res.status(404).json({ success: false, message: 'Settlement not found' });
    }

    if (settlement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending settlements can be approved',
      });
    }

    const result = await debitTechnicianWallet(
      settlement.technicianId.toString(),
      settlement.amount,
      `Settlement approved - ${transactionReference || settlementId}`,
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

    // Real-time: notify vendor their settlement was approved
    try {
      const vendor = await Vendor.findById(settlement.technicianId).select('pocInfo.userId');
      if (vendor?.pocInfo?.userId) {
        emitVendorSettlementUpdate(vendor.pocInfo.userId.toString(), {
          status: 'completed',
          amount: settlement.amount,
          settlementId: settlement._id,
          message: `Your withdrawal of ₹${settlement.amount} has been approved and processed.`,
        });
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: 'Settlement approved successfully',
      settlement,
    });
  } catch (error: any) {
    console.error('Approve settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const rejectSettlement = async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const adminId = req.user?.userId;

    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { settlementId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const settlement = await SettlementRequest.findById(settlementId);
    if (!settlement) {
      return res.status(404).json({ success: false, message: 'Settlement not found' });
    }

    if (settlement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending settlements can be rejected',
      });
    }

    settlement.status = 'rejected';
    settlement.rejectedBy = adminId as any;
    settlement.rejectedAt = new Date();
    settlement.rejectionReason = reason;
    await settlement.save();

    await cancelSettlementPending(settlement.technicianId.toString(), settlement.amount);

    // Real-time: notify vendor their settlement was rejected
    try {
      const vendor = await Vendor.findById(settlement.technicianId).select('pocInfo.userId');
      if (vendor?.pocInfo?.userId) {
        emitVendorSettlementUpdate(vendor.pocInfo.userId.toString(), {
          status: 'rejected',
          amount: settlement.amount,
          settlementId: settlement._id,
          reason,
          message: `Your withdrawal request of ₹${settlement.amount} was rejected: ${reason}`,
        });
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: 'Settlement rejected',
      settlement,
    });
  } catch (error: any) {
    console.error('Reject settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getWalletAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Technician profile not found' });
    }

    const wallet = await TechnicianWallet.findOne({ technicianId: vendor._id });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    // Get all transactions for comprehensive analytics
    const [
      thisMonthTransactions,
      lastMonthTransactions,
      thisWeekTransactions,
      lastWeekTransactions,
      thisYearTransactions,
      allTransactions,
      recentTransactions,
      categoryBreakdown,
      typeBreakdown,
      dailyEarnings,
      monthlyEarnings,
      settlementStats,
    ] = await Promise.all([
      // This month credits
      WalletTransaction.find({
        technicianId: vendor._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfMonth },
      }),
      // Last month credits
      WalletTransaction.find({
        technicianId: vendor._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
      }),
      // This week credits
      WalletTransaction.find({
        technicianId: vendor._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfWeek },
      }),
      // Last week credits
      WalletTransaction.find({
        technicianId: vendor._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfLastWeek, $lt: startOfWeek },
      }),
      // This year credits
      WalletTransaction.find({
        technicianId: vendor._id,
        type: 'credit',
        status: 'completed',
        createdAt: { $gte: startOfYear },
      }),
      // All completed transactions
      WalletTransaction.find({
        technicianId: vendor._id,
        status: 'completed',
      }),
      // Recent transactions
      WalletTransaction.find({
        technicianId: vendor._id,
        status: 'completed',
      })
        .sort({ createdAt: -1 })
        .limit(10),
      // Category breakdown
      WalletTransaction.aggregate([
        {
          $match: {
            technicianId: vendor._id,
            type: 'credit',
            status: 'completed',
          },
        },
        {
          $group: {
            _id: '$category',
            totalAmount: { $sum: '$amount' },
            totalEarnings: { $sum: '$netAmount' },
            totalCommission: { $sum: '$commission' },
            count: { $sum: 1 },
          },
        },
        { $sort: { totalEarnings: -1 } },
      ]),
      // Transaction type breakdown
      WalletTransaction.aggregate([
        {
          $match: {
            technicianId: vendor._id,
            status: 'completed',
          },
        },
        {
          $group: {
            _id: '$type',
            totalAmount: { $sum: '$amount' },
            totalNetAmount: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
      ]),
      // Daily earnings for last 7 days
      WalletTransaction.aggregate([
        {
          $match: {
            technicianId: vendor._id,
            type: 'credit',
            status: 'completed',
            createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            totalEarnings: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Monthly earnings for last 6 months
      WalletTransaction.aggregate([
        {
          $match: {
            technicianId: vendor._id,
            type: 'credit',
            status: 'completed',
            createdAt: {
              $gte: new Date(now.getFullYear(), now.getMonth() - 6, 1),
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m', date: '$createdAt' },
            },
            totalEarnings: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Settlement statistics
      SettlementRequest.aggregate([
        {
          $match: {
            technicianId: vendor._id,
          },
        },
        {
          $group: {
            _id: '$status',
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Calculate earnings
    const thisMonthEarnings = thisMonthTransactions.reduce((sum, txn) => sum + txn.netAmount, 0);
    const lastMonthEarnings = lastMonthTransactions.reduce((sum, txn) => sum + txn.netAmount, 0);
    const thisWeekEarnings = thisWeekTransactions.reduce((sum, txn) => sum + txn.netAmount, 0);
    const lastWeekEarnings = lastWeekTransactions.reduce((sum, txn) => sum + txn.netAmount, 0);
    const thisYearEarnings = thisYearTransactions.reduce((sum, txn) => sum + txn.netAmount, 0);

    // Calculate growth rates
    const monthlyGrowthRate =
      lastMonthEarnings > 0
        ? ((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100
        : 0;
    const weeklyGrowthRate =
      lastWeekEarnings > 0 ? ((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100 : 0;

    // Calculate totals
    const totalCredits = allTransactions
      .filter(t => t.type === 'credit')
      .reduce((sum, txn) => sum + txn.netAmount, 0);
    const totalDebits = allTransactions
      .filter(t => t.type === 'debit')
      .reduce((sum, txn) => sum + Math.abs(txn.netAmount), 0);
    const totalCommission = allTransactions.reduce((sum, txn) => sum + (txn.commission || 0), 0);

    // Process settlement stats
    const settlementStatsMap = settlementStats.reduce((acc: any, stat: any) => {
      acc[stat._id] = stat;
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
          totalCommission,
        },
        breakdown: {
          byCategory: categoryBreakdown,
          byType: typeBreakdown,
        },
        trends: {
          daily: dailyEarnings,
          monthly: monthlyEarnings,
        },
        settlements: {
          pending: settlementStatsMap.pending || { totalAmount: 0, count: 0 },
          completed: settlementStatsMap.completed || { totalAmount: 0, count: 0 },
          rejected: settlementStatsMap.rejected || { totalAmount: 0, count: 0 },
          totalRequested:
            (settlementStatsMap.pending?.totalAmount || 0) +
            (settlementStatsMap.completed?.totalAmount || 0) +
            (settlementStatsMap.rejected?.totalAmount || 0),
        },
      },
    });
  } catch (error: any) {
    console.error('Get wallet analytics error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdminWalletStats = async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const [
      totalWallets,
      totalBalance,
      pendingSettlements,
      completedSettlements,
      totalCommission,
      recentTransactions,
    ] = await Promise.all([
      TechnicianWallet.countDocuments({ isActive: true }),
      TechnicianWallet.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, total: { $sum: '$balance' } } },
      ]),
      SettlementRequest.find({ status: 'pending' })
        .populate('technicianId', 'pocInfo businessDetails')
        .limit(10),
      SettlementRequest.countDocuments({ status: 'completed' }),
      WalletTransaction.aggregate([
        { $match: { type: 'credit', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$commission' } } },
      ]),
      WalletTransaction.find({ status: 'completed' })
        .populate('technicianId', 'pocInfo')
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
        totalCommissionEarned: totalCommission[0]?.total || 0,
        pendingSettlements,
        recentTransactions,
      },
    });
  } catch (error: any) {
    console.error('Get admin wallet stats error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
