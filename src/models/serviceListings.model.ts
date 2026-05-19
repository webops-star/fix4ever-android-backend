import mongoose, { Schema, Document } from 'mongoose';

export interface IServiceListing extends Document {
  vendorId: mongoose.Types.ObjectId;
  serviceName: string;
  description?: string;
  price: number;
  estimatedTime?: string;
}

const ServiceListingSchema = new Schema<IServiceListing>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    serviceName: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true },
    estimatedTime: { type: String },
  },
  { timestamps: true }
);

// CRITICAL: Indexes for vendor service listings
ServiceListingSchema.index({ vendorId: 1 }); // Get all services for a vendor
ServiceListingSchema.index({ vendorId: 1, createdAt: -1 }); // Vendor services sorted by date

export default mongoose.model<IServiceListing>('ServiceListing', ServiceListingSchema);
