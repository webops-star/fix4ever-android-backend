// Emit a notification to every admin (via shared admin-notifications room)

import userModel from '../models/user.model';
export const emitAdminNotification = (type: string, data: any) => {
  try {
    const io = (global as any).io;
    if (io) {
      io.to('admin-notifications').emit('admin_refresh', {
        type,
        data,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error sending admin notification:', error);
  }
};

// Emit a settlement_update event to a vendor's personal room
export const emitVendorSettlementUpdate = (vendorUserId: string, data: any) => {
  try {
    const io = (global as any).io;
    if (io) {
      io.to(`user-${vendorUserId}`).emit('settlement_update', {
        ...data,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error sending vendor settlement update:', error);
  }
};

// Utility function to send real-time notifications via WebSocket
export const sendRealTimeNotification = (userId: string, type: string, data: any) => {
  try {
    const io = (global as any).io;
    if (io) {
      io.to(`user-${userId}`).emit('notification', {
        type,
        data,
        timestamp: new Date().toISOString(),
      });
      console.log(`Real-time notification sent to user ${userId}:`, type);
    } else {
      console.warn('Socket.IO instance not available for real-time notification');
    }
  } catch (error) {
    console.error('Error sending real-time notification:', error);
  }
};

// Send notification to multiple users
export const sendRealTimeNotificationToMultiple = (userIds: string[], type: string, data: any) => {
  userIds.forEach(userId => {
    sendRealTimeNotification(userId, type, data);
  });
};

// Send notification to all users in a service request room
export const sendServiceRequestNotification = (requestId: string, type: string, data: any) => {
  try {
    const io = (global as any).io;
    if (io) {
      io.to(`service-${requestId}`).emit('service-request-update', {
        type,
        data,
        timestamp: new Date().toISOString(),
      });
      console.log(`Service request notification sent to room ${requestId}:`, type);
    } else {
      console.warn('Socket.IO instance not available for service request notification');
    }
  } catch (error) {
    console.error('Error sending service request notification:', error);
  }
};

/**
 * Emit a status_update event to all socket rooms associated with a service request.
 * Always broadcasts to both:
 *   - service-{request_id}  (human-readable ID — what the frontend URL uses)
 *   - service-{_id}         (MongoDB ObjectId — fallback in case frontend joined with _id)
 * Also sends a personal notification to the customer's user room.
 *
 * @param io       The Socket.IO server instance (pass req.app.get('socketio'))
 * @param sr       The saved serviceRequest document (must have _id, request_id, customerId)
 * @param status   The new status string
 */
/**
 * Emit a status_update event to all socket rooms associated with a service request.
 * Broadcasts to:
 *   - service-{request_id}  (human-readable ID — what the frontend URL uses)
 *   - service-{_id}         (MongoDB ObjectId — fallback)
 * Sends personal notifications to:
 *   - customer's user room
 *   - any extra user IDs passed (vendor, captain, etc.)
 */

export const captainupdates = async (requestId: any, message: any) => {
  try {
    const socket = (global as any).io;

    const io = socket;
    io.to(`service-${requestId}`).emit('captain updates', { message });

    console.log('Update by captain send to vendor', message);
  } catch (error) {
    console.log('unable to send the update to vendor ', error);
  }
};
export const vendornewStatusRequest = async (message: any) => {
  try {
    // get all vendor ids
    const vendors = await userModel.find({ role: 'vendor' }).select('_id');

    const ids = vendors.map(doc => doc._id.toString());
    console.log(ids);

    const socket = (global as any).io;
    if (!socket) return;

    const io = socket;

    // send event to each vendor
    ids.forEach(id => {
      io.to(`vendor-${id}`).emit('new-service-request', {
        type: 'new-service-request',

        message: message,
      });
    });
  } catch (error) {
    console.error('Error sending vendor status request:', error);
  }
};
export const emitStatusUpdate = (io: any, sr: any, status: string, extraUserIds: string[] = []) => {
  try {
    // Fall back to global io if the caller's req.app.get('socketio') returned undefined
    const socket = io || (global as any).io;
    if (!socket) return;
    // Reassign so the rest of the function uses the resolved instance
    io = socket;

    const mongoId = sr._id?.toString();
    const requestId = sr.request_id; // human-readable SR-xxxx
    const customerId = sr.customerId?._id?.toString() || sr.customerId?.toString();

    const payload = {
      type: 'status_update',
      data: {
        message: `Service request status updated to ${status}`,
        serviceRequestId: requestId || mongoId,
        status,
      },
      timestamp: new Date().toISOString(),
    };

    // Broadcast to the service request rooms (both IDs for guaranteed delivery)
    if (requestId) io.to(`service-${requestId}`).emit('service-request-update', payload);
    if (mongoId) io.to(`service-${mongoId}`).emit('service-request-update', payload);
    console.log(payload);

    const notificationPayload = {
      type: 'status_update',
      message: `Service request status updated to ${status}`,
      serviceRequestId: requestId || mongoId,
      status,
      timestamp: new Date().toISOString(),
    };

    // Send to customer's personal notification room
    if (customerId) {
      io.to(`user-${customerId}`).emit('notification', notificationPayload);
      console.log('notification sends');
    }

    // Send to any additional parties (vendor, captain, etc.)
    const seen = new Set([customerId]);
    extraUserIds.forEach(uid => {
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        io.to(`user-${uid}`).emit('notification', notificationPayload);
      }
    });

    console.log(
      `[Socket] status_update emitted → service-${requestId} + service-${mongoId}, status=${status}, extras=${extraUserIds.length}`
    );
  } catch (error) {
    console.error('[Socket] emitStatusUpdate error:', error);
  }
};

// Notification types
export const NOTIFICATION_TYPES = {
  SCHEDULE_PROPOSED: 'schedule_proposed',
  SCHEDULE_ACCEPTED: 'schedule_accepted',
  SCHEDULE_REJECTED: 'schedule_rejected',
  SCHEDULE_UPDATED: 'schedule_updated',
  PICKUP_SCHEDULED: 'pickup_scheduled',
  PICKUP_CONFIRMED: 'pickup_confirmed',
  DROP_SCHEDULED: 'drop_scheduled',
  DROP_COMPLETED: 'drop_completed',
  SERVICE_REQUEST_ASSIGNED: 'service_request_assigned',
  SERVICE_REQUEST_COMPLETED: 'service_request_completed',
  PAYMENT_INITIATED: 'payment_initiated',
  PAYMENT_COMPLETED: 'payment_completed',
  VERIFICATION_REQUIRED: 'verification_required',
  VERIFICATION_REVIEWED: 'verification_reviewed',
} as const;
