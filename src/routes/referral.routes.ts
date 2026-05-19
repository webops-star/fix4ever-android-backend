import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getMyReferralCode,
  getReferralHistoryController,
  getCustomerWallet,
} from '../controllers/referral.controller';

const router = Router();

// All referral routes require authentication
router.use(authenticateToken);

router.get('/my-code', getMyReferralCode);
router.get('/history', getReferralHistoryController);
router.get('/wallet', getCustomerWallet);

export default router;
