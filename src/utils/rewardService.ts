import mongoose from 'mongoose';
import CustomerWallet from '../models/customerWallet.model';
import CustomerWalletTransaction from '../models/customerWalletTransaction.model';
import ReferralEvent from '../models/referralEvent.model';
import SystemConfig, { DEFAULT_REFERRAL_CONFIG } from '../models/systemConfig.model';

export interface WalletCreditResult {
  success: boolean;
  transaction?: any;
  error?: string;
}

/**
 * Credit the customer wallet atomically.
 * Duplicate-safe: checks for existing transaction with same referralEventId + type.
 */
export const creditCustomerWallet = async (
  userId: string,
  amount: number,
  type: 'REFERRAL_REWARD' | 'COUPON_BENEFIT' | 'REFERRAL_BONUS' | 'ADJUSTMENT',
  description: string,
  metadata?: {
    referralEventId?: string;
    couponUsageId?: string;
    serviceRequestId?: string;
  }
): Promise<WalletCreditResult> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Duplicate guard for referral rewards
    if (metadata?.referralEventId) {
      const existing = await CustomerWalletTransaction.findOne({
        referralEventId: metadata.referralEventId,
        type,
        status: 'CREDITED',
      }).session(session);

      if (existing) {
        await session.abortTransaction();
        return { success: true, transaction: existing }; // idempotent
      }
    }

    // Find or create wallet
    let wallet = await CustomerWallet.findOne({ userId }).session(session);
    if (!wallet) {
      const wallets = await CustomerWallet.create([{ userId, balance: 0, isActive: true }], {
        session,
      });
      wallet = wallets[0];
    }

    const balanceBefore = wallet.balance;
    const newBalance = balanceBefore + amount;

    wallet.balance = newBalance;
    wallet.totalEarned += amount;
    await wallet.save({ session });

    const expiryDays = await SystemConfig.getValue(
      'wallet_balance_expiry_days',
      DEFAULT_REFERRAL_CONFIG.wallet_balance_expiry_days
    );
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    const [txn] = await CustomerWalletTransaction.create(
      [
        {
          userId,
          type,
          status: 'CREDITED',
          amount,
          balanceBefore,
          balanceAfter: newBalance,
          description,
          expiresAt,
          ...(metadata?.referralEventId
            ? { referralEventId: new mongoose.Types.ObjectId(metadata.referralEventId) }
            : {}),
          ...(metadata?.couponUsageId
            ? { couponUsageId: new mongoose.Types.ObjectId(metadata.couponUsageId) }
            : {}),
          ...(metadata?.serviceRequestId
            ? { serviceRequestId: new mongoose.Types.ObjectId(metadata.serviceRequestId) }
            : {}),
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return { success: true, transaction: txn };
  } catch (error: any) {
    await session.abortTransaction();
    console.error('Customer wallet credit error:', error);
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
};

/**
 * Debit customer wallet (used when applying wallet balance at checkout).
 */
export const debitCustomerWallet = async (
  userId: string,
  amount: number,
  description: string,
  serviceRequestId?: string
): Promise<WalletCreditResult> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await CustomerWallet.findOne({ userId }).session(session);
    if (!wallet || wallet.balance < amount) {
      throw new Error('Insufficient wallet balance');
    }

    const balanceBefore = wallet.balance;
    const newBalance = balanceBefore - amount;
    wallet.balance = newBalance;
    wallet.totalUsed += amount;
    await wallet.save({ session });

    const [txn] = await CustomerWalletTransaction.create(
      [
        {
          userId,
          type: 'COUPON_USAGE',
          status: 'CREDITED',
          amount: -amount,
          balanceBefore,
          balanceAfter: newBalance,
          description,
          ...(serviceRequestId
            ? { serviceRequestId: new mongoose.Types.ObjectId(serviceRequestId) }
            : {}),
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return { success: true, transaction: txn };
  } catch (error: any) {
    await session.abortTransaction();
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
};

/**
 * Hold a referral reward (HELD status) before fraud review completes.
 * Creates a transaction in HELD state without crediting balance.
 */
export const holdReferralReward = async (
  userId: string,
  amount: number,
  referralEventId: string,
  description: string
): Promise<WalletCreditResult> => {
  try {
    const wallet = await CustomerWallet.findOne({ userId });
    const balanceBefore = wallet?.balance ?? 0;

    const txn = await CustomerWalletTransaction.create({
      userId,
      type: 'REFERRAL_REWARD',
      status: 'HELD',
      amount,
      balanceBefore,
      balanceAfter: balanceBefore, // balance NOT changed while held
      description,
      referralEventId: new mongoose.Types.ObjectId(referralEventId),
    });

    return { success: true, transaction: txn };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

/**
 * Release a held reward: credit wallet balance and mark transaction CREDITED.
 */
export const releaseHeldReward = async (referralEventId: string): Promise<WalletCreditResult> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const event = await ReferralEvent.findById(referralEventId).session(session);
    if (!event || event.status !== 'HELD') {
      throw new Error('Referral event not in HELD state');
    }

    // Credit referrer
    const referrerResult = await _creditFromHeld(
      event.referrerId.toString(),
      event.rewardReferrer,
      referralEventId,
      'REFERRAL_REWARD',
      `Referral reward for referring a friend`,
      session
    );

    // Credit referee (welcome bonus)
    if (event.rewardReferee > 0) {
      await _creditFromHeld(
        event.refereeId.toString(),
        event.rewardReferee,
        referralEventId,
        'REFERRAL_BONUS',
        `Welcome bonus for joining via referral`,
        session
      );
    }

    event.status = 'REWARDED';
    await event.save({ session });

    await session.commitTransaction();
    return { success: true, transaction: referrerResult };
  } catch (error: any) {
    await session.abortTransaction();
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
};

/**
 * Void a held reward and mark referral event as BLOCKED.
 */
export const voidReward = async (
  referralEventId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const event = await ReferralEvent.findById(referralEventId);
    if (!event) throw new Error('Referral event not found');

    event.status = 'BLOCKED';
    event.fraudFlags.manualBlock = true;
    await event.save();

    // Mark held transactions as BLOCKED
    await CustomerWalletTransaction.updateMany(
      { referralEventId: new mongoose.Types.ObjectId(referralEventId), status: 'HELD' },
      { status: 'BLOCKED' }
    );

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Internal helper: move a HELD transaction to CREDITED and update wallet balance
async function _creditFromHeld(
  userId: string,
  amount: number,
  referralEventId: string,
  type: 'REFERRAL_REWARD' | 'REFERRAL_BONUS',
  description: string,
  session: mongoose.ClientSession
): Promise<any> {
  let wallet = await CustomerWallet.findOne({ userId }).session(session);
  if (!wallet) {
    const wallets = await CustomerWallet.create([{ userId, balance: 0, isActive: true }], {
      session,
    });
    wallet = wallets[0];
  }

  const balanceBefore = wallet.balance;
  const newBalance = balanceBefore + amount;
  wallet.balance = newBalance;
  wallet.totalEarned += amount;
  await wallet.save({ session });

  // Update existing HELD transaction or create new CREDITED one
  const updated = await CustomerWalletTransaction.findOneAndUpdate(
    { userId, referralEventId: new mongoose.Types.ObjectId(referralEventId), type, status: 'HELD' },
    { status: 'CREDITED', balanceAfter: newBalance },
    { session, new: true }
  );

  if (!updated) {
    const expiryDays = 365;
    await CustomerWalletTransaction.create(
      [
        {
          userId,
          type,
          status: 'CREDITED',
          amount,
          balanceBefore,
          balanceAfter: newBalance,
          description,
          referralEventId: new mongoose.Types.ObjectId(referralEventId),
          expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
        },
      ],
      { session }
    );
  }

  return updated;
}
