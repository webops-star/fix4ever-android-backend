import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  validateCouponController,
  applyCouponController,
  getMyCoupons,
} from '../controllers/coupon.controller';

const router = Router();

// All coupon routes require authentication
router.use(authenticateToken);

router.get('/my-coupons', getMyCoupons);
router.post('/validate', validateCouponController);
router.post('/apply', applyCouponController);

export default router;
