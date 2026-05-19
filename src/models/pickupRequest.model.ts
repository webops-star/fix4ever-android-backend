import mongoose, { Document, Schema } from 'mongoose';

export interface PickupRequestTimeline {
  status: string;
  timestamp: Date;
  comment?: string;
}

export interface PickupRequest extends Document {
  serviceRequestId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  captainId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  jobNumber: string;
  deviceType: string;
  deviceBrand: string;
  deviceModel: string;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  dropAddress: string;
  pickupNotes?: string;
  status: 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
  assignedAt: Date;
  pickedUpAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  earnings?: number;
  timeline: PickupRequestTimeline[];
  createdAt: Date;
  updatedAt: Date;
}

const pickupRequestSchema = new Schema<PickupRequest>(
  {
    serviceRequestId: { type: Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    captainId: { type: Schema.Types.ObjectId, ref: 'Captain', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobNumber: { type: String, required: true, unique: true },
    deviceType: { type: String, required: true },
    deviceBrand: { type: String, required: true },
    deviceModel: { type: String, required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    pickupAddress: { type: String, required: true },
    dropAddress: { type: String, required: true },
    pickupNotes: { type: String },
    status: {
      type: String,
      enum: ['ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED'],
      default: 'ASSIGNED',
      required: true,
    },
    assignedAt: { type: Date, required: true },
    pickedUpAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelReason: { type: String },
    earnings: { type: Number },
    timeline: [
      {
        status: { type: String, required: true },
        timestamp: { type: Date, required: true },
        comment: { type: String },
      },
    ],
  },
  { timestamps: true }
);

// Create indexes for better query performance
pickupRequestSchema.index({ jobNumber: 1 }, { unique: true });
pickupRequestSchema.index({ vendorId: 1, status: 1 });
pickupRequestSchema.index({ captainId: 1, status: 1 });
pickupRequestSchema.index({ customerId: 1 });
pickupRequestSchema.index({ serviceRequestId: 1 });
pickupRequestSchema.index({ status: 1 });
pickupRequestSchema.index({ assignedAt: -1 });
pickupRequestSchema.index({ completedAt: -1 });

export default mongoose.model<PickupRequest>('PickupRequest', pickupRequestSchema);
