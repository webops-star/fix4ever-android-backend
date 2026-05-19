import express from 'express';
import { createSpace, getWorkSpace } from '../controllers/workshop.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = express.Router();

router.post('/create-workSpace', authenticateToken, createSpace);
router.get('/getWorkSpace', authenticateToken, getWorkSpace);

export default router;
