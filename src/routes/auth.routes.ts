import {
  login,
  loginwithphone,
  signup,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  updatePassword,
  googleLogin,
  googleCallback,
  updateUserRole,
  WorkSpaceOTPVerify,
  refreshAccessToken,
} from '../controllers/auth.controller';
import {
  sendOTP,
  sendLoginOTP,
  sendOTPToPhone,
  sendOTPworkspace,
} from '../controllers/otp.controller';
import { Router } from 'express';
import dotenv from 'dotenv';
import { authenticateToken } from '../middleware/auth.middleware';
dotenv.config();

const router = Router();

router.post('/send-otp', sendOTP);
router.post('/send-otp-workspace', sendOTPworkspace);
router.post('/login/send-otp', sendLoginOTP);
router.post('/signup', signup);
router.post('/verify-otp-workspace', WorkSpaceOTPVerify);
router.post('/login', login);
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.status(200).json({ success: true, message: 'Logged out successfully' });
});
router.post('/login/phone/send-otp', sendOTPToPhone);
router.post('/login/phone/verify-otp', loginwithphone);
router.post('/refresh-token', refreshAccessToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/profile', authenticateToken, getProfile);
router.put('/update-profile', authenticateToken, updateProfile);
router.post('/update-password', authenticateToken, updatePassword);
router.put('/update-role', authenticateToken, updateUserRole);
router.get('/google/login', googleLogin);
router.get('/google/callback', googleCallback);

export default router;
