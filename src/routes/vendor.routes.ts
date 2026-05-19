import express from 'express';
import {
  createVendorProfile,
  updateVendorProfile,
  getVendorProfile,
  updateVendorOnboardingStep,
  getVendorOnboardingStatus,
  vendorOnboarding,
  submitVendorApplication,
  getVendorStats,
  getVendorAssignedRequests,
  updateRequestStatus,
  getAllVendors,
  getAssignedTechnicians,
  getVendorStatus,
  getNearbyVendors,
} from '../controllers/vendor.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { upload } from '../middleware/multer.middleware';
import { Request, Response } from 'express';

const router = express.Router();

// Get all vendors endpoint
router.get('/all', getAllVendors);

// Get nearby vendors within a radius (no auth needed — used on service request creation screen)
router.get('/nearby', getNearbyVendors);

// Get assigned technicians for a user
router.get('/assigned', getAssignedTechnicians);

// Quick setup endpoint for testing - creates a basic vendor profile
router.post('/quick-setup', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Check if vendor profile already exists
    const Vendor = require('../models/vendor.model').default;
    const User = require('../models/user.model').default;

    const existingVendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (existingVendor) {
      return res.status(200).json({
        success: true,
        message: 'Vendor profile already exists',
        vendor: existingVendor,
      });
    }

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Create basic vendor profile
    const vendorData = {
      pocInfo: {
        userId: userId,
        fullName: user.username || 'Test Vendor',
        email: user.email,
        phone: user.phone,
        correspondenceAddress: 'Test Address, Test City',
      },
      businessDetails: {
        businessName: 'Test Business',
        businessType: 'Individual',
        gstNumber: 'TEST123456789',
        registrationNumber: 'TEST123',
      },
      servicesOffered: {
        categories: ['electronics', 'appliances'],
        serviceTypes: ['repair', 'maintenance'],
        description: 'Test services',
      },
      operationalDetails: {
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        workingHours: { start: '09:00', end: '18:00' },
        serviceAreas: ['Test City'],
      },
      currentLocation: {
        latitude: 0,
        longitude: 0,
      },
      termsAndConditionsAccepted: true,
      onboardingStatus: 'Approved',
    };

    const newVendor = new Vendor(vendorData);
    await newVendor.save();

    res.status(201).json({
      success: true,
      message: 'Basic vendor profile created successfully',
      vendor: newVendor,
    });
  } catch (error) {
    console.error('Quick setup error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// New unified onboarding endpoint with file upload support
router.post(
  '/onboarding',
  authenticateToken,
  upload.fields([
    { name: 'panCard', maxCount: 1 },
    { name: 'businessRegistrationProof', maxCount: 1 },
    { name: 'experienceCertificate', maxCount: 1 },
    { name: 'fixforeverCertificate', maxCount: 1 },
    { name: 'governmentIdProof', maxCount: 1 },
    { name: 'panCardProof', maxCount: 1 },
    { name: 'selfieVerification', maxCount: 1 },
    { name: 'cancelledCheque', maxCount: 1 },
  ]),
  vendorOnboarding
);

// Submit vendor application for review
router.post('/submit', authenticateToken, submitVendorApplication);

// Get vendor status for frontend refresh
router.get('/status', authenticateToken, getVendorStatus);

// Dashboard endpoints
router.get('/stats', authenticateToken, getVendorStats);
router.get('/assigned-requests', authenticateToken, getVendorAssignedRequests);
router.patch('/requests/:requestId/status', authenticateToken, updateRequestStatus);

// Existing routes
router.post('/onboard', authenticateToken, createVendorProfile);
router.put(
  '/profile',
  authenticateToken,
  upload.fields([
    { name: 'panCard', maxCount: 1 },
    { name: 'businessRegistrationProof', maxCount: 1 },
    { name: 'experienceCertificate', maxCount: 1 },
    { name: 'fixforeverCertificate', maxCount: 1 },
    { name: 'governmentIdProof', maxCount: 1 },
    { name: 'panCardProof', maxCount: 1 },
    { name: 'selfieVerification', maxCount: 1 },
    { name: 'cancelledCheque', maxCount: 1 },
  ]),
  updateVendorProfile
);
router.get('/profile', authenticateToken, getVendorProfile);

// Multi-step onboarding routes (legacy)
router.put('/onboard/:step', authenticateToken, updateVendorOnboardingStep);
router.get('/onboarding-status', authenticateToken, getVendorOnboardingStatus);

// Get specific vendor by ID - this should be last to avoid conflicts
router.get('/:vendorId', async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    const Vendor = require('../models/vendor.model').default;

    const vendor = await Vendor.findById(vendorId).select('-__v');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found',
      });
    }

    res.status(200).json({
      success: true,
      data: vendor,
    });
  } catch (error: any) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

export default router;
