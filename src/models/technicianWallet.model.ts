import mongoose, { Document, Schema } from 'mongoose';

export interface TechnicianWallet extends Document {
  technicianId: mongoose.Types.ObjectId;
  balance: number;
  totalEarned: number;
  totalWithdrawn: number;
  pendingSettlement: number;
  isActive: boolean;
  bankDetails?: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    branchName: string;
    upiId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const technicianWalletSchema = new Schema<TechnicianWallet>(
  {
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    totalEarned: { type: Number, default: 0, min: 0 },
    totalWithdrawn: { type: Number, default: 0, min: 0 },
    pendingSettlement: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    bankDetails: {
      accountHolderName: { type: String },
      accountNumber: { type: String },
      ifscCode: { type: String },
      bankName: { type: String },
      branchName: { type: String },
      upiId: { type: String },
    },
  },
  { timestamps: true }
);

technicianWalletSchema.index({ technicianId: 1, isActive: 1 });

export default mongoose.model<TechnicianWallet>('TechnicianWallet', technicianWalletSchema);
