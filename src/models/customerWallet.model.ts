import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomerWallet extends Document {
  userId: mongoose.Types.ObjectId;
  balance: number;
  totalEarned: number;
  totalUsed: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerWalletSchema = new Schema<ICustomerWallet>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    totalEarned: { type: Number, default: 0, min: 0 },
    totalUsed: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICustomerWallet>('CustomerWallet', customerWalletSchema);
