import { Router } from 'express';
import {
  createServiceRequest,
  createVerificationRequest,
  getVerificationRequests,
  verifyRequest,
  acceptVerification,
  rejectVerification,
  updateServiceRequestStatus,
  updateServiceRequest,
  cancelServiceRequest,
  updateVendorServiceRequestStatus,
  updateUserServiceRequestStatus,
  getMyServiceRequests,
  getServiceRequestById,
  updateRequestStatusByVendor,
  getVendorAssignedRequests,
  acceptServiceRequest,
  getPendingRequestsForVendors,
  expireOldServiceRequests,
  initiatePayment,
  approvePayment,
  debugServiceRequestData,
  debugAllServiceRequests,
  migrateServiceRequestPhoneData,
  startIdentificationTimer,
  startIdentificationTimerManual,
  markIdentificationDone,
  confirmIdentifiedProblem,
  rejectIdentifiedProblem,
  requestCaptainPickup,
  acceptPickupRequest,
  rejectPickupRequest,
  assignCaptainToPickup,
  markReachedCustomer,
  completePickup,
  markPickupDone,
  markDeviceDelivered,
  startProblemVerification,
  completeProblemVerification,
  requestCaptainDrop,
  acceptDropRequest,
  rejectDropRequest,
  markReachedVendorForPickup,
  markHandoverToVendor,
  markReachedVendor,
  handoverToCaptain,
  markCaptainPickupDone,
  startDelivery,
  markDropDelivered,
  submitProblemIdentification,
  reviewVendorIdentification,
  approvePricing,
  rejectPricing,
  markServiceCompleted,
  updateKnowsProblem,
  getPickupRequests,
  getDropRequests,
  getCaptainAssignedJobs,
  setAdminFinalPrice,
  simulateReadyForPayment,
  choosePostRepairDelivery,
  uploadCaptainHandoverImages,
  uploadTechnicianHandoverImages,
  // Consent flow
  requestPickupConsent,
  respondPickupConsent,
  submitPickupSlot,
  adminReviewPickupSlot,
  requestDropConsent,
  respondDropConsent,
  submitDropSlot,
  adminReviewDropSlot,
  requestOnsiteConsent,
  respondOnsiteConsent,
  submitOnsiteSlot,
  adminReviewOnsiteSlot,
} from '../controllers/serviceRequest.controller';
import { downloadInvoice } from '../controllers/invoice.controller';
import { createNotification } from '../controllers/notification.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { upload } from '../middleware/multer.middleware';

const router = Router();

// Create a new service request with image uploads
router.post('/create', authenticateToken, upload.array('issueImages', 5), createServiceRequest);

// @deprecated Create a verification request for unknown problems (OLD FLOW - use new admin-mediated flow instead)
router.post(
  '/create-verification',
  authenticateToken,
  upload.array('issueImages', 5),
  createVerificationRequest
);

// @deprecated Get verification requests for vendors (OLD FLOW - use new admin-mediated flow instead)
router.get('/verification-requests', authenticateToken, getVerificationRequests);

// @deprecated Verify a request (vendor action) (OLD FLOW - use new admin-mediated flow instead)
router.post('/verify-request/:requestId', authenticateToken, verifyRequest);

// @deprecated Accept verification (user action) (OLD FLOW - use new admin-mediated flow instead)
router.post('/accept-verification/:verificationId', authenticateToken, acceptVerification);

// @deprecated Reject verification (user action) (OLD FLOW - use new admin-mediated flow instead)
router.post('/reject-verification/:verificationId', authenticateToken, rejectVerification);

// Get service requests by current user
router.get(
  '/my-requests',
  authenticateToken,
  (req, res, next) => {
    console.log('GET /my-requests called by user:', req.user?.userId);
    console.log('Request headers:', req.headers.authorization ? 'Present' : 'Missing');
    next();
  },
  getMyServiceRequests
);

// Update existing service request (for modify functionality)
router.put('/:id/update', authenticateToken, upload.array('issueImages', 5), updateServiceRequest);

// Cancel service request (for retry functionality)
router.patch('/:id/cancel', authenticateToken, cancelServiceRequest);

// ── Pickup Consent Routes ──────────────────────────────────────────────────
// Vendor asks customer "Should I send captain now?"
router.post('/:id/request-pickup-consent', authenticateToken, requestPickupConsent);
// Customer responds: "now" or selects a slot
router.post('/:id/respond-pickup-consent', authenticateToken, respondPickupConsent);
// Customer resubmits a slot after admin rejects
router.post('/:id/submit-pickup-slot', authenticateToken, submitPickupSlot);
// Admin approves or asks customer to reselect
router.post('/:id/admin-review-pickup-slot', authenticateToken, adminReviewPickupSlot);

// ── Drop Consent Routes ────────────────────────────────────────────────────
// Vendor asks customer "Should I send captain now?" (for return drop)
router.post('/:id/request-drop-consent', authenticateToken, requestDropConsent);
// Customer responds: "now" or selects a slot
router.post('/:id/respond-drop-consent', authenticateToken, respondDropConsent);
// Customer resubmits a drop slot after admin rejects
router.post('/:id/submit-drop-slot', authenticateToken, submitDropSlot);
// Admin approves or asks customer to reselect drop slot
router.post('/:id/admin-review-drop-slot', authenticateToken, adminReviewDropSlot);

// ── Onsite Consent Routes ──────────────────────────────────────────────────
// Vendor asks customer "Should I come now?" before marking Arrived at Location
router.post('/:id/request-onsite-consent', authenticateToken, requestOnsiteConsent);
// Customer responds: "now" or selects a slot
router.post('/:id/respond-onsite-consent', authenticateToken, respondOnsiteConsent);
// Customer resubmits a slot after admin rejects
router.post('/:id/submit-onsite-slot', authenticateToken, submitOnsiteSlot);
// Admin approves or asks customer to reselect onsite slot
router.post('/:id/admin-review-onsite-slot', authenticateToken, adminReviewOnsiteSlot);

// Captain pickup routes
router.post('/:id/request-pickup', authenticateToken, requestCaptainPickup);
router.post('/:id/accept-pickup', authenticateToken, acceptPickupRequest);
router.post('/:id/reject-pickup', authenticateToken, rejectPickupRequest);
router.patch('/:id/assign-captain', authenticateToken, assignCaptainToPickup);
router.patch('/:id/mark-reached-customer', authenticateToken, markReachedCustomer);
router.patch('/:id/complete-pickup', authenticateToken, completePickup);
router.patch('/:id/mark-pickup-done', authenticateToken, markPickupDone);
router.patch('/:id/mark-reached-vendor-pickup', authenticateToken, markReachedVendorForPickup);
router.patch('/:id/mark-handover-to-vendor', authenticateToken, markHandoverToVendor);
router.patch('/:id/mark-device-delivered', authenticateToken, markDeviceDelivered);
router.post('/:id/start-problem-verification', authenticateToken, startProblemVerification);
router.post('/:id/complete-problem-verification', authenticateToken, completeProblemVerification);
router.post('/:id/request-drop', authenticateToken, requestCaptainDrop);
router.post('/:id/accept-drop', authenticateToken, acceptDropRequest);
router.post('/:id/reject-drop', authenticateToken, rejectDropRequest);
router.patch('/:id/mark-reached-vendor', authenticateToken, markReachedVendor);
router.patch('/:id/handover-to-captain', authenticateToken, handoverToCaptain);
router.patch('/:id/mark-captain-pickup-done', authenticateToken, markCaptainPickupDone);
router.patch('/:id/start-delivery', authenticateToken, startDelivery);
router.patch('/:id/mark-drop-delivered', authenticateToken, markDropDelivered);
router.post('/:id/submit-problem-identification', authenticateToken, submitProblemIdentification);
// NEW: Admin reviews vendor identification and sets customer price
router.post(
  '/:requestId/admin-review-identification',
  authenticateToken,
  reviewVendorIdentification
);
// NEW: Manual start identification timer (for admin-mediated flow)
router.post(
  '/:requestId/start-identification-timer-manual',
  authenticateToken,
  startIdentificationTimerManual
);
router.post('/:id/approve-pricing', authenticateToken, approvePricing);
router.post('/:id/reject-pricing', authenticateToken, rejectPricing);
router.post('/:id/mark-completed', authenticateToken, markServiceCompleted);
router.post('/:id/choose-post-repair-delivery', authenticateToken, choosePostRepairDelivery);
router.get('/pickup-requests', authenticateToken, getPickupRequests);
router.get('/drop-requests', authenticateToken, getDropRequests);
router.get('/captain-assigned-jobs', authenticateToken, getCaptainAssignedJobs);

// Get pending requests for vendors to accept
router.get('/pending-for-vendors', authenticateToken, getPendingRequestsForVendors);

// Get service requests assigned to vendor
router.get('/vendor/assigned', authenticateToken, getVendorAssignedRequests);

// Get service request by ID
router.get('/:id', authenticateToken, getServiceRequestById);

// Debug endpoint to check raw service request data
router.get('/debug/:requestId', authenticateToken, debugServiceRequestData);

// Debug endpoint to list all service requests phone data (admin only)
router.get('/debug-all/phone-data', authenticateToken, debugAllServiceRequests);

// Data migration endpoint to fix service requests with invalid phone data (admin only)
router.post('/migrate/phone-data', authenticateToken, migrateServiceRequestPhoneData);

// Update service request status (general status updates)
router.patch('/:id/status', authenticateToken, updateServiceRequestStatus);

// Update service request status (vendor workflow with email notifications)
router.patch('/:requestId/vendor-status', authenticateToken, updateVendorServiceRequestStatus);

// User-specific status update for schedule acceptance
router.patch('/:requestId/user-status-update', authenticateToken, updateUserServiceRequestStatus);

// Vendor accepts a service request
router.post('/:requestId/accept', authenticateToken, acceptServiceRequest);

// Vendor rejects a service request
router.post('/:requestId/reject', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Import required models
    const ServiceRequest = require('../models/serviceRequest.model').default;
    const Vendor = require('../models/vendor.model').default;

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Find and update the service request
    const serviceRequest = await ServiceRequest.findById(requestId);
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Update status to rejected
    serviceRequest.status = 'Cancelled';
    serviceRequest.updatedAt = new Date();
    await serviceRequest.save();

    // Create notification for the customer
    await createNotification(
      serviceRequest.customerId.toString(),
      'Service Request Rejected',
      'Your service request has been rejected by the vendor.',
      'rejection',
      serviceRequest._id?.toString() || ''
    );

    res.status(200).json({
      success: true,
      message: 'Service request rejected successfully',
    });
  } catch (error: any) {
    console.error('Reject service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject service request',
      error: error.message,
    });
  }
});

// Vendor completes a service request
router.patch('/:requestId/complete', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Import required models
    const ServiceRequest = require('../models/serviceRequest.model').default;
    const Vendor = require('../models/vendor.model').default;

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Find and update the service request
    const serviceRequest = await ServiceRequest.findById(requestId).populate(
      'customerId',
      'username email phone'
    );
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (
      serviceRequest.assignedTechnician?.toString() !== vendor._id.toString() &&
      serviceRequest.assignedVendor?.toString() !== vendor._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this service request',
      });
    }

    // Update status to completed
    serviceRequest.status = 'Completed';
    serviceRequest.completedAt = new Date();
    serviceRequest.updatedAt = new Date();
    await serviceRequest.save();

    // Update vendor stats
    await Vendor.findByIdAndUpdate(vendor._id, {
      $inc: {
        completedRequests: 1,
        inProgressRequests: -1,
      },
    });

    // Create notification for the customer with date and time
    const customer = serviceRequest.customerId as any;
    const completionDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    if (customer?._id) {
      await createNotification(
        customer._id.toString(),
        'Service Request Completed',
        `Your service request has been completed by ${vendor.pocInfo.fullName} on ${completionDate}. You can now rate the service.`,
        'completion',
        serviceRequest._id?.toString() || ''
      );
    }

    // Create notification for the vendor
    if (vendor.pocInfo?.userId) {
      await createNotification(
        vendor.pocInfo.userId.toString(),
        'Service Request Completed',
        `You have completed the service request for ${customer?.username || 'Customer'} on ${completionDate}.`,
        'completion',
        serviceRequest._id?.toString() || ''
      );
    }

    res.status(200).json({
      success: true,
      message: 'Service request completed successfully',
      data: {
        serviceRequest,
        completionDate,
        vendor: {
          name: vendor.pocInfo.fullName,
          phone: vendor.pocInfo.phone,
          email: vendor.pocInfo.email,
        },
      },
    });
  } catch (error: any) {
    console.error('Complete service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete service request',
      error: error.message,
    });
  }
});

// User deletes their service request
router.delete('/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Import required models
    const ServiceRequest = require('../models/serviceRequest.model').default;

    // Find the service request
    const serviceRequest = await ServiceRequest.findById(requestId);
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if user owns this request
    if (serviceRequest.customerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own service requests',
      });
    }

    // Only allow deletion if request is still pending
    if (serviceRequest.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete service request that has been assigned or completed',
      });
    }

    // Delete the service request
    await ServiceRequest.findByIdAndDelete(requestId);

    res.status(200).json({
      success: true,
      message: 'Service request deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete service request',
      error: error.message,
    });
  }
});

// Update service request status by vendor (legacy routes)
router.patch('/:requestId/accept', authenticateToken, updateRequestStatusByVendor);

// Update service request status (admin)
router.patch('/:id/status', authenticateToken, updateServiceRequestStatus);

// Initiate payment
router.post('/:requestId/initiate-payment', authenticateToken, initiatePayment);

// Approve payment
router.post('/:requestId/approve-payment', authenticateToken, approvePayment);

// Start identification timer for unknown problems
router.post('/:requestId/start-identification-timer', authenticateToken, startIdentificationTimer);

// Mark identification as done
router.post('/:requestId/mark-identification-done', authenticateToken, markIdentificationDone);

// User confirms identified problem and proceeds with service
router.post('/:requestId/confirm-identification', authenticateToken, confirmIdentifiedProblem);

// User rejects identified problem and pays only service type fee
router.post('/:requestId/reject-identification', authenticateToken, rejectIdentifiedProblem);

// Expire old service requests (can be called by cron or manually)
router.post('/expire-old', async (req, res) => {
  try {
    const expiredCount = await expireOldServiceRequests();
    res.status(200).json({
      success: true,
      message: `Expired ${expiredCount} service requests`,
      expiredCount,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to expire service requests',
      error: error.message,
    });
  }
});

// Debug route to update knowsProblem for existing service requests
router.patch('/:id/update-knows-problem', authenticateToken, updateKnowsProblem);

// Admin route to set final price when repair is done
router.post('/:id/set-admin-final-price', authenticateToken, setAdminFinalPrice);
router.post('/:id/simulate-payment-ready', authenticateToken, simulateReadyForPayment);

// Download invoice PDF
router.get('/:id/invoice', authenticateToken, downloadInvoice);

// Device Handover Verification Image Uploads
// Captain image upload endpoints
router.post(
  '/:id/handover-images/captain',
  authenticateToken,
  upload.array('images', 10),
  uploadCaptainHandoverImages
);

// Technician image upload endpoints
router.post(
  '/:id/handover-images/technician',
  authenticateToken,
  upload.array('images', 10),
  uploadTechnicianHandoverImages
);

export default router;
