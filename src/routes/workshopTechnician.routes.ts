import express from 'express';
import {
  inviteTechnician,
  verifyInvite,
  onboardTechnician,
  getWorkshopTechnicians,
  getMyTechnicianProfile,
} from '../controllers/workshopTechnician.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { upload } from '../middleware/multer.middleware';

const router = express.Router();

// Verify an invite token (public - no auth needed)
router.get('/verify-invite/:token', verifyInvite);

// Invite a technician (vendor only)
router.post('/invite', authenticateToken, inviteTechnician);

// Technician submits onboarding form (requires auth + invite token in body)
router.post(
  '/onboard',
  authenticateToken,
  upload.fields([
    { name: 'governmentIdProof', maxCount: 1 },
    { name: 'selfieVerification', maxCount: 1 },
    { name: 'cancelledCheque', maxCount: 1 },
  ]),
  onboardTechnician
);

// Get all technicians for a workshop (vendor only)
router.get('/workshop/:workshopId', authenticateToken, getWorkshopTechnicians);

// Get current technician's own profile
router.get('/my-profile', authenticateToken, getMyTechnicianProfile);

export default router;
