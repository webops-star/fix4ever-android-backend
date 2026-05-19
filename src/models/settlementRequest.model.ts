import mongoose, { Document, Schema } from 'mongoose';

export interface SettlementRequest extends Document {
  technicianId: mongoose.Types.ObjectId;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
  requestedAt: Date;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: mongoose.Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  completedAt?: Date;
  bankDetails: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    upiId?: string;
  };
  transactionReference?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const settlementRequestSchema = new Schema<SettlementRequest>(
  {
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 100 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    requestedAt: { type: Date, default: Date.now },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
    completedAt: { type: Date },
    bankDetails: {
      accountHolderName: { type: String, required: true },
      accountNumber: { type: String, required: true },
      ifscCode: { type: String, required: true },
      bankName: { type: String, required: true },
      upiId: { type: String },
    },
    transactionReference: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

settlementRequestSchema.index({ technicianId: 1, status: 1, createdAt: -1 });

export default mongoose.model<SettlementRequest>('SettlementRequest', settlementRequestSchema);
