import express from 'express';
import * as pickupRequestController from '../controllers/pickupRequest.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = express.Router();

// Vendor routes
router.post('/create', authenticateToken, pickupRequestController.createPickupRequest);
router.get('/vendor/active', authenticateToken, pickupRequestController.getVendorActivePickups);
router.get('/vendor/history', authenticateToken, pickupRequestController.getVendorPickupHistory);

// Captain routes
router.get('/captain/active', authenticateToken, pickupRequestController.getCaptainActiveJobs);
router.get(
  '/captain/completed',
  authenticateToken,
  pickupRequestController.getCaptainCompletedJobs
);
router.put('/:id/status', authenticateToken, pickupRequestController.updatePickupStatus);

// Shared routes
router.get('/:id', authenticateToken, pickupRequestController.getPickupRequestDetails);

export default router;
