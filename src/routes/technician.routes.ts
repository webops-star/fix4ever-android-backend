import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { getAllTechnicians } from '../controllers/technician.controller';

const router = Router();

// Get all technicians (approved vendors with services offered)
router.get('/all', authenticateToken, getAllTechnicians);

export default router;
