import express from 'express';
import {
  getVendorApplications,
  getVendorApplication,
  reviewVendorApplication,
  getVendorStats,
  assignTechnicianToRequest,
  getAllServiceRequests,
  getAvailableTechnicians,
  verifyAdminAccess,
  getTestSubmissions,
  downloadTestVideo,
  patchTestSubmissionReview,
  getAllUsers,
  getUserById,
  getAnalytics,
} from '../controllers/admin.controller';
import {
  getReferralConfig,
  updateReferralConfig,
  getFraudQueue,
  approveHeldReward,
  blockHeldReward,
  getReferralAnalytics,
  listCoupons,
  createCoupon,
  updateCouponStatus,
  getCouponUsage,
} from '../controllers/adminReferralCoupon.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = express.Router();

// Admin verification route
router.get('/verify', authenticateToken, verifyAdminAccess);

// Admin user management routes
router.get('/users', authenticateToken, getAllUsers);
router.get('/users/:userId', authenticateToken, getUserById);

// Admin analytics
router.get('/analytics', authenticateToken, getAnalytics);

// Admin vendor management routes
router.get('/vendor-applications', authenticateToken, getVendorApplications);
router.get('/vendor-applications/:vendorId', authenticateToken, getVendorApplication);
router.post('/vendor-applications/:vendorId/review', authenticateToken, reviewVendorApplication);
router.get('/vendor-stats', authenticateToken, getVendorStats);

// Admin service request management routes
router.post('/assign-technician', authenticateToken, assignTechnicianToRequest);
router.get('/service-requests', authenticateToken, getAllServiceRequests);
router.get('/available-technicians', authenticateToken, getAvailableTechnicians);

// Admin test submission routes
router.get('/test-submissions', authenticateToken, getTestSubmissions);
router.get('/test-submissions/:userId/videos/:questionId', authenticateToken, downloadTestVideo);
router.patch('/test-submissions/:userId/review', authenticateToken, patchTestSubmissionReview);

// Admin referral config & analytics
router.get('/referral/config', authenticateToken, getReferralConfig);
router.put('/referral/config', authenticateToken, updateReferralConfig);
router.get('/referral/fraud-queue', authenticateToken, getFraudQueue);
router.post('/referral/release/:id', authenticateToken, approveHeldReward);
router.post('/referral/block/:id', authenticateToken, blockHeldReward);
router.get('/referral/analytics', authenticateToken, getReferralAnalytics);

// Admin coupon management
router.get('/coupon/list', authenticateToken, listCoupons);
router.post('/coupon/create', authenticateToken, createCoupon);
router.put('/coupon/:id/status', authenticateToken, updateCouponStatus);
router.get('/coupon/:id/usage', authenticateToken, getCouponUsage);

export default router;
