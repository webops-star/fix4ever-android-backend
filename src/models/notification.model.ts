import mongoose, { Document, Schema } from 'mongoose';

const NotificationSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: [
      'service_request',
      'service_update',
      'payment',
      'payment_update',
      'payment_required',
      'payment_approved',
      'vendor_assignment',
      'vendor_notification',
      'vendor_action_required',
      'customer_action_required',
      'completion',
      'rejection',
      'schedule_proposed',
      'schedule_accepted',
      'schedule_rejected',
      'schedule_reminder',
      'status_update',
      'pickup_scheduled',
      'pickup_confirmed',
      'drop_scheduled',
      'drop_completed',
      'timer_expiry',
      'verification_required',
      'verification_complete',
      'problem_identified',
      'problem_confirmed',
      'problem_rejected',
    ],
    required: true,
  },
  relatedId: { type: Schema.Types.ObjectId }, // ID of related service request, payment, etc.
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Index for efficient queries
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ createdAt: -1 });

export default mongoose.model('Notification', NotificationSchema);
