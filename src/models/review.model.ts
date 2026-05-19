import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReview extends Document {
  customerId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  serviceRequestId: mongoose.Types.ObjectId;
  rating: number;
  comment?: string;
  serviceQuality: number; // 1-5 rating for service quality
  communication: number; // 1-5 rating for communication
  punctuality: number; // 1-5 rating for punctuality
  overallExperience: number; // 1-5 rating for overall experience
  wouldRecommend?: boolean; // Whether customer would recommend this vendor
  isVerified: boolean; // To mark if this is a verified review
  helpfulVotes: number; // Number of helpful votes
  createdAt: Date;
  updatedAt: Date;
}

// Interface for the Review model with static methods
export interface IReviewModel extends Model<IReview> {
  calculateVendorRating(vendorId: string): Promise<{
    averageRating: number;
    averageServiceQuality: number;
    averageCommunication: number;
    averagePunctuality: number;
    averageOverallExperience: number;
    totalReviews: number;
    ratingDistribution: any[];
  }>;
}

const ReviewSchema = new Schema<IReview>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    serviceRequestId: { type: Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, required: true },
    serviceQuality: { type: Number, min: 1, max: 5, required: true },
    communication: { type: Number, min: 1, max: 5, required: true },
    punctuality: { type: Number, min: 1, max: 5, required: true },
    overallExperience: { type: Number, min: 1, max: 5, required: true },
    wouldRecommend: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: true },
    helpfulVotes: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Create indexes for better query performance
ReviewSchema.index({ vendorId: 1, createdAt: -1 });
ReviewSchema.index({ customerId: 1, createdAt: -1 });
ReviewSchema.index({ serviceRequestId: 1 });
ReviewSchema.index({ rating: 1 });

// Virtual for average rating across all aspects
ReviewSchema.virtual('averageRating').get(function () {
  return (
    Math.round(
      ((this.serviceQuality + this.communication + this.punctuality + this.overallExperience) / 4) *
        10
    ) / 10
  );
});

// Static method to calculate vendor average rating
ReviewSchema.statics.calculateVendorRating = async function (vendorId: string) {
  const result = await this.aggregate([
    { $match: { vendorId: new mongoose.Types.ObjectId(vendorId) } },
    {
      $group: {
        _id: '$vendorId',
        averageRating: { $avg: '$rating' },
        averageServiceQuality: { $avg: '$serviceQuality' },
        averageCommunication: { $avg: '$communication' },
        averagePunctuality: { $avg: '$punctuality' },
        averageOverallExperience: { $avg: '$overallExperience' },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: {
            rating: '$rating',
            serviceQuality: '$serviceQuality',
            communication: '$communication',
            punctuality: '$punctuality',
            overallExperience: '$overallExperience',
          },
        },
      },
    },
  ]);

  return (
    result[0] || {
      averageRating: 0,
      averageServiceQuality: 0,
      averageCommunication: 0,
      averagePunctuality: 0,
      averageOverallExperience: 0,
      totalReviews: 0,
      ratingDistribution: [],
    }
  );
};

export default mongoose.model<IReview, IReviewModel>('Review', ReviewSchema);
