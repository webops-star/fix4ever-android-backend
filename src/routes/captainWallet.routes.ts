import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getCaptainWalletBalance,
  getCaptainWalletTransactions,
  getCaptainWalletAnalytics,
  updateCaptainBankDetails,
  requestCaptainSettlement,
  getCaptainSettlementRequests,
  cancelCaptainSettlementRequest,
  getAllCaptainSettlementRequests,
  getCaptainWalletAdminStats,
  approveCaptainSettlement,
  rejectCaptainSettlement,
} from '../controllers/captainWallet.controller';

const router = express.Router();

// Captain routes
router.get('/balance', authenticateToken, getCaptainWalletBalance);
router.get('/transactions', authenticateToken, getCaptainWalletTransactions);
router.get('/analytics', authenticateToken, getCaptainWalletAnalytics);
router.put('/bank-details', authenticateToken, updateCaptainBankDetails);
router.post('/settlement/request', authenticateToken, requestCaptainSettlement);
router.get('/settlement/my-requests', authenticateToken, getCaptainSettlementRequests);
router.delete('/settlement/:settlementId', authenticateToken, cancelCaptainSettlementRequest);

// Admin routes
router.get('/admin/settlements', authenticateToken, getAllCaptainSettlementRequests);
router.get('/admin/stats', authenticateToken, getCaptainWalletAdminStats);
router.put('/admin/settlement/:settlementId/approve', authenticateToken, approveCaptainSettlement);
router.put('/admin/settlement/:settlementId/reject', authenticateToken, rejectCaptainSettlement);

export default router;
