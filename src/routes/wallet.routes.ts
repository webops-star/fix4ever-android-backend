import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getWalletBalance,
  getWalletTransactions,
  updateBankDetails,
  requestSettlement,
  getSettlementRequests,
  cancelSettlementRequest,
  getAllSettlementRequests,
  approveSettlement,
  rejectSettlement,
  getWalletAnalytics,
  getAdminWalletStats,
} from '../controllers/wallet.controller';

const router = express.Router();

router.get('/balance', authenticateToken, getWalletBalance);
router.get('/transactions', authenticateToken, getWalletTransactions);
router.get('/analytics', authenticateToken, getWalletAnalytics);
router.put('/bank-details', authenticateToken, updateBankDetails);
router.post('/settlement/request', authenticateToken, requestSettlement);
router.get('/settlement/my-requests', authenticateToken, getSettlementRequests);
router.delete('/settlement/:settlementId', authenticateToken, cancelSettlementRequest);

router.get('/admin/settlements', authenticateToken, getAllSettlementRequests);
router.get('/admin/stats', authenticateToken, getAdminWalletStats);
router.put('/admin/settlement/:settlementId/approve', authenticateToken, approveSettlement);
router.put('/admin/settlement/:settlementId/reject', authenticateToken, rejectSettlement);

export default router;
