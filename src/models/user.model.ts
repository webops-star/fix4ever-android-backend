import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  username: string;
  email: string;
  phone: string;
  password: string;
  role: string;
  isVendor?: boolean;
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user', enum: ['user', 'vendor', 'admin', 'captain'] },
    isVendor: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Indexes for better query performance
userSchema.index({ role: 1 }); // Filter users by role
userSchema.index({ isVendor: 1 }); // Filter vendors
userSchema.index({ email: 1, phone: 1 }); // Compound index for auth lookups

export default mongoose.model<IUser>('User', userSchema);
