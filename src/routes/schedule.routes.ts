import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  proposeSchedule,
  updateScheduleWithSlots,
  respondToSchedule,
  getAvailableSlots,
  getTodaySchedule,
  schedulePickup,
  confirmPickup,
  scheduleDrop,
  confirmDrop,
  checkSlotAvailability,
} from '../controllers/schedule.controller';

const router = express.Router();

// Check slot availability for multiple dates
router.post('/check-availability', authenticateToken, checkSlotAvailability);

// Vendor proposes a schedule for a service request
router.post('/propose/:serviceRequestId', authenticateToken, proposeSchedule);

// Vendor updates schedule with multiple available slots
router.put('/update-slots/:serviceRequestId', authenticateToken, updateScheduleWithSlots);

// Customer responds to proposed schedule
router.post('/respond/:serviceRequestId', authenticateToken, respondToSchedule);

// Get available time slots for a specific date
router.get('/available-slots/:date', authenticateToken, getAvailableSlots);

// Get vendor's schedule for today
router.get('/today', authenticateToken, getTodaySchedule);

// Pickup/Drop scheduling routes for pickup-drop service type
router.post('/pickup/:serviceRequestId', authenticateToken, schedulePickup);
router.post('/pickup/:serviceRequestId/confirm', authenticateToken, confirmPickup);
router.post('/drop/:serviceRequestId', authenticateToken, scheduleDrop);
router.post('/drop/:serviceRequestId/confirm', authenticateToken, confirmDrop);

export default router;
