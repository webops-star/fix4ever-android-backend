import mongoose, { Document, Schema } from 'mongoose';

export interface CaptainWalletTransaction extends Document {
  captainId: mongoose.Types.ObjectId;
  serviceRequestId: mongoose.Types.ObjectId;
  type: 'credit' | 'debit' | 'settlement' | 'refund' | 'adjustment';
  category: 'trip_earning' | 'withdrawal';
  amount: number;
  netAmount: number;
  description: string;
  balanceBefore: number;
  balanceAfter: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  metadata?: {
    tripType?: 'pickup' | 'drop';
    serviceType?: 'pickup-drop' | 'visit-shop';
  };
  createdAt: Date;
  updatedAt: Date;
}

const captainWalletTransactionSchema = new Schema<CaptainWalletTransaction>(
  {
    captainId: {
      type: Schema.Types.ObjectId,
      ref: 'Captain',
      required: true,
      index: true,
    },
    serviceRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['credit', 'debit', 'settlement', 'refund', 'adjustment'],
      required: true,
    },
    category: {
      type: String,
      enum: ['trip_earning', 'withdrawal'],
      required: true,
    },
    amount: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    description: { type: String, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'pending',
    },
    metadata: {
      tripType: { type: String, enum: ['pickup', 'drop'] },
      serviceType: { type: String, enum: ['pickup-drop', 'visit-shop'] },
    },
  },
  { timestamps: true }
);

captainWalletTransactionSchema.index({ captainId: 1, createdAt: -1 });
captainWalletTransactionSchema.index({ serviceRequestId: 1 });
captainWalletTransactionSchema.index({ status: 1, type: 1 });

export default mongoose.model<CaptainWalletTransaction>(
  'CaptainWalletTransaction',
  captainWalletTransactionSchema
);
