import express from 'express';
import * as captainController from '../controllers/captain.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { upload } from '../middleware/multer.middleware';

const router = express.Router();

// Captain onboarding routes
router.post('/onboard', authenticateToken, captainController.createCaptainProfile);
router.put(
  '/onboard/vehicle-details',
  authenticateToken,
  upload.fields([
    { name: 'registrationCertificate', maxCount: 1 },
    { name: 'insuranceDocument', maxCount: 1 },
    { name: 'vehiclePhotos', maxCount: 5 },
  ]),
  captainController.updateVehicleDetails
);
router.put(
  '/onboard/driving-license',
  authenticateToken,
  upload.single('licensePhoto'),
  captainController.updateDrivingLicense
);
router.put(
  '/onboard/identity-verification',
  authenticateToken,
  upload.fields([
    { name: 'governmentIdProof', maxCount: 1 },
    { name: 'selfieVerification', maxCount: 1 },
  ]),
  captainController.updateIdentityVerification
);
router.put(
  '/onboard/bank-details',
  authenticateToken,
  upload.single('cancelledCheque'),
  captainController.updateBankDetails
);
router.put(
  '/onboard/service-preferences',
  authenticateToken,
  captainController.updateServicePreferences
);
router.put('/onboard/submit', authenticateToken, captainController.submitOnboarding);

// Captain profile routes
router.get('/profile', authenticateToken, captainController.getCaptainProfile);
router.put('/update-location', authenticateToken, captainController.updateCaptainLocation);
router.put('/update-availability', authenticateToken, captainController.updateAvailabilityStatus);

// Status check route
router.get('/status', authenticateToken, captainController.checkCaptainStatus);

// Captain job routes
router.get('/jobs/active', authenticateToken, captainController.getActiveJobs);
router.get('/jobs/completed', authenticateToken, captainController.getCompletedJobs);

// Admin routes for captain management
router.get('/admin/applications', authenticateToken, captainController.getAllCaptainApplications);
router.get('/admin/stats', authenticateToken, captainController.getCaptainStats);
router.get('/admin/:id', authenticateToken, captainController.getCaptainById);
router.post('/admin/:id/review', authenticateToken, captainController.reviewCaptainApplication);

export default router;
