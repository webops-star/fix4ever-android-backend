import { Router } from 'express';
import {
  addReview,
  getVendorReviews,
  getVendorRatingStats,
  updateReview,
  deleteReview,
  checkReviewStatus,
  markReviewAsHelpful,
} from '../controllers/review.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/:vendorId/review', authenticateToken, addReview);
router.get('/:vendorId/review', getVendorReviews);
router.get('/:vendorId/rating-stats', getVendorRatingStats);
router.get('/check/:vendorId/:serviceRequestId', authenticateToken, checkReviewStatus);
router.put('/review/:reviewId', authenticateToken, updateReview);
router.delete('/review/:reviewId', authenticateToken, deleteReview);
router.post('/review/:reviewId/helpful', authenticateToken, markReviewAsHelpful);
export default router;
