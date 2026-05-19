import mongoose, { Document, Schema } from 'mongoose';

export interface WorkshopTechnician extends Document {
  workshopId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  inviteEmail: string;
  inviteToken: string;
  inviteTokenExpiry: Date;
  personalInfo?: {
    fullName: string;
    email: string;
    phone: string;
    alternatePhone?: string;
    address: string;
  };
  idVerification?: {
    governmentIdType: string;
    governmentIdNumber: string;
    governmentIdProof: string;
    selfieVerification: string;
    verificationStatus: 'Pending' | 'Verified' | 'Rejected';
  };
  bankDetails?: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    branchName: string;
    accountType: 'Savings' | 'Current';
    cancelledCheque?: string;
  };
  onboardingStatus: 'Invited' | 'In Progress' | 'Submitted' | 'Approved' | 'Rejected';
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const workshopTechnicianSchema = new Schema<WorkshopTechnician>(
  {
    workshopId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    inviteEmail: { type: String, required: true },
    inviteToken: { type: String, required: true, unique: true },
    inviteTokenExpiry: { type: Date, required: true },
    personalInfo: {
      fullName: { type: String },
      email: { type: String },
      phone: { type: String },
      alternatePhone: { type: String },
      address: { type: String },
    },
    idVerification: {
      governmentIdType: { type: String },
      governmentIdNumber: { type: String },
      governmentIdProof: { type: String },
      selfieVerification: { type: String },
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'Rejected'],
        default: 'Pending',
      },
    },
    bankDetails: {
      accountHolderName: { type: String },
      accountNumber: { type: String },
      ifscCode: { type: String },
      bankName: { type: String },
      branchName: { type: String },
      accountType: { type: String, enum: ['Savings', 'Current'] },
      cancelledCheque: { type: String },
    },
    onboardingStatus: {
      type: String,
      enum: ['Invited', 'In Progress', 'Submitted', 'Approved', 'Rejected'],
      default: 'Invited',
    },
    submittedAt: { type: Date },
  },
  { timestamps: true }
);

workshopTechnicianSchema.index({ workshopId: 1 });
workshopTechnicianSchema.index({ inviteEmail: 1 });
workshopTechnicianSchema.index({ inviteToken: 1 });
workshopTechnicianSchema.index({ userId: 1 });

export default mongoose.model<WorkshopTechnician>('WorkshopTechnician', workshopTechnicianSchema);
