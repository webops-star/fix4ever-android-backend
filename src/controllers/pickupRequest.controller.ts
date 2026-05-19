import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import mongoose from 'mongoose';
import PickupRequest, { PickupRequest as IPickupRequest } from '../models/pickupRequest.model';
import Captain from '../models/captain.model';
import User from '../models/user.model';
import ServiceRequest from '../models/serviceRequest.model';
import Notification from '../models/notification.model';
import Vendor from '../models/vendor.model';

// Create a new pickup request (called by vendor)
export const createPickupRequest = async (req: AuthRequest, res: Response) => {
  try {
    const vendorId = req.user?.role === 'vendor' ? req.user._id : null;

    if (!vendorId) {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create pickup requests',
      });
    }

    const {
      serviceRequestId,
      deviceType,
      deviceBrand,
      deviceModel,
      customerName,
      customerPhone,
      pickupAddress,
      dropAddress,
      pickupNotes,
    } = req.body;

    if (!serviceRequestId || !customerName || !customerPhone || !pickupAddress || !dropAddress) {
      return res.status(400).json({
        success: false,
        message: 'Required fields are missing',
      });
    }

    // Check if service request exists
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId });
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Find nearest available captain
    const availableCaptains = await Captain.find({
      onboardingStatus: 'Approved',
      availability: 'Available',
      // Add additional filters like service area, etc.
    }).sort({ 'currentLocation.lastUpdated': -1 });

    if (availableCaptains.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No captains available at the moment',
      });
    }

    const captain = availableCaptains[0]; // For now, just pick the first available captain

    // Generate job number
    const jobNumber = `PD${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;

    // Create pickup request
    const pickupRequest = new PickupRequest({
      serviceRequestId: serviceRequest._id,
      vendorId: vendorId,
      captainId: captain._id,
      customerId: serviceRequest.customerId,
      jobNumber: jobNumber,
      deviceType: deviceType || serviceRequest.deviceType,
      deviceBrand: deviceBrand || serviceRequest.deviceBrand,
      deviceModel: deviceModel || serviceRequest.deviceModel,
      customerName: customerName,
      customerPhone: customerPhone,
      pickupAddress: pickupAddress,
      dropAddress: dropAddress,
      pickupNotes: pickupNotes,
      status: 'ASSIGNED',
      assignedAt: new Date(),
      timeline: [
        {
          status: 'ASSIGNED',
          timestamp: new Date(),
          comment: 'Pickup request created and assigned to captain',
        },
      ],
    });

    await pickupRequest.save();

    // Update captain status to On Trip
    await Captain.findByIdAndUpdate(captain._id, {
      availability: 'On Trip',
    });

    // Create notification for captain
    const captainUser = await User.findById(captain.personalInfo.userId);
    if (captainUser) {
      const notification = new Notification({
        userId: captainUser._id,
        type: 'NEW_PICKUP_REQUEST',
        title: 'New Pickup Request',
        message: `New pickup request #${jobNumber} assigned. Customer: ${customerName}`,
        data: {
          pickupRequestId: pickupRequest._id,
          jobNumber: jobNumber,
        },
        isRead: false,
      });

      await notification.save();
    }

    // Update service request status
    await ServiceRequest.findByIdAndUpdate(serviceRequestId, {
      $push: {
        timeline: {
          status: 'PICKUP_INITIATED',
          timestamp: new Date(),
          comment: 'Pickup request has been initiated',
        },
      },
      status: 'PICKUP_INITIATED',
    });

    // Return success
    return res.status(201).json({
      success: true,
      message: 'Pickup request created successfully',
      pickupRequest: pickupRequest,
    });
  } catch (error: any) {
    console.error('Error creating pickup request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create pickup request',
      error: error.message,
    });
  }
};

// Get active pickup requests for vendor
export const getVendorActivePickups = async (req: AuthRequest, res: Response) => {
  try {
    const vendorId = req.user?._id;

    const pickupRequests = await PickupRequest.find({
      vendorId: vendorId,
      status: { $in: ['ASSIGNED', 'PICKED_UP'] },
    }).sort({ assignedAt: -1 });

    return res.status(200).json({
      success: true,
      pickupRequests: pickupRequests,
    });
  } catch (error: any) {
    console.error('Error fetching vendor pickup requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pickup requests',
      error: error.message,
    });
  }
};

// Get active pickup jobs for captain
export const getCaptainActiveJobs = async (req: AuthRequest, res: Response) => {
  try {
    const captainId = await getCaptainIdFromUserId(req.user?._id);

    if (!captainId) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    const pickupRequests = await PickupRequest.find({
      captainId: captainId,
      status: { $in: ['ASSIGNED', 'PICKED_UP'] },
    }).sort({ assignedAt: -1 });

    return res.status(200).json({
      success: true,
      jobs: pickupRequests,
    });
  } catch (error: any) {
    console.error('Error fetching captain active jobs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active jobs',
      error: error.message,
    });
  }
};

// Get completed pickup jobs for captain
export const getCaptainCompletedJobs = async (req: AuthRequest, res: Response) => {
  try {
    const captainId = await getCaptainIdFromUserId(req.user?._id);

    if (!captainId) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    const pickupRequests = await PickupRequest.find({
      captainId: captainId,
      status: 'DELIVERED',
    })
      .sort({ completedAt: -1 })
      .limit(20);

    // Calculate stats
    const allCompletedJobs = await PickupRequest.find({
      captainId: captainId,
      status: 'DELIVERED',
    });

    const totalTrips = allCompletedJobs.length;

    const totalEarnings = allCompletedJobs.reduce(
      (sum: number, job: any) => sum + (job.earnings || 0),
      0
    );

    // Calculate today's earnings
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayJobs = allCompletedJobs.filter((job: any) => {
      if (!job.completedAt) return false;
      const jobDate = new Date(job.completedAt);
      return jobDate >= today;
    });

    const todayEarnings = todayJobs.reduce((sum: number, job: any) => sum + (job.earnings || 0), 0);

    return res.status(200).json({
      success: true,
      jobs: pickupRequests,
      totalTrips,
      totalEarnings,
      todayEarnings,
    });
  } catch (error: any) {
    console.error('Error fetching captain completed jobs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch completed jobs',
      error: error.message,
    });
  }
};

// Update pickup request status (by captain)
export const updatePickupStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pickup request ID',
      });
    }

    const captainId = await getCaptainIdFromUserId(req.user?._id);

    if (!captainId) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    // Find the pickup request
    const pickupRequest = await PickupRequest.findById(id);

    if (!pickupRequest) {
      return res.status(404).json({
        success: false,
        message: 'Pickup request not found',
      });
    }

    // Verify captain owns this job
    if (pickupRequest.captainId.toString() !== captainId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: This pickup job does not belong to you',
      });
    }

    // Verify valid status transition
    const validTransitions: { [key: string]: string[] } = {
      ASSIGNED: ['PICKED_UP'],
      PICKED_UP: ['DELIVERED'],
    };

    if (
      !validTransitions[pickupRequest.status] ||
      !validTransitions[pickupRequest.status].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${pickupRequest.status} to ${status}`,
      });
    }

    // Update pickup request
    let update: any = {
      status: status,
      $push: {
        timeline: {
          status: status,
          timestamp: new Date(),
          comment:
            status === 'PICKED_UP'
              ? 'Device picked up from customer'
              : 'Device delivered to vendor',
        },
      },
    };

    if (status === 'PICKED_UP') {
      update.pickedUpAt = new Date();
    } else if (status === 'DELIVERED') {
      update.completedAt = new Date();
      update.earnings = 100; // Example fixed earnings amount, can be calculated based on distance
    }

    const updatedRequest = await PickupRequest.findByIdAndUpdate(id, update, { new: true });

    // Update captain availability if job is completed
    if (status === 'DELIVERED') {
      await Captain.findByIdAndUpdate(captainId, {
        availability: 'Available',
      });
    }

    // Create notification for vendor
    if (status === 'PICKED_UP' || status === 'DELIVERED') {
      const vendor = await Vendor.findById(pickupRequest.vendorId);
      if (vendor && vendor.pocInfo.userId) {
        const notification = new Notification({
          userId: vendor.pocInfo.userId,
          type: status === 'PICKED_UP' ? 'PICKUP_COMPLETED' : 'DELIVERY_COMPLETED',
          title: status === 'PICKED_UP' ? 'Device Picked Up' : 'Device Delivered',
          message:
            status === 'PICKED_UP'
              ? `Device for request #${pickupRequest.jobNumber} has been picked up from the customer`
              : `Device for request #${pickupRequest.jobNumber} has been delivered to your shop`,
          data: {
            pickupRequestId: pickupRequest._id,
            serviceRequestId: pickupRequest.serviceRequestId,
            jobNumber: pickupRequest.jobNumber,
          },
          isRead: false,
        });

        await notification.save();
      }
    }

    // Update service request status
    if (pickupRequest.serviceRequestId) {
      const serviceRequestUpdate = {
        $push: {
          timeline: {
            status: status === 'PICKED_UP' ? 'DEVICE_PICKED_UP' : 'DEVICE_AT_SHOP',
            timestamp: new Date(),
            comment:
              status === 'PICKED_UP'
                ? 'Device has been picked up from customer'
                : 'Device has been delivered to repair shop',
          },
        },
      };

      if (status === 'DELIVERED') {
        Object.assign(serviceRequestUpdate, { status: 'DEVICE_AT_SHOP' });
      } else if (status === 'PICKED_UP') {
        Object.assign(serviceRequestUpdate, { status: 'DEVICE_PICKED_UP' });
      }

      await ServiceRequest.findByIdAndUpdate(pickupRequest.serviceRequestId, serviceRequestUpdate);
    }

    return res.status(200).json({
      success: true,
      message: `Pickup request status updated to ${status}`,
      pickupRequest: updatedRequest,
    });
  } catch (error: any) {
    console.error('Error updating pickup request status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update pickup request status',
      error: error.message,
    });
  }
};

// Helper function to get captain ID from user ID
const getCaptainIdFromUserId = async (
  userId: string | undefined
): Promise<mongoose.Types.ObjectId | null> => {
  if (!userId) return null;

  const captain = await Captain.findOne({ 'personalInfo.userId': userId });
  return captain ? captain._id : null;
};

// Get pickup requests history for vendor
export const getVendorPickupHistory = async (req: AuthRequest, res: Response) => {
  try {
    const vendorId = req.user?._id;

    const pickupRequests = await PickupRequest.find({
      vendorId: vendorId,
      status: 'DELIVERED',
    })
      .sort({ completedAt: -1 })
      .limit(20);

    return res.status(200).json({
      success: true,
      pickupRequests: pickupRequests,
    });
  } catch (error: any) {
    console.error('Error fetching vendor pickup history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pickup history',
      error: error.message,
    });
  }
};

// Get pickup request details
export const getPickupRequestDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pickup request ID',
      });
    }

    const pickupRequest = await PickupRequest.findById(id);

    if (!pickupRequest) {
      return res.status(404).json({
        success: false,
        message: 'Pickup request not found',
      });
    }

    // Check if user has permission to view this request
    const userId = req.user?._id;
    const userRole = req.user?.role;

    let hasPermission = false;

    if (userRole === 'admin') {
      hasPermission = true;
    } else if (userRole === 'vendor' && pickupRequest.vendorId.toString() === userId) {
      hasPermission = true;
    } else if (userRole === 'captain') {
      const captainId = await getCaptainIdFromUserId(userId);
      if (captainId && pickupRequest.captainId.toString() === captainId.toString()) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this pickup request',
      });
    }

    return res.status(200).json({
      success: true,
      pickupRequest: pickupRequest,
    });
  } catch (error: any) {
    console.error('Error fetching pickup request details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pickup request details',
      error: error.message,
    });
  }
};
