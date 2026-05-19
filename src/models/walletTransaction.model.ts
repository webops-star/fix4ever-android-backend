import mongoose, { Document, Schema } from 'mongoose';

export interface WalletTransaction extends Document {
  technicianId: mongoose.Types.ObjectId;
  serviceRequestId: mongoose.Types.ObjectId;
  paymentTransactionId?: mongoose.Types.ObjectId;
  type: 'credit' | 'debit' | 'settlement' | 'refund' | 'adjustment';
  category: 'service_charge' | 'component_charge' | 'pickup_charge' | 'commission' | 'withdrawal';
  amount: number;
  commission: number;
  netAmount: number;
  description: string;
  balanceBefore: number;
  balanceAfter: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  metadata?: {
    serviceCost?: number;
    componentCost?: number;
    pickupCost?: number;
    commissionPercentage?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const walletTransactionSchema = new Schema<WalletTransaction>(
  {
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    serviceRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      index: true,
    },
    paymentTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'PaymentTransaction',
    },
    type: {
      type: String,
      enum: ['credit', 'debit', 'settlement', 'refund', 'adjustment'],
      required: true,
    },
    category: {
      type: String,
      enum: ['service_charge', 'component_charge', 'pickup_charge', 'commission', 'withdrawal'],
      required: true,
    },
    amount: { type: Number, required: true },
    commission: { type: Number, default: 0 },
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
      serviceCost: { type: Number },
      componentCost: { type: Number },
      pickupCost: { type: Number },
      commissionPercentage: { type: Number },
    },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ technicianId: 1, createdAt: -1 });
walletTransactionSchema.index({ serviceRequestId: 1 });
walletTransactionSchema.index({ status: 1, type: 1 });

export default mongoose.model<WalletTransaction>('WalletTransaction', walletTransactionSchema);
