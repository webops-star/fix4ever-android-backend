import mongoose, { Document, Schema, Types } from 'mongoose';

const DraftServiceRequestSchema: Schema = new Schema({
  // User identification (can be null for unauthenticated users)
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: false }, // Will be set when user logs in
  sessionId: { type: String, required: false }, // For tracking unauthenticated users

  // Basic form data from home page
  address: { type: String, required: false },
  city: { type: String, required: false },
  brand: { type: String, required: false },
  model: { type: String, required: false },
  problemDescription: { type: String, required: false },

  // Enhanced fields that might be filled later
  userName: { type: String, required: false },
  userPhone: { type: String, required: false },
  requestType: {
    type: String,
    enum: ['self', 'other'],
    default: 'self',
  },
  serviceType: {
    type: String,
    enum: ['pickup-drop', 'visit-shop', 'onsite'],
    default: 'pickup-drop',
  },

  // Beneficiary details (if request is for someone else)
  beneficiaryName: { type: String },
  beneficiaryPhone: { type: String },

  // Location data
  customerLocation: {
    latitude: { type: Number, required: false },
    longitude: { type: Number, required: false },
  },
  location: {
    address: { type: String },
    lat: { type: Number },
    lng: { type: Number },
  },

  // Additional fields
  preferredDate: { type: String },
  preferredTime: { type: String },
  budget: { type: Number, default: 0 },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  },
  isUrgent: { type: Boolean, default: false },

  // Pricing fields
  issueLevel: {
    type: String,
    enum: ['software', 'hardware', 'board'],
    default: 'software',
  },
  urgency: {
    type: String,
    enum: ['standard', 'express', 'urgent'],
    default: 'standard',
  },

  // Problem knowledge fields
  problemType: { type: String }, // Problem type value
  problemTypeLabel: { type: String }, // Problem type label for display
  knowsProblem: { type: Boolean, default: false }, // true = "Yes, I know the problem", false = "No, I'm not sure"

  // Time slot selection
  selectedDate: { type: String },
  selectedTimeSlot: { type: String },

  // Uploaded images (with metadata)
  issueImages: [{ type: String }], // URLs to uploaded images

  // Current step tracking
  currentStep: { type: Number, default: 0 }, // Current step index (0-based)
  currentStepKey: { type: String }, // Current step key/id for easier reference

  // Draft status and metadata
  status: {
    type: String,
    enum: ['DRAFT', 'SUBMITTED'],
    default: 'DRAFT',
  },
  isCompleted: { type: Boolean, default: false }, // Whether draft has been converted to actual service request (deprecated, use status)
  convertedToServiceRequestId: { type: Schema.Types.ObjectId, ref: 'ServiceRequest' }, // Link to actual service request if converted
  completionPercentage: { type: Number, default: 0 }, // How much of the form is filled (0-100)

  // Additional pricing fields
  wantsWarranty: { type: Boolean, default: false },
  wantsDataSafety: { type: Boolean, default: false },
  calculatedPricing: { type: Schema.Types.Mixed },
  aiPredictions: [{ type: Schema.Types.Mixed }],
  selectedProblem: { type: Schema.Types.Mixed },
  aiPredicted: { type: Boolean, default: false },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // Expire after 7 days
});

// Index for efficient queries
DraftServiceRequestSchema.index({ customerId: 1, createdAt: -1 });
DraftServiceRequestSchema.index({ sessionId: 1, createdAt: -1 });
DraftServiceRequestSchema.index(
  { expiresAt: 1 },
  {
    name: 'draft_expiresAt_ttl',
    expireAfterSeconds: 0,
    partialFilterExpression: { status: 'DRAFT' },
  }
);
DraftServiceRequestSchema.index({ isCompleted: 1 });
DraftServiceRequestSchema.index({ status: 1 }); // Index for status filtering
DraftServiceRequestSchema.index({ customerId: 1, status: 1 }); // Compound index for user drafts

// Auto-update updatedAt field
DraftServiceRequestSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('DraftServiceRequest', DraftServiceRequestSchema);
