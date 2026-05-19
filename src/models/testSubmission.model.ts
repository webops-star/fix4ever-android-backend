import mongoose, { Document, Schema } from 'mongoose';

export interface ITestVideo {
  questionId: number;
  fileName: string;
  s3Url: string;
  s3Key: string;
  size?: number;
  uploadedAt: Date;
  serviceRequestId: string;
}

export interface ITestReview {
  marks: Record<string, number>; // questionId -> marks
  total: number;
  reviewedAt: Date;
}

export interface ITestSubmission extends Document {
  userId: mongoose.Types.ObjectId; // Reference to User
  userName: string;
  userEmail: string;
  video: ITestVideo;
  submittedAt: Date;
  review?: ITestReview;
}

const testVideoSchema = new Schema<ITestVideo>(
  {
    questionId: { type: Number, required: true },
    fileName: { type: String, required: true },
    s3Url: { type: String, required: true },
    s3Key: { type: String, required: true },
    size: { type: Number },
    uploadedAt: { type: Date, default: Date.now },
    serviceRequestId: { type: String, required: true },
  },
  { _id: false }
);

const testReviewSchema = new Schema<ITestReview>(
  {
    marks: { type: Schema.Types.Mixed, required: true }, // Record<string, number>
    total: { type: Number, required: true },
    reviewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const testSubmissionSchema = new Schema<ITestSubmission>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true, index: true },
    video: { type: testVideoSchema, required: true },
    submittedAt: { type: Date, default: Date.now },
    review: testReviewSchema,
  },
  { timestamps: true }
);

// Indexes for better query performance
testSubmissionSchema.index({ userEmail: 1 });
testSubmissionSchema.index({ userId: 1 });
testSubmissionSchema.index({ submittedAt: -1 });
testSubmissionSchema.index({ 'review.reviewedAt': -1 });

export default mongoose.model<ITestSubmission>('TestSubmission', testSubmissionSchema);
