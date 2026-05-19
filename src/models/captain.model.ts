import mongoose, { Document, Schema } from 'mongoose';

export interface Captain extends Document {
  personalInfo: {
    userId: mongoose.Types.ObjectId;
    fullName: string;
    email: string;
    phone: string;
    alternatePhone?: string;
    residentialAddress: string;
    latitude?: number;
    longitude?: number;
  };

  vehicleDetails?: {
    vehicleType: string;
    vehicleBrand: string;
    vehicleModel: string;
    vehicleYear: number;
    licensePlate: string;
    vehicleColor: string;
    registrationCertificate: string; // URL to uploaded document
    insuranceDocument: string; // URL to uploaded document
    vehiclePhotos: string[]; // URLs to uploaded photos
  };

  drivingLicenseDetails?: {
    licenseNumber: string;
    issueDate: Date;
    expiryDate: Date;
    licenseClass: string;
    licensePhoto: string; // URL to uploaded document
    isCommercial: boolean;
  };

  identityVerification?: {
    governmentIdType: string;
    governmentIdNumber: string;
    governmentIdProof: string; // URL to uploaded document
    selfieVerification: string; // URL to uploaded selfie
    verificationStatus: 'Pending' | 'Verified' | 'Rejected';
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

  servicePreferences?: {
    workingHours: {
      start: string;
      end: string;
    };
    workingDays: string[];
    serviceAreas: string[];
    maxTravelDistance: number;
    vehicleCapacityKg: number;
    specialHandling: string[];
    preferredPaymentMethods: string[];
  };

  onboardingStatus: 'Not Started' | 'In Progress' | 'In Review' | 'Approved' | 'Rejected';
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewComments?: string;

  // Rating and Review Information
  averageRating: number;
  totalReviews: number;
  ratingBreakdown: {
    drivingSkill: number;
    communication: number;
    punctuality: number;
    carefulness: number;
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

  availability: 'Available' | 'On Trip' | 'Offline';
  termsAndConditionsAccepted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const captainSchema = new Schema<Captain>(
  {
    personalInfo: {
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      fullName: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      alternatePhone: { type: String },
      residentialAddress: { type: String, required: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },

    vehicleDetails: {
      vehicleType: { type: String },
      vehicleBrand: { type: String },
      vehicleModel: { type: String },
      vehicleYear: { type: Number },
      licensePlate: { type: String },
      vehicleColor: { type: String },
      registrationCertificate: { type: String },
      insuranceDocument: { type: String },
      vehiclePhotos: [{ type: String }],
    },

    drivingLicenseDetails: {
      licenseNumber: { type: String },
      issueDate: { type: Date },
      expiryDate: { type: Date },
      licenseClass: { type: String },
      licensePhoto: { type: String },
      isCommercial: { type: Boolean, default: false },
    },

    identityVerification: {
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

    servicePreferences: {
      workingHours: {
        start: { type: String },
        end: { type: String },
      },
      workingDays: [{ type: String }],
      serviceAreas: [{ type: String }],
      maxTravelDistance: { type: Number },
      vehicleCapacityKg: { type: Number },
      specialHandling: [{ type: String }],
      preferredPaymentMethods: [{ type: String }],
    },

    onboardingStatus: {
      type: String,
      enum: ['Not Started', 'In Progress', 'In Review', 'Approved', 'Rejected'],
      default: 'Not Started',
    },

    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewComments: { type: String },

    // Rating and Review Information
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    ratingBreakdown: {
      drivingSkill: { type: Number, default: 0 },
      communication: { type: Number, default: 0 },
      punctuality: { type: Number, default: 0 },
      carefulness: { type: Number, default: 0 },
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
      latitude: { type: Number },
      longitude: { type: Number },
      lastUpdated: { type: Date, default: Date.now },
    },

    availability: {
      type: String,
      enum: ['Available', 'On Trip', 'Offline'],
      default: 'Offline',
    },

    termsAndConditionsAccepted: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

// Create indexes for better query performance
captainSchema.index({ 'personalInfo.userId': 1 });
captainSchema.index({ 'personalInfo.email': 1 });
captainSchema.index({ onboardingStatus: 1 });
captainSchema.index({ createdAt: -1 });
captainSchema.index({ availability: 1 });

// Geospatial index for location-based captain assignment
captainSchema.index({ currentLocation: '2dsphere' }); // For nearby captain searches

// Additional indexes for filtering
captainSchema.index({ 'identityVerification.verificationStatus': 1 }); // Filter by verification
captainSchema.index({ 'servicePreferences.preferredAreas': 1 }); // Filter by service areas

export default mongoose.model<Captain>('Captain', captainSchema);
