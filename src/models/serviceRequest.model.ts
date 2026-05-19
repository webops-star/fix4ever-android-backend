import mongoose, { Document, Schema, Types } from 'mongoose';
import { generateRequestId } from '../utils/requestIdGenerator';

const ServiceRequestSchema: Schema = new Schema({
  request_id: { type: String, unique: true, sparse: true, index: true },
  customerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' }, // Link to the customer (User) who made the request

  // Enhanced user contact and request details
  userName: { type: String }, // User's name (required when requestType is 'self')
  userPhone: { type: String }, // User's phone number (required when requestType is 'self')
  requestType: {
    type: String,
    enum: ['self', 'other'],
    required: true,
    default: 'self',
  }, // Whether request is for themselves or someone else
  serviceType: {
    type: String,
    enum: ['pickup-drop', 'visit-shop', 'onsite'],
    required: true,
    default: 'pickup-drop',
  }, // Type of service requested

  // Beneficiary details (if request is for someone else)
  beneficiaryName: { type: String }, // Name of the person needing service (required when requestType is 'other')
  beneficiaryPhone: { type: String }, // Phone of the person needing service (required when requestType is 'other')

  // Existing location fields
  address: { type: String },
  customerLocation: {
    // Static location of the customer
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  city: { type: String, required: true },

  // Device information
  brand: { type: String, required: true },
  model: { type: String, required: true },
  problemDescription: { type: String },
  issueImages: [{ type: String }], // URLs to uploaded images

  // Additional fields for frontend compatibility
  title: { type: String },
  description: { type: String },
  category: { type: String },
  deviceType: { type: String },
  deviceBrand: { type: String },
  deviceModel: { type: String },
  problemType: { type: String, enum: ['known', 'unknown'] }, // Whether user knows the problem or not
  knowsProblem: { type: Boolean, default: false }, // true = "Yes, I know the problem", false = "No, I'm not sure"
  budget: { type: Number, default: 0 },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  },
  isUrgent: { type: Boolean, default: false },
  preferredDate: { type: String },
  preferredTime: { type: String },

  // Service tracking fields
  technicianNotes: { type: String }, // Notes from technician about the repair
  selectedComponents: [{ type: Schema.Types.Mixed }], // Components selected for replacement
  componentCost: { type: Number, default: 0 }, // Total cost of selected components
  requiresCustomerApproval: { type: Boolean, default: false }, // Whether customer approval is needed
  customerApproved: { type: Boolean, default: false }, // Whether customer has approved
  statusHistory: [
    {
      status: { type: String },
      timestamp: { type: Date, default: Date.now },
      notes: { type: String },
      updatedBy: { type: String }, // 'technician' or 'customer'
    },
  ], // Track status changes over time

  // Location object for frontend compatibility
  location: {
    address: { type: String },
    lat: { type: Number },
    lng: { type: Number },
  },

  assignedTechnician: { type: Schema.Types.ObjectId, ref: 'Vendor' }, // Link to the assigned Technician
  assignedVendor: { type: Schema.Types.ObjectId, ref: 'Vendor' }, // Alias for assignedTechnician for compatibility
  assignedCaptain: { type: Schema.Types.ObjectId, ref: 'Captain' }, // Link to the assigned Captain for pickup
  status: {
    type: String,
    enum: [
      'Pending',
      'Assigned',
      'In Progress',
      'Completed',
      'Cancelled',
      'Expired',
      'Pending Verification',
      'Scheduled',
      'Pickup Requested',
      'Pickup Initiated',
      'Captain Reached Customer',
      'Pickup Done',
      'Captain Reached Vendor (Pickup)',
      'Handover to Vendor',
      'Device Received',
      'Problem Verification',
      'Repair', // Alias for 'Repair Started' (used by frontend)
      'Repair Started',
      'Repair Done',
      'Drop Requested',
      'Drop Initiated',
      'Captain Reached Vendor',
      'Handover to Captain',
      'Captain Pickup Done',
      'Device Delivered',
      'Completed',
      'Problem Identification',
      'Identification Done',
      'Admin Review Pending', // New: After vendor submits identification
      'Customer Approval Pending', // New: After admin approves and sets price
      'Arrived at Shop', // Visit-Shop: vendor marks customer arrived / device at shop
    ],
    default: 'Pending',
  },

  // Timer functionality for 30-minute vendor acceptance window
  timerStartedAt: { type: Date, default: Date.now },
  timerExpiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000) }, // 30 minutes from now
  isTimerActive: { type: Boolean, default: true },

  // Identification timer for unknown problems (3 hours after pickup)
  identificationTimerStartedAt: { type: Date },
  identificationTimerExpiresAt: { type: Date },
  isIdentificationTimerActive: { type: Boolean, default: false },

  // Verification timer for known problems (1 hour after device received)
  verificationTimer: {
    startTime: { type: Date },
    duration: { type: Number }, // Duration in minutes
    isActive: { type: Boolean, default: false },
    expiresAt: { type: Date },
    endTime: { type: Date },
  },

  // Vendor acceptance tracking
  acceptedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  acceptedAt: { type: Date },

  // Scheduling fields
  scheduledDate: { type: Date }, // Date scheduled by user or vendor
  scheduledTime: { type: String }, // Time scheduled (e.g., "14:00", "2:00 PM", "09:00 - 12:00")
  scheduledSlot: { type: String }, // Slot-based scheduling - can be 'morning', 'evening', '9-12', '12-15', '15-18', etc.
  startTime: { type: String }, // Start time of the slot (e.g., "10:00", "09:00")
  endTime: { type: String }, // End time of the slot (e.g., "15:00", "12:00")
  availableSlots: [{ type: String }], // Available time slots for customer to choose from
  userSelectedDate: { type: Date }, // Date selected by user during request creation
  userSelectedTimeSlot: { type: String }, // Time slot selected by user (e.g., '9-12', '12-15', '15-18')
  scheduleStatus: {
    type: String,
    enum: [
      'pending',
      'scheduled',
      'accepted',
      'rejected',
      'cancelled',
      'pickup_scheduled',
      'pickup_confirmed',
      'pickup_completed',
      'drop_scheduled',
      'drop_completed',
      'proposed',
    ],
    default: 'pending',
  },
  scheduleNotes: { type: String }, // Any notes from vendor about the schedule
  userResponse: {
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    respondedAt: { type: Date },
    userNotes: { type: String }, // Any notes from user about acceptance/rejection
  },
  scheduleNotificationSent: { type: Boolean, default: false }, // Track if notification was sent to user

  // Pickup/Drop tracking for pickup-drop service type
  pickupDetails: {
    scheduledDate: { type: Date }, // Pickup date
    scheduledTime: { type: String }, // Pickup time
    actualPickupTime: { type: Date }, // When pickup actually happened
    pickupConfirmed: { type: Boolean, default: false }, // Vendor confirms pickup
    pickupNotes: { type: String }, // Any notes about pickup
    pickupLocation: {
      address: { type: String },
      latitude: { type: Number },
      longitude: { type: Number },
    },
  },
  dropDetails: {
    scheduledDate: { type: Date }, // Drop date
    scheduledTime: { type: String }, // Drop time
    actualDropTime: { type: Date }, // When drop actually happened
    dropConfirmed: { type: Boolean, default: false }, // Vendor confirms drop
    dropNotes: { type: String }, // Any notes about drop
    dropLocation: {
      address: { type: String },
      latitude: { type: Number },
      longitude: { type: Number },
    },
  },

  // Repair tracking fields
  repairDetails: {
    problemIdentified: { type: Boolean, default: false }, // Whether vendor identified the problem
    problemDescription: { type: String }, // Vendor's description of the actual problem
    repairStarted: { type: Boolean, default: false }, // When repair work begins
    repairCompleted: { type: Boolean, default: false }, // When repair work is done
    repairNotes: { type: String }, // Notes about the repair process
    partsUsed: [{ type: String }], // List of parts used in repair
    estimatedCost: { type: Number }, // Estimated repair cost
    actualCost: { type: Number }, // Actual repair cost
  },

  // Vendor-specific pricing (automatically set, non-editable)
  vendorServiceCharge: { type: Number }, // Total amount charged by vendor
  vendorPriceBreakdown: {
    baseServiceCharge: { type: Number }, // Base service charge from vendor's settings
    partsCost: { type: Number, default: 0 }, // Cost of parts (if any)
    travelCost: { type: Number, default: 0 }, // Travel cost based on distance
    emergencyFee: { type: Number, default: 0 }, // Emergency fee if urgent
    totalAmount: { type: Number }, // Total calculated amount
  },

  // Calculated pricing from customer's request (stored during creation)
  calculatedPricing: {
    serviceChargeRange: {
      min: { type: Number },
      max: { type: Number },
    },
    netChargeRange: {
      min: { type: Number },
      max: { type: Number },
    },
    fixedFee: { type: Number, default: 0 },
    serviceTypeFee: { type: Number, default: 0 },
    warrantyFee: { type: Number, default: 0 },
    urgencyFee: { type: Number, default: 0 },
    dataSafetyFee: { type: Number, default: 0 },
    finalChargeRange: {
      min: { type: Number },
      max: { type: Number },
    },
    breakdown: [{ type: String }],
    // Store selected options for reference
    problemType: { type: String },
    issueLevel: { type: String },
    serviceType: { type: String },
    warrantyOption: { type: String },
    urgencyLevel: { type: String },
    dataSafety: { type: Boolean },
  },

  // Admin final pricing (set when repair is done)
  adminFinalPrice: { type: Number }, // Final price set by admin when repair is completed
  adminPricingNotes: { type: String }, // Notes from admin about final pricing
  adminPricingSetAt: { type: Date }, // When admin set the final price
  adminPricingSetBy: { type: Schema.Types.ObjectId, ref: 'User' }, // Which admin set the price

  // Admin component charges (added separately by admin)
  adminComponentCharges: { type: Number, default: 0 }, // Component replacement cost added by admin
  adminComponentNotes: { type: String }, // Notes about components used

  // Captain delivery charge for visit-shop requests (₹150 when customer chooses captain delivery)
  visitShopDeliveryCharge: { type: Number, default: 0 },

  paymentBreakdown: {
    // Base service cost (from net charge, set by admin within range)
    serviceCost: { type: Number, default: 0 },
    // Component cost (added by admin)
    componentCost: { type: Number, default: 0 },
    // Pickup/drop fee (from calculatedPricing.serviceTypeFee if pickup-drop)
    pickupCost: { type: Number, default: 0 },
    // Captain delivery charge for visit-shop requests (₹150)
    deliveryCost: { type: Number, default: 0 },
    // Emergency/urgency charges
    emergencyCharges: { type: Number, default: 0 },
    // Warranty charges
    warrantyCharges: { type: Number, default: 0 },
    // Data safety charges
    dataSafetyCharges: { type: Number, default: 0 },
    // Total cost (repair cost + deliveryCost for visit-shop captain delivery)
    totalCost: { type: Number, default: 0 },
    // Technician charges (what technician actually worked for — excludes delivery and pickup)
    technicianCharges: { type: Number, default: 0 },
    // Technician earnings (80% of technician charges)
    technicianEarnings: { type: Number, default: 0 },
    // Company commission (20% of technician charges)
    companyCommission: { type: Number, default: 0 },
  },

  // Payment Flow - Vendor initiates after service completion
  paymentStatus: {
    type: String,
    enum: ['pending', 'vendor_initiated', 'user_paid', 'vendor_approved', 'completed'],
    default: 'pending',
  },
  paymentInitiatedAt: { type: Date }, // When vendor initiates payment
  paymentInitiatedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' }, // Which vendor initiated
  userPaidAt: { type: Date }, // When user made payment
  vendorApprovedAt: { type: Date }, // When vendor approves payment
  paymentReceipt: { type: String }, // Receipt URL after vendor approval
  paymentNotes: { type: String }, // Any notes from vendor about payment

  // Verification data for unknown problems
  verificationData: {
    deviceSymptoms: { type: String },
    attemptedSolutions: { type: String },
    urgency: { type: String, enum: ['low', 'medium', 'high'] },
    preferredContactTime: { type: String },
    submittedAt: { type: Date },
    adminReviewStatus: {
      type: String,
      enum: ['pending', 'reviewed', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String },
    estimatedPricing: { type: Number },
    adminNotes: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },

  // Problem identification for unknown problems (pickup-drop only)
  problemIdentification: {
    identifiedProblem: { type: String },
    identifiedAt: { type: Date },
    identifiedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    identificationNotes: { type: String },
    estimatedRepairTime: { type: String },
    estimatedCost: { type: Number },
    customerApproval: {
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      approvedAt: { type: Date },
      rejectedAt: { type: Date },
      rejectionReason: { type: String },
      customerNotes: { type: String },
    },
    // Pricing breakdown for customer approval
    pricingBreakdown: {
      pickupCharge: { type: Number, default: 0 },
      repairCost: { type: Number, default: 0 },
      dropCharge: { type: Number, default: 0 },
      totalCost: { type: Number, default: 0 },
      fixedCharge: { type: Number, default: 0 }, // Fixed charge for pickup-drop service
    },
  },

  // Admin review of vendor identification (new admin-mediated flow)
  adminReviewedIdentification: {
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // Admin who reviewed
    reviewedAt: { type: Date },
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'needs_revision'],
      default: 'pending',
    },
    adminNotes: { type: String }, // Internal admin notes (not shown to customer)
    customerPrice: { type: Number }, // Price admin sets for customer to see
    vendorPrice: { type: Number }, // What vendor requested (for reference)
    adminAdjustments: { type: String }, // Explanation of price changes (shown to customer)
  },

  // Captain pickup fields
  captainPickupRequest: {
    requestedAt: { type: Date },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' }, // Technician who requested pickup
    pickupAddress: { type: String },
    pickupCoordinates: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    pickupNotes: { type: String },
    estimatedPickupTime: { type: Date },
    captainNotes: { type: String },
    deliveryNotes: { type: String },
    status: {
      type: String,
      enum: [
        'pending',
        'assigned',
        'reached_customer',
        'pickup_done',
        'reached_vendor',
        'handover_to_vendor',
        'in_progress',
        'completed',
        'cancelled',
        'rejected',
      ],
    },
    captainId: { type: Schema.Types.ObjectId, ref: 'Captain' }, // Captain who accepted this pickup trip
    reachedCustomerAt: { type: Date },
    reachedVendorAt: { type: Date }, // For first drop phase (after pickup from customer)
    handoverToVendorAt: { type: Date }, // For first drop phase (after pickup from customer)
    rejectionReason: { type: String },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'Captain' },
    rejectedAt: { type: Date },
  },

  // Captain drop request fields
  captainDropRequest: {
    requestedAt: { type: Date },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' }, // Vendor who requested drop
    vendorAddress: { type: String },
    vendorCoordinates: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    customerAddress: { type: String },
    customerCoordinates: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    dropNotes: { type: String },
    estimatedDropTime: { type: Date },
    captainNotes: { type: String },
    deliveryNotes: { type: String },
    status: {
      type: String,
      enum: [
        'pending',
        'assigned',
        'reached_vendor',
        'handover_complete',
        'pickup_done',
        'in_progress',
        'completed',
        'cancelled',
        'rejected',
      ],
    },
    captainId: { type: Schema.Types.ObjectId, ref: 'Captain' }, // Captain who accepted this drop trip
    reachedVendorAt: { type: Date },
    handoverCompletedAt: { type: Date },
    pickupDoneAt: { type: Date },
    rejectionReason: { type: String },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'Captain' },
    rejectedAt: { type: Date },
  },

  // Pickup Consent — vendor asks customer before dispatching captain for pickup
  pickupConsent: {
    status: {
      type: String,
      enum: [
        'none',
        'vendor_requested',
        'customer_confirmed_now',
        'slot_pending_admin',
        'slot_approved',
        'slot_rejected_reselect',
      ],
      default: 'none',
    },
    vendorRequestedAt: { type: Date },
    customerResponse: { type: String, enum: ['now', 'slot', null], default: null },
    customerRespondedAt: { type: Date },
    selectedSlot: {
      date: { type: String },
      timeSlot: { type: String },
    },
    slotSubmittedAt: { type: Date },
    adminNotes: { type: String },
    adminReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    adminReviewedAt: { type: Date },
    approvedSlot: {
      date: { type: String },
      timeSlot: { type: String },
    },
  },

  // Drop Consent — vendor asks customer before dispatching captain for drop (return delivery)
  dropConsent: {
    status: {
      type: String,
      enum: [
        'none',
        'vendor_requested',
        'customer_confirmed_now',
        'slot_pending_admin',
        'slot_approved',
        'slot_rejected_reselect',
      ],
      default: 'none',
    },
    vendorRequestedAt: { type: Date },
    customerResponse: { type: String, enum: ['now', 'slot', null], default: null },
    customerRespondedAt: { type: Date },
    selectedSlot: {
      date: { type: String },
      timeSlot: { type: String },
    },
    slotSubmittedAt: { type: Date },
    adminNotes: { type: String },
    adminReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    adminReviewedAt: { type: Date },
    approvedSlot: {
      date: { type: String },
      timeSlot: { type: String },
    },
  },

  // Onsite Consent — vendor asks customer "Should I come now?" before marking Arrived at Location
  onsiteConsent: {
    status: {
      type: String,
      enum: [
        'none',
        'vendor_requested',
        'customer_confirmed_now',
        'slot_pending_admin',
        'slot_approved',
        'slot_rejected_reselect',
      ],
      default: 'none',
    },
    vendorRequestedAt: { type: Date },
    customerResponse: { type: String, enum: ['now', 'slot', null], default: null },
    customerRespondedAt: { type: Date },
    selectedSlot: {
      date: { type: String },
      timeSlot: { type: String },
    },
    slotSubmittedAt: { type: Date },
    adminNotes: { type: String },
    adminReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    adminReviewedAt: { type: Date },
    approvedSlot: {
      date: { type: String },
      timeSlot: { type: String },
    },
  },

  // Visit-Shop post-repair delivery preference
  postRepairDeliveryPreference: {
    type: String,
    default: null,
    required: false,
    validate: {
      validator: function (value: any) {
        // Allow null/undefined or valid enum values
        if (value === null || value === undefined) return true;
        return ['self-pickup', 'captain-delivery'].includes(value);
      },
      message: 'Delivery preference must be either self-pickup or captain-delivery',
    },
  },
  postRepairDeliveryChosenAt: { type: Date }, // When customer chose delivery method

  // Device Handover Verification Images
  deviceHandoverImages: {
    // Captain checkpoints
    customerPickup: {
      images: [{ type: String }], // S3 URLs
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Captain' },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      isComplete: { type: Boolean, default: false },
    },
    deliveryToTechnician: {
      images: [{ type: String }], // S3 URLs
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Captain' },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      isComplete: { type: Boolean, default: false },
    },
    returnPickupFromTechnician: {
      images: [{ type: String }], // S3 URLs
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Captain' },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      isComplete: { type: Boolean, default: false },
    },
    customerDelivery: {
      images: [{ type: String }], // S3 URLs
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Captain' },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      isComplete: { type: Boolean, default: false },
    },
    // Technician checkpoints
    deviceIntake: {
      images: [{ type: String }], // S3 URLs
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      isComplete: { type: Boolean, default: false },
    },
    postRepairCompletion: {
      images: [{ type: String }], // S3 URLs
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      isComplete: { type: Boolean, default: false },
    },
    handoverToCaptain: {
      images: [{ type: String }], // S3 URLs
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'Vendor' },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      isComplete: { type: Boolean, default: false },
    },
  },

  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  // ===== NEW STRUCTURED PROBLEM FIELDS (v2) =====
  // Replaces legacy flat problemType/problemDescription for new service requests.
  // Old records continue to use problemType/problemDescription above (legacy fallback still works).
  mainProblem: {
    id: { type: String },
    title: { type: String },
  },
  subProblem: {
    id: { type: String },
    title: { type: String },
  },
  relationalBehaviors: [
    new Schema(
      {
        id: { type: String },
        title: { type: String },
        level: { type: String },
        repair: { type: Boolean },
        replacement: { type: Boolean },
        pricing: {
          min_price: { type: Number },
          max_price: { type: Number },
          currency: { type: String },
        },
      },
      { _id: false }
    ),
  ],
  minPrice: { type: Number },
  maxPrice: { type: Number },
  level: { type: String },
  // ===== END NEW STRUCTURED PROBLEM FIELDS (v2) =====

  // ===== COUPON / REFERRAL FIELDS =====
  couponCode: { type: String, uppercase: true, trim: true },
  couponDiscount: { type: Number, default: 0 },
  couponUsageId: { type: Schema.Types.ObjectId, ref: 'CouponUsage' },
  walletAmountUsed: { type: Number, default: 0 },
  // ===== END COUPON / REFERRAL FIELDS =====
});

// Auto-generate human-readable request_id on first save
ServiceRequestSchema.pre('save', async function (next) {
  if (!this.request_id) {
    this.request_id = await generateRequestId();
  }
  next();
});

// Index for efficient timer queries
ServiceRequestSchema.index({ timerExpiresAt: 1, isTimerActive: 1 });
ServiceRequestSchema.index({ status: 1, isTimerActive: 1 });
ServiceRequestSchema.index({ assignedTechnician: 1 });
ServiceRequestSchema.index({ assignedVendor: 1 });
ServiceRequestSchema.index({ assignedCaptain: 1 });
// Index for scheduling queries
ServiceRequestSchema.index({ scheduleStatus: 1, scheduledDate: 1 });
ServiceRequestSchema.index({ assignedVendor: 1, scheduleStatus: 1 });
// Index for captain pickup queries
ServiceRequestSchema.index({ 'captainPickupRequest.status': 1 });
ServiceRequestSchema.index({ 'captainPickupRequest.requestedBy': 1 });

// CRITICAL: Indexes for customer dashboard and filtering
ServiceRequestSchema.index({ customerId: 1 }); // Customer's service requests
ServiceRequestSchema.index({ customerId: 1, status: 1 }); // Customer requests by status
ServiceRequestSchema.index({ customerId: 1, createdAt: -1 }); // Customer requests sorted by date

// Indexes for location-based and device searches
ServiceRequestSchema.index({ city: 1 }); // Location-based filtering
ServiceRequestSchema.index({ city: 1, status: 1, createdAt: -1 }); // City + status + date
ServiceRequestSchema.index({ brand: 1, model: 1 }); // Device lookup
ServiceRequestSchema.index({ requestType: 1 }); // Filter by request type

// Index for vendor/technician dashboard
ServiceRequestSchema.index({ assignedTechnician: 1, status: 1 }); // Vendor dashboard filtering

export default mongoose.model('ServiceRequest', ServiceRequestSchema);
