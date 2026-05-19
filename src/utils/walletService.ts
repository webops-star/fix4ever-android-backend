import mongoose from 'mongoose';
import TechnicianWallet from '../models/technicianWallet.model';
import WalletTransaction from '../models/walletTransaction.model';

// Commission rate for technician charges (20% to company, 80% to technician)
const TECHNICIAN_COMMISSION_RATE = 0.2;

interface PaymentBreakdown {
  serviceCost: number;
  componentCost: number;
  pickupCost: number;
  emergencyCharges?: number;
  warrantyCharges?: number;
  dataSafetyCharges?: number;
  totalCost: number;
  technicianCharges?: number;
  technicianEarnings?: number;
  companyCommission?: number;
}

interface WalletCreditResult {
  success: boolean;
  transaction?: any;
  error?: string;
}

/**
 * Calculate technician earnings from the payment breakdown
 *
 * Technician charges = Final Price - Component Charges - Emergency Charges - Warranty Charges - Data Safety Charges - Pickup & Drop Charges
 * Technician earns 80% of technician charges
 *
 * @param breakdown - Payment breakdown from service request
 * @returns Earnings calculation result
 */
export const calculateTechnicianEarnings = (breakdown: PaymentBreakdown) => {
  // If technicianEarnings is already calculated (from admin setting final price), use it
  if (breakdown.technicianEarnings !== undefined && breakdown.technicianCharges !== undefined) {
    return {
      technicianEarnings: breakdown.technicianEarnings,
      companyCommission:
        breakdown.companyCommission ||
        Math.round(breakdown.technicianCharges * TECHNICIAN_COMMISSION_RATE),
      technicianCharges: breakdown.technicianCharges,
      breakdown: {
        totalCost: breakdown.totalCost,
        serviceCost: breakdown.serviceCost,
        componentCost: breakdown.componentCost,
        pickupCost: breakdown.pickupCost,
        emergencyCharges: breakdown.emergencyCharges || 0,
        warrantyCharges: breakdown.warrantyCharges || 0,
        dataSafetyCharges: breakdown.dataSafetyCharges || 0,
        technicianCharges: breakdown.technicianCharges,
        technicianEarnings: breakdown.technicianEarnings,
        commissionRate: TECHNICIAN_COMMISSION_RATE,
      },
    };
  }

  // Fallback: Calculate if not pre-calculated (legacy support)
  // Technician charges = Total - Component Cost - Emergency - Warranty - Data Safety - Pickup
  const emergencyCharges = breakdown.emergencyCharges || 0;
  const warrantyCharges = breakdown.warrantyCharges || 0;
  const dataSafetyCharges = breakdown.dataSafetyCharges || 0;
  const pickupCost = breakdown.pickupCost || 0;
  const componentCost = breakdown.componentCost || 0;
  const totalCost =
    breakdown.totalCost ||
    breakdown.serviceCost +
      componentCost +
      pickupCost +
      emergencyCharges +
      warrantyCharges +
      dataSafetyCharges;

  const technicianCharges =
    totalCost - componentCost - emergencyCharges - warrantyCharges - dataSafetyCharges - pickupCost;
  const technicianEarnings = Math.round(technicianCharges * (1 - TECHNICIAN_COMMISSION_RATE));
  const companyCommission = Math.round(technicianCharges * TECHNICIAN_COMMISSION_RATE);

  return {
    technicianEarnings: technicianEarnings,
    companyCommission: companyCommission,
    technicianCharges: technicianCharges,
    breakdown: {
      totalCost: totalCost,
      serviceCost: breakdown.serviceCost,
      componentCost: componentCost,
      pickupCost: pickupCost,
      emergencyCharges: emergencyCharges,
      warrantyCharges: warrantyCharges,
      dataSafetyCharges: dataSafetyCharges,
      technicianCharges: technicianCharges,
      technicianEarnings: technicianEarnings,
      commissionRate: TECHNICIAN_COMMISSION_RATE,
    },
  };
};

export const creditTechnicianWallet = async (
  technicianId: string,
  serviceRequestId: string,
  paymentTransactionId: string,
  breakdown: PaymentBreakdown
): Promise<WalletCreditResult> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!technicianId || !serviceRequestId || !paymentTransactionId) {
      throw new Error('Missing required parameters for wallet credit');
    }

    const totalAmount = breakdown.totalCost || 0;
    if (totalAmount <= 0) {
      throw new Error('Invalid payment amount');
    }

    const existingTransaction = await WalletTransaction.findOne({
      paymentTransactionId,
    }).session(session);

    if (existingTransaction) {
      throw new Error('Payment already credited to wallet');
    }

    let wallet = await TechnicianWallet.findOne({ technicianId }).session(session);

    if (!wallet) {
      const wallets = await TechnicianWallet.create(
        [
          {
            technicianId,
            balance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
            pendingSettlement: 0,
            isActive: true,
          },
        ],
        { session }
      );
      wallet = wallets[0];
    }

    if (!wallet.isActive) {
      throw new Error('Wallet is inactive');
    }

    const earnings = calculateTechnicianEarnings(breakdown);
    const balanceBefore = wallet.balance;
    const newBalance = balanceBefore + earnings.technicianEarnings;

    wallet.balance = newBalance;
    wallet.totalEarned += earnings.technicianEarnings;
    await wallet.save({ session });

    const transaction = await WalletTransaction.create(
      [
        {
          technicianId,
          serviceRequestId,
          paymentTransactionId,
          type: 'credit',
          category: 'service_charge',
          amount: totalAmount,
          commission: earnings.companyCommission,
          netAmount: earnings.technicianEarnings,
          description: `Earnings from service request #${serviceRequestId.slice(-8)}`,
          balanceBefore,
          balanceAfter: newBalance,
          status: 'completed',
          metadata: {
            totalCost: totalAmount,
            serviceCost: breakdown.serviceCost,
            componentCost: breakdown.componentCost,
            pickupCost: breakdown.pickupCost,
            emergencyCharges: breakdown.emergencyCharges || 0,
            warrantyCharges: breakdown.warrantyCharges || 0,
            dataSafetyCharges: breakdown.dataSafetyCharges || 0,
            technicianCharges: earnings.technicianCharges,
            technicianEarnings: earnings.technicianEarnings,
            commissionPercentage: TECHNICIAN_COMMISSION_RATE * 100,
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return { success: true, transaction: transaction[0] };
  } catch (error: any) {
    await session.abortTransaction();
    console.error('Wallet credit error:', error);
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
};

export const debitTechnicianWallet = async (
  technicianId: string,
  amount: number,
  description: string,
  settlementRequestId?: string
): Promise<WalletCreditResult> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await TechnicianWallet.findOne({ technicianId }).session(session);

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.balance < amount) {
      throw new Error('Insufficient balance');
    }

    const balanceBefore = wallet.balance;
    const newBalance = balanceBefore - amount;

    wallet.balance = newBalance;
    wallet.totalWithdrawn += amount;
    wallet.pendingSettlement = Math.max(0, wallet.pendingSettlement - amount);
    await wallet.save({ session });

    const transaction = await WalletTransaction.create(
      [
        {
          technicianId,
          serviceRequestId: settlementRequestId || new mongoose.Types.ObjectId(),
          type: 'debit',
          category: 'withdrawal',
          amount,
          commission: 0,
          netAmount: amount,
          description,
          balanceBefore,
          balanceAfter: newBalance,
          status: 'completed',
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return { success: true, transaction: transaction[0] };
  } catch (error: any) {
    await session.abortTransaction();
    console.error('Wallet debit error:', error);
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
};

export const markSettlementAsPending = async (
  technicianId: string,
  amount: number
): Promise<boolean> => {
  try {
    const wallet = await TechnicianWallet.findOne({ technicianId });
    if (!wallet) return false;

    wallet.pendingSettlement += amount;
    await wallet.save();
    return true;
  } catch (error) {
    console.error('Mark settlement pending error:', error);
    return false;
  }
};

export const cancelSettlementPending = async (
  technicianId: string,
  amount: number
): Promise<boolean> => {
  try {
    const wallet = await TechnicianWallet.findOne({ technicianId });
    if (!wallet) return false;

    wallet.pendingSettlement = Math.max(0, wallet.pendingSettlement - amount);
    await wallet.save();
    return true;
  } catch (error) {
    console.error('Cancel settlement pending error:', error);
    return false;
  }
};
