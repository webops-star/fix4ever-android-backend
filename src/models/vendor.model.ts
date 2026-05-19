import mongoose, { Document, Schema } from 'mongoose';

export interface Vendor extends Document {
  pocInfo: {
    userId: mongoose.Types.ObjectId;
    fullName: string;
    email: string;
    phone: string;
    alternatePhone?: string;
    correspondenceAddress: string;
    latitude?: number;
    longitude?: number;
  };
  interviewSchedule: {
    experience: { type: String };
    suitableDate?: Date;
    suitableTimeSlot: { type: String };
    technicianLevel: { type: String };
  };
  businessDetails?: {
    businessEntityType: string;
    businessName: string;
    entityNumber: string;
    registeredOfficeAddress: string;
    panCard: string;
    businessRegistrationProof: string; // URL to uploaded document
    website?: string;
    gstin?: string;
  };

  certification: {
    experienceCertificate: String;
    fixforeverCertificate: String;
  };
  idVerification?: {
    governmentIdType: string;
    governmentIdNumber: string;
    governmentIdProof: string; // URL to uploaded document
    panCardProof?: string; // URL to uploaded PAN card for verification
    selfieVerification: string; // URL to uploaded selfie
    verificationStatus: 'Pending' | 'Verified' | 'Rejected';
  };
  // certification?: {
  //   experienceCertificate?: string;
  //   fixforeverCertificate?: string;
  // };
  servicesOffered?: {
    hardwareRepairServices: Array<{
      deviceType: string;
      serviceType: string;
      estimatedTime: string;
      priceRange: {
        min: number;
        max: number;
      };
      calculatedPrice?: {
        software: number;
        hardware: number;
        board: number;
      };
    }>;
    warrantyPeriod: string;
    emergencyServices: boolean;
    onSiteServices: boolean;
  };
  operationalDetails?: {
    workingHours: {
      start: string;
      end: string;
    };
    workingDays: string[];
    serviceAreas: string[];
    maxServiceRadius: number;
    teamSize: number;
    equipmentOwned: string[];
    paymentMethods: string[];
    minimumCharges: number;
  };
  bankDetails?: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    branchName: string;
    accountType: 'Savings' | 'Current';
    cancelledCheque?: string; // URL to uploaded cancelled cheque
  };
  TotalMarks: number;

  Level: 'L1' | 'L2' | 'L3' | 'L4' | null;

  onboardingStatus:
    | 'Not Started'
    | 'In Progress'
    | 'In Review'
    | 'Approved'
    | 'Rejected'
    | 'Pending'
    | 'Draft';
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewComments?: string;
  clarificationRequested?: boolean;
  clarificationRequestedAt?: Date;

  // Draft step tracking (store in Vendor schema only - like captains)
  currentStep?: number;
  currentStepKey?: string;

  // Rating and Review Information
  averageRating: number;
  totalReviews: number;
  ratingBreakdown: {
    serviceQuality: number;
    communication: number;
    punctuality: number;
    overallExperience: number;
  };
  ratingDistribution: {
    [key: string]: number; // Rating value (1-5) -> count
  };
  currentLocation?: {
    latitude: number;
    longitude: number;
    lastUpdated?: Date;
  };
  termsAndConditionsAccepted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const vendorSchema = new Schema<Vendor>(
  {
    //marks

    TotalMarks: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    Level: {
      type: String,
      enum: ['L1', 'L2', 'L3', 'L4', null],
      default: null,
    },
    interviewSchedule: {
      experience: { type: String },
      suitableDate: { type: Date },
      suitableTimeSlot: { type: String },
      technicianLevel: { type: String },
    },
    pocInfo: {
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      fullName: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      alternatePhone: { type: String },
      correspondenceAddress: { type: String, required: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    businessDetails: {
      businessEntityType: { type: String },
      businessName: { type: String },
      entityNumber: { type: String },
      registeredOfficeAddress: { type: String },
      panCard: { type: String },
      businessRegistrationProof: { type: String },
      website: { type: String },
      gstin: { type: String },
    },

    idVerification: {
      governmentIdType: { type: String },
      governmentIdNumber: { type: String },
      governmentIdProof: { type: String },
      panCardProof: { type: String },
      selfieVerification: { type: String },
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'Rejected'],
        default: 'Pending',
      },
    },
    servicesOffered: {
      hardwareRepairServices: [
        {
          deviceType: { type: String },
          serviceType: { type: String },
          estimatedTime: { type: String },
          priceRange: {
            min: { type: Number },
            max: { type: Number },
          },
          calculatedPrice: {
            software: { type: Number },
            hardware: { type: Number },
            board: { type: Number },
          },
        },
      ],
      warrantyPeriod: { type: String },
      emergencyServices: { type: Boolean, default: false },
      onSiteServices: { type: Boolean, default: false },
    },
    operationalDetails: {
      workingHours: {
        start: { type: String },
        end: { type: String },
      },
      workingDays: [{ type: String }],
      serviceAreas: [{ type: String }],
      maxServiceRadius: { type: Number },
      teamSize: { type: Number },
      equipmentOwned: [{ type: String }],
      paymentMethods: [{ type: String }],
      minimumCharges: { type: Number },
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
    certification: {
      experienceCertificate: { type: String },
      fixforeverCertificate: { type: String },
    },
    onboardingStatus: {
      type: String,
      enum: ['Not Started', 'In Progress', 'In Review', 'Approved', 'Rejected', 'Pending', 'Draft'],
      default: 'Not Started',
    },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewComments: { type: String },

    // Draft step tracking (Vendor schema only - like captains)
    currentStep: { type: Number },
    currentStepKey: { type: String },

    // Rating and Review Information
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    ratingBreakdown: {
      serviceQuality: { type: Number, default: 0 },
      communication: { type: Number, default: 0 },
      punctuality: { type: Number, default: 0 },
      overallExperience: { type: Number, default: 0 },
    },
    ratingDistribution: {
      type: Map,
      of: Number,
      default: () =>
        new Map([
          ['1', 0],
          ['2', 0],
          ['3', 0],
          ['4', 0],
          ['5', 0],
        ]),
    },

    currentLocation: {
      type: {
        latitude: { type: Number },
        longitude: { type: Number },
        lastUpdated: { type: Date },
      },
      required: false,
      default: undefined,
    },
    termsAndConditionsAccepted: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

// Create indexes for better query performance
vendorSchema.index({ 'pocInfo.userId': 1 });
vendorSchema.index({ 'pocInfo.email': 1 });
vendorSchema.index({ onboardingStatus: 1 });
vendorSchema.index({ createdAt: -1 });

// Additional indexes for common queries
vendorSchema.index({ 'idVerification.verificationStatus': 1 }); // Filter by verification status
vendorSchema.index({ 'operationalDetails.serviceAreas': 1 }); // Filter by service areas

// Pre-save hook to handle null values for Level field
vendorSchema.pre('save', function (next) {
  const doc = this as unknown as Vendor;
  // Convert null to 'L1' (default) for Level field to avoid enum validation error
  if (doc.Level === null) {
    doc.Level = 'L1'; // Use default value 'L1' instead of null
  }
  next();
});

vendorSchema.post('save', async function (doc: Vendor) {
  if (doc.onboardingStatus === 'Approved') {
    try {
      const TechnicianWallet = (await import('./technicianWallet.model')).default;
      const existingWallet = await TechnicianWallet.findOne({ technicianId: doc._id });
      if (!existingWallet) {
        await TechnicianWallet.create({
          technicianId: doc._id,
          balance: 0,
          totalEarned: 0,
          totalWithdrawn: 0,
          pendingSettlement: 0,
          isActive: true,
        });
        console.log(`✅ Wallet created for approved vendor: ${doc._id}`);
      }
    } catch (error) {
      console.error('Failed to create wallet for vendor:', error);
    }
  }
});

export default mongoose.model<Vendor>('Vendor', vendorSchema);
