import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentTransaction extends Document {
  vendorId: mongoose.Types.ObjectId;
  serviceRequestId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  amount: number;
  platformFee: number;
  vendorEarnings: number;
  status:
    | 'Pending'
    | 'Requested'
    | 'Processing'
    | 'Completed'
    | 'Failed'
    | 'Refunded'
    | 'Cancelled';
  paymentMethod: 'Cashfree' | 'UPI' | 'Card' | 'Net Banking';

  // Payment Gateway Integration
  gatewayProvider: 'Cashfree' | 'Razorpay' | 'Paytm' | 'Manual';
  gatewayTransactionId?: string;
  gatewayOrderId?: string;
  gatewayResponse?: any;

  // Payment Request Details
  paymentRequestSentAt?: Date;
  paymentRequestExpiresAt?: Date;
  paymentLink?: string;
  paymentSessionId?: string;
  paymentDescription?: string;

  // Vendor Earnings & Payout
  earningsStatus: 'Pending' | 'Available' | 'Paid' | 'Held';
  payoutId?: string;
  payoutDate?: Date;

  // Timing & Tracking
  paymentInitiatedAt?: Date;
  paymentCompletedAt?: Date;
  refundedAt?: Date;

  // Additional Details
  failureReason?: string;
  refundReason?: string;
  customerNotes?: string;
  vendorNotes?: string;

  // Security & Compliance
  ipAddress?: string;
  userAgent?: string;
  fraudScore?: number;

  // Coupon discount applied to this payment
  couponCode?: string;
  couponDiscount?: number;

  // Wallet amount used for this payment
  walletAmountUsed?: number;

  // GST Breakdown (for invoices)
  gstBreakdown?: {
    baseAmount: number;
    gstAmount: number;
    gstRate: number; // GST rate in percentage (e.g., 18)
  };

  createdAt: Date;
  updatedAt: Date;
}

const PaymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    serviceRequestId: { type: Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Amount breakdown
    amount: { type: Number, required: true },
    platformFee: { type: Number, required: true, default: 0 },
    vendorEarnings: { type: Number, required: true },

    // Payment status
    status: {
      type: String,
      enum: ['Pending', 'Requested', 'Processing', 'Completed', 'Failed', 'Refunded', 'Cancelled'],
      default: 'Pending',
      required: true,
    },

    // Payment method
    paymentMethod: {
      type: String,
      enum: ['Cashfree', 'UPI', 'Card', 'Net Banking'],
      default: 'Cashfree',
      required: true,
    },

    // Payment Gateway Integration
    gatewayProvider: {
      type: String,
      enum: ['Cashfree', 'Razorpay', 'Paytm', 'Manual'],
      default: 'Cashfree',
      required: true,
    },
    gatewayTransactionId: { type: String, sparse: true },
    gatewayOrderId: { type: String, sparse: true },
    gatewayResponse: { type: Schema.Types.Mixed },

    // Payment Request Details
    paymentRequestSentAt: { type: Date },
    paymentRequestExpiresAt: { type: Date },
    paymentLink: { type: String },
    paymentSessionId: { type: String },
    paymentDescription: { type: String },

    // Vendor Earnings & Payout
    earningsStatus: {
      type: String,
      enum: ['Pending', 'Available', 'Paid', 'Held'],
      default: 'Pending',
      required: true,
    },
    payoutId: { type: String },
    payoutDate: { type: Date },

    // Timing & Tracking
    paymentInitiatedAt: { type: Date },
    paymentCompletedAt: { type: Date },
    refundedAt: { type: Date },

    // Additional Details
    failureReason: { type: String },
    refundReason: { type: String },
    customerNotes: { type: String },
    vendorNotes: { type: String },

    // Security & Compliance
    ipAddress: { type: String },
    userAgent: { type: String },
    fraudScore: { type: Number, default: 0 },

    // Coupon discount applied
    couponCode: { type: String },
    couponDiscount: { type: Number, default: 0 },

    // Wallet amount used
    walletAmountUsed: { type: Number, default: 0 },

    // GST Breakdown (for invoices)
    gstBreakdown: {
      baseAmount: { type: Number },
      gstAmount: { type: Number },
      gstRate: { type: Number }, // GST rate in percentage (e.g., 18)
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better performance
PaymentTransactionSchema.index({ vendorId: 1, createdAt: -1 });
PaymentTransactionSchema.index({ serviceRequestId: 1 });
PaymentTransactionSchema.index({ customerId: 1, createdAt: -1 });
PaymentTransactionSchema.index({ status: 1 });
PaymentTransactionSchema.index({ gatewayTransactionId: 1 });
PaymentTransactionSchema.index({ earningsStatus: 1 });

// Virtual for formatted amount
PaymentTransactionSchema.virtual('formattedAmount').get(function () {
  return `₹${this.amount.toLocaleString('en-IN')}`;
});

// Virtual for platform fee percentage
PaymentTransactionSchema.virtual('platformFeePercentage').get(function () {
  return Math.round((this.platformFee / this.amount) * 100);
});

// Pre-save middleware to calculate platform fee and vendor earnings
PaymentTransactionSchema.pre('save', function (next) {
  if (this.isModified('amount')) {
    // Calculate platform fee (2.5% of transaction amount)
    this.platformFee = Math.round(this.amount * 0.025);
    this.vendorEarnings = this.amount - this.platformFee;
  }
  next();
});

// Static method to get vendor earnings summary
PaymentTransactionSchema.statics.getVendorEarningsSummary = async function (vendorId: string) {
  const result = await this.aggregate([
    { $match: { vendorId: new mongoose.Types.ObjectId(vendorId) } },
    {
      $group: {
        _id: '$earningsStatus',
        totalAmount: { $sum: '$amount' },
        totalEarnings: { $sum: '$vendorEarnings' },
        totalPlatformFee: { $sum: '$platformFee' },
        count: { $sum: 1 },
      },
    },
  ]);

  return result;
};

export default mongoose.model<IPaymentTransaction>('PaymentTransaction', PaymentTransactionSchema);
