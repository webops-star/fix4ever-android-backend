import { Request, Response } from 'express';
import ServiceRequest from '../models/serviceRequest.model';
import Notification from '../models/notification.model';
import { createNotification } from './notification.controller';
import {
  sendRealTimeNotification,
  sendServiceRequestNotification,
  emitAdminNotification,
  NOTIFICATION_TYPES,
} from '../utils/realTimeNotifications';
import mailSender from '../utils/mailSender';
import {
  getScheduleProposedEmail,
  getScheduleAcceptedEmail,
  getScheduleRejectedEmail,
  getPickupScheduledEmail,
  getPickupConfirmedEmail,
  getDropScheduledEmail,
  getDropCompletedEmail,
} from '../utils/emailTemplate';

interface AuthRequest extends Request {
  user?: any;
}

// Check slot availability for multiple dates
export const checkSlotAvailability = async (req: AuthRequest, res: Response) => {
  try {
    const vendorId = (req.user as any)?.userId;
    const { dates } = req.body;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    if (!dates || !Array.isArray(dates)) {
      return res.status(400).json({
        success: false,
        message: 'Dates array is required',
      });
    }

    // Get vendor profile
    const vendor = await require('../models/vendor.model').default.findOne({
      'pocInfo.userId': vendorId,
    });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Check availability for each date
    const availability = await Promise.all(
      dates.map(async (dateStr: string) => {
        const date = new Date(dateStr);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        // Find all scheduled requests for this vendor on this date with accepted status
        const scheduledRequests = await ServiceRequest.find({
          $or: [{ assignedVendor: vendor._id }, { assignedTechnician: vendor._id }],
          scheduledDate: {
            $gte: date,
            $lt: nextDay,
          },
          scheduleStatus: { $in: ['proposed', 'accepted'] },
        }).select('scheduledSlot');

        // Check which slots are booked
        const bookedSlots = scheduledRequests.map(req => req.scheduledSlot);

        return {
          date: dateStr,
          slots: {
            morning: !bookedSlots.includes('morning'),
            evening: !bookedSlots.includes('evening'),
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      availability,
    });
  } catch (error: any) {
    console.error('Check slot availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check slot availability',
      error: error.message,
    });
  }
};

// Vendor proposes a schedule for a service request
export const proposeSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceRequestId } = req.params;
    const vendorId = (req.user as any)?.userId;
    const {
      scheduledDate,
      scheduledTime,
      scheduleNotes,
      availableSlots,
      scheduledSlot,
      startTime,
      endTime,
    } = req.body;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    if (!scheduledDate || !scheduledTime) {
      return res.status(400).json({
        success: false,
        message: 'Scheduled date and time are required',
      });
    }

    // Find the service request
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId })
      .populate('customerId', 'username email phone')
      .populate(
        'assignedVendor',
        'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      );

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    // We need to find the vendor by userId and check if they're assigned to this request
    const vendor = await require('../models/vendor.model').default.findOne({
      'pocInfo.userId': vendorId,
    });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Check if this vendor is assigned to the service request
    const isAssigned =
      serviceRequest.assignedVendor?.toString() === vendor._id.toString() ||
      serviceRequest.assignedTechnician?.toString() === vendor._id.toString();

    if (!isAssigned) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to schedule this service request',
      });
    }

    // Check if request is in correct status for scheduling
    if (!['Assigned', 'In Progress'].includes(serviceRequest.status)) {
      return res.status(400).json({
        success: false,
        message: 'Service request is not in correct status for scheduling',
      });
    }

    // Parse and validate the scheduled date
    const scheduleDate = new Date(scheduledDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Allow scheduling for today and future dates
    if (scheduleDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule for past dates',
      });
    }

    // If slot-based scheduling is used, check for conflicts
    if (scheduledSlot) {
      const nextDay = new Date(scheduleDate);
      nextDay.setDate(nextDay.getDate() + 1);

      // Check if the slot is already booked for this vendor
      const conflictingRequest = await ServiceRequest.findOne({
        $or: [{ assignedVendor: vendor._id }, { assignedTechnician: vendor._id }],
        scheduledDate: {
          $gte: scheduleDate,
          $lt: nextDay,
        },
        scheduledSlot: scheduledSlot,
        scheduleStatus: { $in: ['proposed', 'accepted'] },
        _id: { $ne: serviceRequestId }, // Exclude the current request
      });

      if (conflictingRequest) {
        return res.status(400).json({
          success: false,
          message: 'This time slot is already booked. Please select another slot.',
        });
      }
    }

    // Update the service request with schedule
    const updateData: any = {
      scheduledDate: scheduleDate,
      scheduledTime: scheduledTime,
      scheduleStatus: 'proposed',
      scheduleNotes: scheduleNotes || '',
      'userResponse.status': 'pending', // Reset user response to pending
      'userResponse.respondedAt': null,
      'userResponse.userNotes': '',
      updatedAt: new Date(),
    };

    // Add slot-based scheduling fields if provided
    if (scheduledSlot) {
      updateData.scheduledSlot = scheduledSlot;
      updateData.startTime = startTime;
      updateData.endTime = endTime;
    }

    const updatedRequest = await ServiceRequest.findByIdAndUpdate(serviceRequestId, updateData, {
      new: true,
    });

    // Create notification for customer
    await createNotification(
      serviceRequest.customerId._id.toString(),
      'Schedule Proposed',
      `Your service request has been scheduled for ${scheduleDate.toLocaleDateString()} at ${scheduledTime}. Please review and respond.`,
      'schedule_proposed',
      serviceRequestId
    );

    // Send email notification to customer
    try {
      const emailContent = getScheduleProposedEmail(
        serviceRequest.customerId.username || 'Customer',
        vendor.pocInfo.fullName,
        scheduleDate.toLocaleDateString(),
        scheduledTime,
        serviceRequest.serviceType,
        serviceRequest
      );

      await mailSender(serviceRequest.customerId.email, emailContent.subject, emailContent.html);
    } catch (emailError) {
      console.error('Failed to send schedule proposal email:', emailError);
      // Don't fail the request if email fails
    }

    // Send real-time notification
    sendRealTimeNotification(
      serviceRequest.customerId._id.toString(),
      NOTIFICATION_TYPES.SCHEDULE_PROPOSED,
      {
        serviceRequestId,
        scheduledDate: scheduleDate,
        scheduledTime: scheduledTime,
        vendorName: vendor.pocInfo.fullName,
      }
    );
    // Also broadcast to service room so all parties on detail pages see the update
    sendServiceRequestNotification(serviceRequestId, NOTIFICATION_TYPES.SCHEDULE_PROPOSED, {
      scheduledDate: scheduleDate,
      scheduledTime: scheduledTime,
      vendorName: vendor.pocInfo.fullName,
    });
    if ((serviceRequest as any)._id)
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        NOTIFICATION_TYPES.SCHEDULE_PROPOSED,
        { scheduledDate: scheduleDate, scheduledTime: scheduledTime }
      );

    res.status(200).json({
      success: true,
      message: 'Schedule proposed successfully',
      data: {
        scheduledDate: updatedRequest?.scheduledDate,
        scheduledTime: updatedRequest?.scheduledTime,
        scheduleStatus: updatedRequest?.scheduleStatus,
      },
    });
  } catch (error: any) {
    console.error('Propose schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to propose schedule',
      error: error.message,
    });
  }
};

// Vendor updates schedule with multiple available slots
export const updateScheduleWithSlots = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceRequestId } = req.params;
    const vendorId = (req.user as any)?.userId;
    const { availableSlots, scheduleNotes } = req.body;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    if (!availableSlots || !Array.isArray(availableSlots) || availableSlots.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Available slots are required and must be an array',
      });
    }

    // Find the service request
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId })
      .populate('customerId', 'username email phone')
      .populate(
        'assignedVendor',
        'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      );

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor.pocInfo?.userId?.toString() !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request',
      });
    }

    // Update the service request with available slots
    const updatedRequest = await ServiceRequest.findByIdAndUpdate(
      serviceRequestId,
      {
        availableSlots: availableSlots,
        scheduleStatus: 'pending',
        scheduleNotes: scheduleNotes || '',
        updatedAt: new Date(),
      },
      { new: true }
    );

    // Create notification for customer
    await createNotification(
      serviceRequest.customerId._id.toString(),
      'Schedule Updated',
      `New schedule options available for your service request. Please select your preferred time.`,
      'schedule_proposed',
      serviceRequestId
    );

    // Send real-time notification
    sendRealTimeNotification(
      serviceRequest.customerId._id.toString(),
      NOTIFICATION_TYPES.SCHEDULE_UPDATED,
      {
        serviceRequestId,
        availableSlots: availableSlots.length,
        vendorName: serviceRequest.assignedVendor.pocInfo.fullName,
      }
    );
    sendServiceRequestNotification(serviceRequestId, NOTIFICATION_TYPES.SCHEDULE_UPDATED, {
      availableSlots: availableSlots.length,
    });
    if ((serviceRequest as any)._id)
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        NOTIFICATION_TYPES.SCHEDULE_UPDATED,
        { availableSlots: availableSlots.length }
      );

    res.status(200).json({
      success: true,
      message: 'Schedule updated with available slots',
      data: {
        availableSlots: updatedRequest?.availableSlots,
        scheduleStatus: updatedRequest?.scheduleStatus,
      },
    });
  } catch (error: any) {
    console.error('Update schedule with slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update schedule',
      error: error.message,
    });
  }
};

// Customer accepts or rejects proposed schedule
export const respondToSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceRequestId } = req.params;
    const customerId = (req.user as any)?.userId;
    const { response, selectedSlot, userNotes } = req.body;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Customer ID not found',
      });
    }

    if (!['accepted', 'rejected'].includes(response)) {
      return res.status(400).json({
        success: false,
        message: 'Response must be either "accepted" or "rejected"',
      });
    }

    // Find the service request
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId }).populate(
      'assignedVendor',
      'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
    );

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if customer owns this request
    if (serviceRequest.customerId?.toString() !== customerId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to respond to this schedule',
      });
    }

    let updateData: any = {
      'userResponse.status': response,
      'userResponse.respondedAt': new Date(),
      'userResponse.userNotes': userNotes || '',
      updatedAt: new Date(),
    };

    if (response === 'accepted') {
      if (selectedSlot) {
        // Parse the selected slot
        const [date, time] = selectedSlot.split('T');
        updateData.scheduledDate = new Date(date);
        updateData.scheduledTime = time;
      }
      // Update scheduleStatus to 'accepted' when customer accepts
      updateData.scheduleStatus = 'accepted';
    } else if (response === 'rejected') {
      updateData.scheduleStatus = 'rejected';
    }

    // Update the service request
    const updatedRequest = await ServiceRequest.findByIdAndUpdate(serviceRequestId, updateData, {
      new: true,
    });

    // Create notification for vendor
    await createNotification(
      serviceRequest.assignedVendor._id.toString(),
      `Schedule ${response === 'accepted' ? 'Accepted' : 'Rejected'}`,
      `Customer has ${response} the proposed schedule for service request #${serviceRequestId.slice(-6)}.`,
      response === 'accepted' ? 'schedule_accepted' : 'schedule_rejected',
      serviceRequestId
    );

    // Send email notification to vendor
    try {
      if (response === 'accepted') {
        const emailContent = getScheduleAcceptedEmail(
          serviceRequest.customerId.username || 'Customer',
          serviceRequest.assignedVendor.pocInfo.fullName,
          updateData.scheduledDate.toLocaleDateString(),
          updateData.scheduledTime,
          serviceRequest.serviceType,
          serviceRequest
        );

        await mailSender(
          serviceRequest.assignedVendor.pocInfo.email,
          emailContent.subject,
          emailContent.html
        );
      } else {
        const emailContent = getScheduleRejectedEmail(
          serviceRequest.customerId.username || 'Customer',
          serviceRequest.assignedVendor.pocInfo.fullName,
          serviceRequest.serviceType,
          serviceRequest
        );

        await mailSender(
          serviceRequest.assignedVendor.pocInfo.email,
          emailContent.subject,
          emailContent.html
        );
      }
    } catch (emailError) {
      console.error('Failed to send schedule response email:', emailError);
      // Don't fail the request if email fails
    }

    // Send real-time notification to vendor
    sendRealTimeNotification(
      serviceRequest.assignedVendor._id.toString(),
      response === 'accepted'
        ? NOTIFICATION_TYPES.SCHEDULE_ACCEPTED
        : NOTIFICATION_TYPES.SCHEDULE_REJECTED,
      {
        serviceRequestId,
        customerResponse: response,
        selectedSlot: response === 'accepted' ? selectedSlot : undefined,
        userNotes: userNotes || undefined,
      }
    );
    // Broadcast to service room so vendor detail page updates immediately
    const scheduleEventType =
      response === 'accepted'
        ? NOTIFICATION_TYPES.SCHEDULE_ACCEPTED
        : NOTIFICATION_TYPES.SCHEDULE_REJECTED;
    sendServiceRequestNotification(serviceRequestId, scheduleEventType, {
      customerResponse: response,
      selectedSlot,
    });
    if ((serviceRequest as any)._id)
      sendServiceRequestNotification((serviceRequest as any)._id.toString(), scheduleEventType, {
        customerResponse: response,
        selectedSlot,
      });

    res.status(200).json({
      success: true,
      message: `Schedule ${response} successfully`,
      data: {
        scheduleStatus: updatedRequest?.scheduleStatus,
        userResponse: updatedRequest?.userResponse,
      },
    });
  } catch (error: any) {
    console.error('Respond to schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to respond to schedule',
      error: error.message,
    });
  }
};

// Get available time slots for a specific date
export const getAvailableSlots = async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.params;
    const vendorId = (req.user as any)?.userId;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Generate available time slots for the selected date
    const availableSlots = generateTimeSlots(selectedDate);

    res.status(200).json({
      success: true,
      data: {
        date: selectedDate.toISOString().split('T')[0],
        availableSlots,
      },
    });
  } catch (error: any) {
    console.error('Get available slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available slots',
      error: error.message,
    });
  }
};

// Get vendor's schedule for today
export const getTodaySchedule = async (req: AuthRequest, res: Response) => {
  try {
    const vendorId = (req.user as any)?.userId;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get all scheduled requests for today
    const todaySchedule = await ServiceRequest.find({
      assignedVendor: vendorId,
      scheduledDate: {
        $gte: today,
        $lt: tomorrow,
      },
      scheduleStatus: 'accepted',
    })
      .populate('customerId', 'username phone')
      .populate('assignedVendor', 'pocInfo')
      .sort({ scheduledTime: 1 });

    res.status(200).json({
      success: true,
      data: {
        date: today.toISOString().split('T')[0],
        schedule: todaySchedule,
      },
    });
  } catch (error: any) {
    console.error('Get today schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get today schedule',
      error: error.message,
    });
  }
};

// Helper function to generate time slots
function generateTimeSlots(date: Date): string[] {
  const slots = [];
  const startHour = 9; // 9 AM
  const endHour = 18; // 6 PM

  for (let hour = startHour; hour < endHour; hour++) {
    const time = `${hour.toString().padStart(2, '0')}:00`;
    slots.push(time);

    // Add half-hour slots
    const halfHour = `${hour.toString().padStart(2, '0')}:30`;
    slots.push(halfHour);
  }

  return slots;
}

// Schedule pickup for pickup-drop service type
export const schedulePickup = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceRequestId } = req.params;
    const vendorId = (req.user as any)?.userId;
    const { pickupDate, pickupTime, pickupNotes, pickupLocation } = req.body;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    if (!pickupDate || !pickupTime) {
      return res.status(400).json({
        success: false,
        message: 'Pickup date and time are required',
      });
    }

    // Find the service request
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId })
      .populate('customerId', 'username email phone')
      .populate(
        'assignedVendor',
        'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      );

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor.pocInfo?.userId?.toString() !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to schedule pickup for this service request',
      });
    }

    // Check if service type is pickup-drop
    if (serviceRequest.serviceType !== 'pickup-drop') {
      return res.status(400).json({
        success: false,
        message: 'Pickup scheduling is only available for pickup-drop service type',
      });
    }

    // Check if schedule is accepted
    if (serviceRequest.scheduleStatus !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule pickup until the main schedule is accepted',
      });
    }

    // Parse and validate the pickup date
    const pickupDateObj = new Date(pickupDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (pickupDateObj < today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule pickup for past dates',
      });
    }

    // Update the service request with pickup details
    const updatedRequest = await ServiceRequest.findByIdAndUpdate(
      serviceRequestId,
      {
        'pickupDetails.scheduledDate': pickupDateObj,
        'pickupDetails.scheduledTime': pickupTime,
        'pickupDetails.pickupNotes': pickupNotes || '',
        'pickupDetails.pickupLocation': pickupLocation || {
          address: serviceRequest.address,
          latitude: serviceRequest.customerLocation.latitude,
          longitude: serviceRequest.customerLocation.longitude,
        },
        scheduleStatus: 'pickup_scheduled',
        updatedAt: new Date(),
      },
      { new: true }
    );

    // Create notification for customer
    await createNotification(
      serviceRequest.customerId._id.toString(),
      'Device Pickup Scheduled',
      `Your device pickup has been scheduled for ${pickupDateObj.toLocaleDateString()} at ${pickupTime}.`,
      'pickup_scheduled',
      serviceRequestId
    );

    // Send email notification to customer
    try {
      const emailContent = getPickupScheduledEmail(
        serviceRequest.customerId.username || 'Customer',
        serviceRequest.assignedVendor.pocInfo.fullName,
        pickupDateObj.toLocaleDateString(),
        pickupTime,
        pickupLocation?.address || serviceRequest.address,
        serviceRequest
      );

      await mailSender(serviceRequest.customerId.email, emailContent.subject, emailContent.html);
    } catch (emailError) {
      console.error('Failed to send pickup scheduled email:', emailError);
    }

    // Send real-time notification
    sendRealTimeNotification(
      serviceRequest.customerId._id.toString(),
      NOTIFICATION_TYPES.PICKUP_SCHEDULED,
      {
        serviceRequestId,
        pickupDate: pickupDateObj.toLocaleDateString(),
        pickupTime,
        vendorName: serviceRequest.assignedVendor.pocInfo.fullName,
      }
    );
    sendServiceRequestNotification(serviceRequestId, NOTIFICATION_TYPES.PICKUP_SCHEDULED, {
      pickupDate: pickupDateObj,
      pickupTime,
    });
    if ((serviceRequest as any)._id)
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        NOTIFICATION_TYPES.PICKUP_SCHEDULED,
        { pickupDate: pickupDateObj, pickupTime }
      );

    res.status(200).json({
      success: true,
      message: 'Pickup scheduled successfully',
      data: {
        pickupDate: updatedRequest?.pickupDetails?.scheduledDate,
        pickupTime: updatedRequest?.pickupDetails?.scheduledTime,
        scheduleStatus: updatedRequest?.scheduleStatus,
      },
    });
  } catch (error: any) {
    console.error('Schedule pickup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule pickup',
      error: error.message,
    });
  }
};

// Confirm pickup completion
export const confirmPickup = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceRequestId } = req.params;
    const vendorId = (req.user as any)?.userId;
    const { pickupNotes } = req.body;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    // Find the service request
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId })
      .populate('customerId', 'username email phone')
      .populate(
        'assignedVendor',
        'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      );

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor.pocInfo?.userId?.toString() !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to confirm pickup for this service request',
      });
    }

    // Check if pickup is scheduled
    if (serviceRequest.scheduleStatus !== 'pickup_scheduled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot confirm pickup until pickup is scheduled',
      });
    }

    // Update the service request with pickup confirmation
    const updatedRequest = await ServiceRequest.findByIdAndUpdate(
      serviceRequestId,
      {
        'pickupDetails.actualPickupTime': new Date(),
        'pickupDetails.pickupConfirmed': true,
        'pickupDetails.pickupNotes': pickupNotes || '',
        scheduleStatus: 'pickup_completed',
        updatedAt: new Date(),
      },
      { new: true }
    );

    // Create notification for customer
    await createNotification(
      serviceRequest.customerId._id.toString(),
      'Device Pickup Confirmed',
      `Your device has been picked up successfully. Service is now in progress.`,
      'pickup_confirmed',
      serviceRequestId
    );

    // Send email notification to customer
    try {
      const emailContent = getPickupConfirmedEmail(
        serviceRequest.customerId.username || 'Customer',
        serviceRequest.assignedVendor.pocInfo.fullName,
        new Date().toLocaleTimeString(),
        serviceRequest.pickupDetails?.pickupLocation?.address || serviceRequest.address,
        serviceRequest
      );

      await mailSender(serviceRequest.customerId.email, emailContent.subject, emailContent.html);
    } catch (emailError) {
      console.error('Failed to send pickup confirmed email:', emailError);
    }

    // Send real-time notification
    sendRealTimeNotification(
      serviceRequest.customerId._id.toString(),
      NOTIFICATION_TYPES.PICKUP_CONFIRMED,
      {
        serviceRequestId,
        pickupTime: new Date().toLocaleTimeString(),
        vendorName: serviceRequest.assignedVendor.pocInfo.fullName,
      }
    );
    sendServiceRequestNotification(serviceRequestId, NOTIFICATION_TYPES.PICKUP_CONFIRMED, {
      pickupTime: new Date(),
    });
    if ((serviceRequest as any)._id)
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        NOTIFICATION_TYPES.PICKUP_CONFIRMED,
        { pickupTime: new Date() }
      );

    res.status(200).json({
      success: true,
      message: 'Pickup confirmed successfully',
      data: {
        actualPickupTime: updatedRequest?.pickupDetails?.actualPickupTime,
        scheduleStatus: updatedRequest?.scheduleStatus,
        serviceStatus: updatedRequest?.status,
      },
    });
  } catch (error: any) {
    console.error('Confirm pickup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm pickup',
      error: error.message,
    });
  }
};

// Schedule drop/delivery
export const scheduleDrop = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceRequestId } = req.params;
    const vendorId = (req.user as any)?.userId;
    const { dropDate, dropTime, dropNotes, dropLocation } = req.body;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    if (!dropDate || !dropTime) {
      return res.status(400).json({
        success: false,
        message: 'Drop date and time are required',
      });
    }

    // Find the service request
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId })
      .populate('customerId', 'username email phone')
      .populate(
        'assignedVendor',
        'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      );

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor.pocInfo?.userId?.toString() !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to schedule drop for this service request',
      });
    }

    // Check if service type is pickup-drop
    if (serviceRequest.serviceType !== 'pickup-drop') {
      return res.status(400).json({
        success: false,
        message: 'Drop scheduling is only available for pickup-drop service type',
      });
    }

    // Check if pickup is completed
    if (serviceRequest.scheduleStatus !== 'pickup_completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule drop until pickup is completed',
      });
    }

    // Parse and validate the drop date
    const dropDateObj = new Date(dropDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dropDateObj < today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule drop for past dates',
      });
    }

    // Update the service request with drop details
    const updatedRequest = await ServiceRequest.findByIdAndUpdate(
      serviceRequestId,
      {
        'dropDetails.scheduledDate': dropDateObj,
        'dropDetails.scheduledTime': dropTime,
        'dropDetails.dropNotes': dropNotes || '',
        'dropDetails.dropLocation': dropLocation || {
          address: serviceRequest.address,
          latitude: serviceRequest.customerLocation.latitude,
          longitude: serviceRequest.customerLocation.longitude,
        },
        scheduleStatus: 'drop_scheduled',
        updatedAt: new Date(),
      },
      { new: true }
    );

    // Create notification for customer
    await createNotification(
      serviceRequest.customerId._id.toString(),
      'Device Delivery Scheduled',
      `Your device delivery has been scheduled for ${dropDateObj.toLocaleDateString()} at ${dropTime}.`,
      'drop_scheduled',
      serviceRequestId
    );

    // Send email notification to customer
    try {
      const emailContent = getDropScheduledEmail(
        serviceRequest.customerId.username || 'Customer',
        serviceRequest.assignedVendor.pocInfo.fullName,
        dropDateObj.toLocaleDateString(),
        dropTime,
        dropLocation?.address || serviceRequest.address,
        serviceRequest
      );

      await mailSender(serviceRequest.customerId.email, emailContent.subject, emailContent.html);
    } catch (emailError) {
      console.error('Failed to send drop scheduled email:', emailError);
    }

    // Send real-time notification
    sendRealTimeNotification(
      serviceRequest.customerId._id.toString(),
      NOTIFICATION_TYPES.DROP_SCHEDULED,
      {
        serviceRequestId,
        dropDate: dropDateObj.toLocaleDateString(),
        dropTime,
        vendorName: serviceRequest.assignedVendor.pocInfo.fullName,
      }
    );
    sendServiceRequestNotification(serviceRequestId, NOTIFICATION_TYPES.DROP_SCHEDULED, {
      dropDate: dropDateObj,
      dropTime,
    });
    if ((serviceRequest as any)._id)
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        NOTIFICATION_TYPES.DROP_SCHEDULED,
        { dropDate: dropDateObj, dropTime }
      );

    res.status(200).json({
      success: true,
      message: 'Drop scheduled successfully',
      data: {
        dropDate: updatedRequest?.dropDetails?.scheduledDate,
        dropTime: updatedRequest?.dropDetails?.scheduledTime,
        scheduleStatus: updatedRequest?.scheduleStatus,
      },
    });
  } catch (error: any) {
    console.error('Schedule drop error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule drop',
      error: error.message,
    });
  }
};

// Confirm drop completion
export const confirmDrop = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceRequestId } = req.params;
    const vendorId = (req.user as any)?.userId;
    const { dropNotes } = req.body;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Vendor ID not found',
      });
    }

    // Find the service request
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId })
      .populate('customerId', 'username email phone')
      .populate(
        'assignedVendor',
        'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      );

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor.pocInfo?.userId?.toString() !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to confirm drop for this service request',
      });
    }

    // Check if drop is scheduled
    if (serviceRequest.scheduleStatus !== 'drop_scheduled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot confirm drop until drop is scheduled',
      });
    }

    // Update the service request with drop confirmation
    const updatedRequest = await ServiceRequest.findByIdAndUpdate(
      serviceRequestId,
      {
        'dropDetails.actualDropTime': new Date(),
        'dropDetails.dropConfirmed': true,
        'dropDetails.dropNotes': dropNotes || '',
        scheduleStatus: 'drop_completed',
        status: 'Completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      },
      { new: true }
    );

    // Create notification for customer
    await createNotification(
      serviceRequest.customerId._id.toString(),
      'Device Delivered Successfully',
      `Your device has been delivered successfully. Service is now complete.`,
      'drop_completed',
      serviceRequestId
    );

    // Send email notification to customer
    try {
      const emailContent = getDropCompletedEmail(
        serviceRequest.customerId.username || 'Customer',
        serviceRequest.assignedVendor.pocInfo.fullName,
        new Date().toLocaleTimeString(),
        serviceRequest.dropDetails?.dropLocation?.address || serviceRequest.address,
        serviceRequest
      );

      await mailSender(serviceRequest.customerId.email, emailContent.subject, emailContent.html);
    } catch (emailError) {
      console.error('Failed to send drop completed email:', emailError);
    }

    // Send real-time notification
    sendRealTimeNotification(
      serviceRequest.customerId._id.toString(),
      NOTIFICATION_TYPES.DROP_COMPLETED,
      {
        serviceRequestId,
        dropTime: new Date().toLocaleTimeString(),
        vendorName: serviceRequest.assignedVendor.pocInfo.fullName,
      }
    );
    sendServiceRequestNotification(serviceRequestId, NOTIFICATION_TYPES.DROP_COMPLETED, {
      dropTime: new Date(),
    });
    if ((serviceRequest as any)._id)
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        NOTIFICATION_TYPES.DROP_COMPLETED,
        { dropTime: new Date() }
      );
    emitAdminNotification('service_request_completed', { serviceRequestId });

    res.status(200).json({
      success: true,
      message: 'Drop confirmed successfully',
      data: {
        actualDropTime: updatedRequest?.dropDetails?.actualDropTime,
        scheduleStatus: updatedRequest?.scheduleStatus,
        serviceStatus: updatedRequest?.status,
      },
    });
  } catch (error: any) {
    console.error('Confirm drop error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm drop',
      error: error.message,
    });
  }
};
