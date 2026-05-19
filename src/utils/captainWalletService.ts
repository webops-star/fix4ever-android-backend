import mongoose from 'mongoose';
import CaptainWallet from '../models/captainWallet.model';
import CaptainWalletTransaction from '../models/captainWalletTransaction.model';

interface WalletResult {
  success: boolean;
  transaction?: any;
  error?: string;
}

/**
 * Calculate captain trip fare.
 *
 * Currently returns a static ₹150 per trip regardless of trip type.
 * distanceKm is reserved for future distance-based pricing — when that feature
 * is implemented, only this function needs to change; all wallet logic is unaffected.
 *
 * @param tripType - 'pickup' (customer→vendor) or 'drop' (vendor→customer)
 * @param distanceKm - Reserved for future distance-based pricing
 */
export const calculateCaptainTripFare = (
  tripType: 'pickup' | 'drop',
  distanceKm?: number
): number => {
  // TODO: Replace with distance-based formula when distance tracking is implemented
  return 150;
};

/**
 * Credit a captain's wallet on trip completion.
 * Uses MongoDB session for atomicity — wallet balance and transaction are updated together.
 * Duplicate-payment guard: if a completed transaction already exists for the same
 * serviceRequestId + tripType combination, the credit is skipped silently.
 */
export const creditCaptainWallet = async (
  captainId: string,
  serviceRequestId: string,
  tripType: 'pickup' | 'drop',
  serviceType: 'pickup-drop' | 'visit-shop',
  distanceKm?: number
): Promise<WalletResult> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!captainId || !serviceRequestId) {
      throw new Error('Missing required parameters for captain wallet credit');
    }

    // Duplicate payment guard
    const existingTransaction = await CaptainWalletTransaction.findOne({
      captainId,
      serviceRequestId,
      'metadata.tripType': tripType,
      status: 'completed',
    }).session(session);

    if (existingTransaction) {
      await session.abortTransaction();
      return { success: true, transaction: existingTransaction };
    }

    // Find or create captain wallet
    let wallet = await CaptainWallet.findOne({ captainId }).session(session);

    if (!wallet) {
      const wallets = await CaptainWallet.create(
        [
          {
            captainId,
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
      throw new Error('Captain wallet is inactive');
    }

    const fareAmount = calculateCaptainTripFare(tripType, distanceKm);
    const balanceBefore = wallet.balance;
    const newBalance = balanceBefore + fareAmount;

    wallet.balance = newBalance;
    wallet.totalEarned += fareAmount;
    await wallet.save({ session });

    const tripLabel =
      tripType === 'pickup' ? 'Pickup (Customer → Vendor)' : 'Drop (Vendor → Customer)';
    const transactions = await CaptainWalletTransaction.create(
      [
        {
          captainId,
          serviceRequestId,
          type: 'credit',
          category: 'trip_earning',
          amount: fareAmount,
          netAmount: fareAmount,
          description: `Trip earning — ${tripLabel} for request #${serviceRequestId.slice(-8)}`,
          balanceBefore,
          balanceAfter: newBalance,
          status: 'completed',
          metadata: {
            tripType,
            serviceType,
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return { success: true, transaction: transactions[0] };
  } catch (error: any) {
    await session.abortTransaction();
    console.error('Captain wallet credit error:', error);
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
};

/**
 * Debit a captain's wallet when a settlement payout is approved by admin.
 */
export const debitCaptainWallet = async (
  captainId: string,
  amount: number,
  description: string,
  settlementRequestId?: string
): Promise<WalletResult> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await CaptainWallet.findOne({ captainId }).session(session);

    if (!wallet) {
      throw new Error('Captain wallet not found');
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

    const transactions = await CaptainWalletTransaction.create(
      [
        {
          captainId,
          serviceRequestId: settlementRequestId || new mongoose.Types.ObjectId(),
          type: 'debit',
          category: 'withdrawal',
          amount,
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

    return { success: true, transaction: transactions[0] };
  } catch (error: any) {
    await session.abortTransaction();
    console.error('Captain wallet debit error:', error);
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
};

/**
 * Mark an amount as pending settlement to prevent double-withdrawal.
 * Called when captain submits a settlement request.
 */
export const markCaptainSettlementAsPending = async (
  captainId: string,
  amount: number
): Promise<boolean> => {
  try {
    const wallet = await CaptainWallet.findOne({ captainId });
    if (!wallet) return false;

    wallet.pendingSettlement += amount;
    await wallet.save();
    return true;
  } catch (error) {
    console.error('Mark captain settlement pending error:', error);
    return false;
  }
};

/**
 * Reverse a pending settlement amount.
 * Called when a settlement request is cancelled or rejected.
 */
export const cancelCaptainSettlementPending = async (
  captainId: string,
  amount: number
): Promise<boolean> => {
  try {
    const wallet = await CaptainWallet.findOne({ captainId });
    if (!wallet) return false;

    wallet.pendingSettlement = Math.max(0, wallet.pendingSettlement - amount);
    await wallet.save();
    return true;
  } catch (error) {
    console.error('Cancel captain settlement pending error:', error);
    return false;
  }
};
