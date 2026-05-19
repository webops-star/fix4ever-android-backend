import { Router } from 'express';
import {
  createOrUpdateDraft,
  getMyDrafts,
  getDraftById,
  convertDraftToServiceRequest,
  deleteDraft,
  cleanupExpiredDrafts,
  migrateDrafts,
} from '../controllers/draftServiceRequest.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { draftAuth } from '../middleware/draft-auth.middleware';
import { upload } from '../middleware/multer.middleware';

const router = Router();

// Create or update a draft service request
router.post('/', draftAuth, createOrUpdateDraft);

// Migrate drafts from sessionId to authenticated user
router.post('/migrate', authenticateToken, migrateDrafts);

// Get user's draft service requests (requires authentication or session)
router.get('/my-drafts', draftAuth, getMyDrafts);

// Get a specific draft by ID
router.get('/:id', draftAuth, getDraftById);

// Convert draft to actual service request
router.post(
  '/:id/convert',
  authenticateToken,
  upload.array('issueImages', 5),
  convertDraftToServiceRequest
);

// Delete a draft
router.delete('/:id', draftAuth, deleteDraft);

// Cleanup expired drafts (admin endpoint)
router.delete('/cleanup/expired', cleanupExpiredDrafts);

export default router;
