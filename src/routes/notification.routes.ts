import express from 'express';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  createNotificationHandler,
} from '../controllers/notification.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = express.Router();

// Get user notifications
router.post('/createNotification', createNotificationHandler);
router.get('/', authenticateToken, getUserNotifications);

// Mark notification as read
router.patch('/:notificationId/read', authenticateToken, markNotificationAsRead);

// Mark all notifications as read
router.patch('/mark-all-read', authenticateToken, markAllNotificationsAsRead);

// Delete notification
router.delete('/:notificationId', authenticateToken, deleteNotification);

export default router;
