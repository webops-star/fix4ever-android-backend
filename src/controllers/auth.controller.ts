import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/user.model';
import { Request, Response } from 'express';
import dotenv from 'dotenv';
import otpGenerator from 'otp-generator';
import { auth } from 'express-openid-connect';
import { AuthRequest as AuthMiddlewareRequest } from '../middleware/auth.middleware';
import axios from 'axios';
import crypto from 'crypto';
import { OTP } from '../models/otp.model';
// AWS SNS SMS Sender imported
import { sendOTPViaSMS } from '../utils/smsSender';

// Helper to get cookie options for auth - enables mobile OAuth on production
// Production (HTTPS): sameSite='none' + secure=true - required for cross-site redirects (Google OAuth on mobile)
// Development (HTTP): sameSite='lax' + secure=false - sameSite='none' requires HTTPS
const getCookieOptions = (maxAgeMs?: number) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isHttps =
    isProduction || (process.env.BACKEND_URL && process.env.BACKEND_URL.startsWith('https'));
  const base = {
    httpOnly: true,
    path: '/',
    ...(maxAgeMs && { expires: new Date(Date.now() + maxAgeMs) }),
  };
  if (isHttps) {
    return { ...base, sameSite: 'none' as const, secure: true };
  }
  return { ...base, sameSite: 'lax' as const, secure: false };
};

// Helper functions to get URLs based on environment
// In production, these will throw errors if env vars are not set
const getFrontendUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.FRONTEND_URL) {
      throw new Error('FRONTEND_URL environment variable must be set in production');
    }
    return process.env.FRONTEND_URL;
  }
  // Development fallback
  return process.env.FRONTEND_URL || 'http://localhost:3000';
};

const getBackendUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.BACKEND_URL) {
      throw new Error('BACKEND_URL environment variable must be set in production');
    }
    return process.env.BACKEND_URL;
  }
  // Development fallback
  return process.env.BACKEND_URL || 'http://localhost:8080';
};

// Manual implementations to replace Arctic library
function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// Manual OAuth URL builders
const oauth = {
  google: {
    createAuthorizationURL: (state: string, codeVerifier: string, scopes: string[]) => {
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const redirectUri = `${getBackendUrl()}/api/auth/google/callback`;
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state: state,
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return new URL(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    },
    validateAuthorizationCode: async (code: string, codeVerifier: string) => {
      const redirectUri = `${getBackendUrl()}/api/auth/google/callback`;
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      return {
        idToken: () => response.data.id_token,
        accessToken: () => response.data.access_token,
      };
    },
  },
};

// Manual JWT decoder (simplified)
function decodeIdToken(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Error decoding ID token:', error);
    throw error;
  }
}

// Add interface for OAuth claims
interface OAuthClaims {
  sub: string;
  name?: string;
  email?: string;
  [key: string]: any;
}

interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}

dotenv.config();

function isStrongPassword(password: string): {
  valid: boolean;
  message?: string;
} {
  if (password.length < 8) {
    return {
      valid: false,
      message: 'Password must be at least 8 characters long.',
    };
  }

  let hasUpper = false;
  let hasLower = false;
  let hasDigit = false;
  let hasSpecial = false;

  const specials = "!@#$%^&*()-_=+[]{}|;:',.<>/?`~";

  for (let char of password) {
    if (char >= 'A' && char <= 'Z') hasUpper = true;
    else if (char >= 'a' && char <= 'z') hasLower = true;
    else if (char >= '0' && char <= '9') hasDigit = true;
    else if (specials.includes(char)) hasSpecial = true;
  }

  if (!hasUpper)
    return {
      valid: false,
      message: 'Password must contain at least one uppercase letter.',
    };
  if (!hasLower)
    return {
      valid: false,
      message: 'Password must contain at least one lowercase letter.',
    };
  if (!hasDigit)
    return {
      valid: false,
      message: 'Password must contain at least one digit.',
    };
  if (!hasSpecial)
    return {
      valid: false,
      message: 'Password must contain at least one special character.',
    };

  return { valid: true };
}

export const WorkSpaceOTPVerify = async (req: Request, res: Response) => {
  const { email, otp } = req.body;
  console.log(req.body);
  try {
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP required for verification',
      });
    }

    const recentOtp = await OTP.findOne({ email }).sort({ createdAt: -1 });

    if (!recentOtp) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found. Please request a new one.',
      });
    }

    const isExpired = Date.now() - new Date(recentOtp.createdAt).getTime() > 5 * 60 * 1000;

    if (isExpired) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired. Please request a new one.',
      });
    }

    if (recentOtp.otp === otp) {
      return res.status(400).json({
        success: false,
        message: 'The OTP is not valid',
      });
    }

    await OTP.deleteMany({ email });

    return res.status(200).json({
      success: true,
      message: 'Verification successfully done.',
    });
  } catch (error: any) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong while verifying OTP.',
      error: error.message,
    });
  }
};
export const signup = async (req: Request, res: Response) => {
  const { username, email, phone, password, otp, referralCode } = req.body;
  try {
    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required.' });
    }
    if (!password) {
      return res.status(400).json({ message: 'Password is required.' });
    }

    if (!otp) {
      return res.status(400).json({ message: 'OTP is required.' });
    }

    const passwordCheck = isStrongPassword(password);

    if (!passwordCheck.valid) {
      return res.status(400).json({ message: passwordCheck.message });
    }
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.status(400).json({
        message: 'User already exists with this email or phone number.',
      });
    }

    const recentOtp = await OTP.find({ email }).sort({ createdAt: -1 }).limit(1);

    if (recentOtp.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found. Please request a new one.',
      });
    }

    if (otp !== recentOtp[0].otp) {
      return res.status(400).json({
        success: false,
        message: 'The OTP is not valid',
      });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username,
      email,
      phone,
      password: hashedPassword,
    });

    await newUser.save();

    // Handle referral code (non-blocking — errors here must not break signup)
    if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
      try {
        const { validateReferralCode, createReferralEvent } = require('../utils/referralService');
        const validation = await validateReferralCode(referralCode.trim(), newUser._id.toString());
        if (validation.valid && validation.referrerId) {
          const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString() || '';
          const deviceFingerprint = req.headers['x-device-fingerprint']?.toString() || '';
          await createReferralEvent(
            validation.referrerId,
            newUser._id.toString(),
            referralCode.trim(),
            deviceFingerprint,
            ipAddress
          );
        }
      } catch (refErr) {
        console.error('Referral processing error (non-fatal):', refErr);
      }
    }

    // Generate JWT token for immediate login after signup
    const token = jwt.sign(
      { id: newUser._id },
      process.env.JWT_SECRET as string,
      { expiresIn: '24h' }
    );

    const refreshToken = jwt.sign(
      { id: newUser._id, type: 'refresh' },
      process.env.JWT_SECRET as string,
      { expiresIn: '180d' }
    );

    // Set cookie for session management
    res.cookie('token', token, getCookieOptions(24 * 60 * 60 * 1000));

    // Return user data and token for frontend authentication
    const userResponse = {
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      phone: newUser.phone,
      role: newUser.role || 'user',
    };

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      token,
      refreshToken,
      user: userResponse,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Something went wrong while signing up.',
      error: error.message,
    });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password, otp } = req.body;
  try {
    if (!email) {
      return res.status(400).json({ message: 'Email or phone number is required.' });
    }

    if (!password) {
      return res.status(400).json({ message: 'Password is required.' });
    }
    if (!otp) {
      return res.status(400).json({ message: 'OTP is required.' });
    }
    const user = await User.findOne({
      $or: [{ email }],
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password.' });
    }
    const recentOtp = await OTP.find({ email }).sort({ createdAt: -1 }).limit(1);

    if (recentOtp.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No OTP found. Please request a new one.',
      });
    }

    if (recentOtp[0].otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'This OTP is not valid.',
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role || 'user',
        phone: user.phone,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '24h' }
    );

    const refreshToken = jwt.sign(
      { id: user._id, type: 'refresh' },
      process.env.JWT_SECRET as string,
      { expiresIn: '180d' }
    );

    res.cookie('token', token, getCookieOptions(24 * 60 * 60 * 1000));

    // Return user data and token for frontend authentication
    const userResponse = {
      _id: user._id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role || 'user',
    };

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      refreshToken,
      user: userResponse,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Something went wrong while logging in.',
      error: error.message,
    });
  }
};

export const loginwithphone = async (req: Request, res: Response) => {
  const { countryCode, phone, password, otp } = req.body;
  try {
    if (!countryCode || !phone) {
      return res.status(400).json({ message: 'Country code and phone number are required.' });
    }

    if (!password) {
      return res.status(400).json({ message: 'Password is required.' });
    }

    if (!otp) {
      return res.status(400).json({ message: 'OTP is required.' });
    }

    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password.' });
    }

    // Verify OTP from database (stored with phone as key)
    const fullPhone = `${countryCode}${phone}`;
    const recentOtp = await OTP.find({ email: fullPhone }).sort({ createdAt: -1 }).limit(1);

    if (recentOtp.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found. Please request a new one.',
      });
    }

    if (recentOtp[0].otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP.',
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role || 'user',
        phone: user.phone,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '24h' }
    );

    const refreshToken = jwt.sign(
      { id: user._id, type: 'refresh' },
      process.env.JWT_SECRET as string,
      { expiresIn: '180d' }
    );

    res.cookie('token', token, getCookieOptions(24 * 60 * 60 * 1000));

    // Return user data and token for frontend authentication
    const userResponse = {
      _id: user._id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role || 'user',
    };

    return res.status(200).json({
      success: true,
      message: 'Phone login successful.',
      token,
      refreshToken,
      user: userResponse,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Something went wrong while logging in.',
      error: error.message,
    });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  const { email, countryCode, phone } = req.body;
  try {
    if (!email && !phone) {
      return res.status(400).json({ message: 'Email or phone number is required.' });
    }
    if (!countryCode && phone) {
      return res.status(400).json({
        message: 'Country code is required when providing phone number.',
      });
    }
    const user = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (email) {
      let otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });

      let result = await OTP.findOne({ otp: otp });
      while (result) {
        otp = otpGenerator.generate(6, {
          upperCaseAlphabets: false,
          lowerCaseAlphabets: false,
          specialChars: false,
        });
        result = await OTP.findOne({ otp: otp });
      }

      const otpPayload = { email, otp };
      await OTP.create(otpPayload);
      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully, please check your email.',
      });
    } else {
      // Generate OTP for phone
      let otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });

      let result = await OTP.findOne({ otp: otp });
      while (result) {
        otp = otpGenerator.generate(6, {
          upperCaseAlphabets: false,
          lowerCaseAlphabets: false,
          specialChars: false,
        });
        result = await OTP.findOne({ otp: otp });
      }

      const fullPhone = `${countryCode}${phone}`;

      // Delete any existing OTP for this phone
      await OTP.deleteMany({ email: fullPhone });

      // Store OTP in database
      const otpPayload = { email: fullPhone, otp };
      await OTP.create(otpPayload);

      // Send OTP via AWS SNS
      await sendOTPViaSMS(fullPhone, otp);

      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully to phone.',
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Something went wrong while resetting password.',
      error: error.message,
    });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { email, phone, otp, countryCode, newPassword } = req.body;
  try {
    if (!email && !phone) {
      return res.status(400).json({ message: 'Email or phone number is required.' });
    }
    if (!countryCode && phone) {
      return res.status(400).json({
        message: 'Country code is required when providing phone number.',
      });
    }

    if (!otp) {
      return res.status(400).json({ message: 'OTP is required.' });
    }

    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required.' });
    }

    const passwordCheck = isStrongPassword(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({ message: passwordCheck.message });
    }

    const user = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (email) {
      const recentOtp = await OTP.find({ email }).sort({ createdAt: -1 }).limit(1);
      if (recentOtp.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No OTP found. Please request a new one.',
        });
      }
      if (recentOtp[0].otp !== otp) {
        return res.status(400).json({
          success: false,
          message: 'This OTP is not valid.',
        });
      }
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      user.password = hashedPassword;
      await user.save();
      return res.status(200).json({ success: true, message: 'Password reset successfully.' });
    } else {
      // Verify OTP from database (stored with phone as key)
      const fullPhone = `${countryCode}${phone}`;
      const recentOtp = await OTP.find({ email: fullPhone }).sort({ createdAt: -1 }).limit(1);

      if (recentOtp.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No OTP found. Please request a new one.',
        });
      }

      if (recentOtp[0].otp !== otp) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP.',
        });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      user.password = hashedPassword;
      await user.save();
      return res.status(200).json({ success: true, message: 'Password reset successfully.' });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Something went wrong while resetting password.',
      error: error.message,
    });
  }
};
export const socialLogin = async (req: Request, res: Response) => {
  try {
    if (req.oidc.isAuthenticated()) {
      const user = req.oidc.user;

      let existingUser = await User.findOne({ email: user?.email });

      if (!existingUser) {
        const randomPass = await bcrypt.hash(crypto.randomUUID(), 10);
        existingUser = new User({
          username: user?.name || user?.email.split('@')[0],
          email: user?.email,
          phone: user?.phone || '',
          password: randomPass,
        });
        await existingUser.save();
      }

      const token = jwt.sign(
        {
          id: existingUser._id,
          email: existingUser.email,
          username: existingUser.username,
          role: existingUser.role || 'user',
          phone: existingUser.phone,
        },
        process.env.JWT_SECRET!,
        {
          expiresIn: '24h', // Extended from 1h to 24h
        }
      );

      res.cookie('token', token, {
        ...getCookieOptions(24 * 60 * 60 * 1000),
        maxAge: 24 * 60 * 60 * 1000,
      });

      res.redirect(getFrontendUrl());
    } else {
      return res.status(401).json({ success: true, message: 'Not authenticated with Auth0' });
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Social login error',
      error: err.message,
    });
  }
};
export const getProfile = async (req: AuthMiddlewareRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};
export const updateProfile = async (req: AuthMiddlewareRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { username, phone } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { username, phone },
      { new: true, select: '-password' }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};
export const updatePassword = async (req: AuthMiddlewareRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    const passwordCheck = isStrongPassword(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message,
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    await User.findByIdAndUpdate(userId, { password: hashedNewPassword });

    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

export const googleLogin = async (req: Request, res: Response) => {
  try {
    console.log('🔄 Google OAuth login initiated');

    // Check if OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('❌ Google OAuth not configured');
      return res.status(500).json({
        success: false,
        message: 'Google OAuth is not configured',
      });
    }

    if (req?.user) {
      console.log('✅ User already authenticated, redirecting to dashboard');
      return res.redirect(`${getFrontendUrl()}/dashboard`);
    }

    console.log('🔄 Generating OAuth state and code verifier...');
    // const state = generateState();
    const frontend = (req.query.frontend as string) || 'app';
    const state = `${frontend}:${generateState()}`;
    const codeVerifier = generateCodeVerifier();

    console.log('🔄 Creating Google authorization URL...');
    const url = oauth.google.createAuthorizationURL(state, codeVerifier, [
      'openid',
      'profile',
      'email',
    ]);

    console.log('🔄 Setting OAuth cookies...');
    const cookieOptions = {
      ...getCookieOptions(600 * 1000), // 10 min for OAuth flow
      maxAge: 600 * 1000, // 10 min in ms
    };
    res.cookie('google_oauth_state', state, cookieOptions);
    res.cookie('google_oauth_code_verifier', codeVerifier, cookieOptions);

    console.log('✅ Redirecting to Google OAuth URL:', url.toString());
    res.redirect(url.toString());
  } catch (error: any) {
    console.error('❌ Google OAuth login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Google OAuth',
      error: error.message,
    });
  }
};

export const googleCallback = async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const { google_oauth_state: storedState, google_oauth_code_verifier: codeVerifier } = req.cookies;

  // Log missing data to help debug (e.g. cookies not sent due to cross-origin or blocking)
  if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
    const missing: string[] = [];
    if (!code) missing.push('code');
    if (!state) missing.push('state');
    if (!storedState) missing.push('google_oauth_state cookie');
    if (!codeVerifier) missing.push('google_oauth_code_verifier cookie');
    if (state && storedState && state !== storedState) missing.push('state_mismatch');
    console.error('❌ Google OAuth callback failed - missing or invalid:', missing.join(', '));
    console.error(
      '   Ensure redirect URI in Google Console is exactly:',
      `${getBackendUrl()}/api/auth/google/callback`
    );
    return res.redirect(`${getFrontendUrl()}/auth/login?error=oauth_failed`);
  }

  let tokens;

  try {
    tokens = await oauth.google.validateAuthorizationCode(code as string, codeVerifier);
  } catch (error: any) {
    const errData = error?.response?.data;
    const errMsg = errData?.error_description || errData?.error || error?.message;
    console.error('❌ Google token exchange failed:', errMsg || error);
    if (errData?.error === 'redirect_uri_mismatch') {
      console.error(
        '   Add this exact URI in Google Cloud Console → APIs & Services → Credentials → Your OAuth client → Authorized redirect URIs:'
      );
      console.error('   ', `${getBackendUrl()}/api/auth/google/callback`);
    }
    return res.redirect(`${getFrontendUrl()}/auth/login?error=oauth_failed`);
  }

  console.log('token google', tokens);
  const claims = (await decodeIdToken(tokens.idToken())) as OAuthClaims;
  const { sub: googleUserId, name, email } = claims;

  //User already with oauth linked - with timeout protection
  let user;
  try {
    console.log('🔄 Attempting to find user with email:', email);
    const startTime = Date.now();

    user = (await Promise.race([
      User.findOne({ email }).lean(), // Simplified query and use .lean() for better performance
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 15000) // Increased from 5s to 15s
      ),
    ])) as any;

    const queryTime = Date.now() - startTime;
    console.log(`✅ User lookup completed in ${queryTime}ms`);
  } catch (dbError: any) {
    console.error('❌ Database error during OAuth user lookup:', {
      error: dbError.message,
      email: email,
      stack: dbError.stack,
      mongooseState: mongoose.connection.readyState, // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    });
    return res.redirect(`${getFrontendUrl()}/auth/login?error=database_timeout`);
  }

  let isNewUser = false;

  // If user does not exist, create a new user
  if (!user) {
    // Generate a unique phone number for OAuth users to avoid duplicate key errors
    const oauthPhoneNumber = `oauth_google_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
      console.log('🔄 Creating new user via Google OAuth:', email);
      const createStartTime = Date.now();

      user = (await Promise.race([
        User.create({
          username: name,
          email,
          phone: oauthPhoneNumber,
          password: 'null',
        }),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error('Database create timeout')), 20000) // Increased from 8s to 20s
        ),
      ])) as any;

      const createTime = Date.now() - createStartTime;
      isNewUser = true;
      console.log(`✅ New user created via Google OAuth in ${createTime}ms: ${email}`);
    } catch (createError: any) {
      console.error('❌ Database error during OAuth user creation:', {
        error: createError.message,
        email: email,
        stack: createError.stack,
        mongooseState: mongoose.connection.readyState,
      });
      return res.redirect(`${getFrontendUrl()}/auth/login?error=user_creation_failed`);
    }
  }

  // Generate JWT token
  const jwtToken = jwt.sign(
    {
      id: user._id,
      email: user.email,
      username: user.username,
      role: user.role || 'user',
      phone: user.phone,
    },
    process.env.JWT_SECRET!,
    {
      expiresIn: '24h', // Extended from 1h to 24h
    }
  );
  // Set cookie with JWT token
  res.cookie('token', jwtToken, getCookieOptions(24 * 60 * 60 * 1000));

  // Clear OAuth cookies (same path as when set)
  res.clearCookie('google_oauth_state', { path: '/' });
  res.clearCookie('google_oauth_code_verifier', { path: '/' });

  // Redirect to OAuth callback page for frontend to handle
  // Extract frontend from OAuth state
  const [frontend] = (state as string).split(':');

  // Decide redirect base URL
  const adminFrontend = 'http://localhost:5173';
  const appFrontend = getFrontendUrl(); // defaults to 3000

  const redirectBase = frontend === 'admin' ? adminFrontend : appFrontend;

  // Redirect to correct frontend OAuth callback
  const callbackUrl = isNewUser
    ? `${redirectBase}/auth/oauth/callback?provider=google&isNewUser=true`
    : `${redirectBase}/auth/oauth/callback?provider=google`;

  return res.redirect(callbackUrl);
};

// Update user role (for role selection after OAuth)
export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!role || !['user', 'vendor'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be "user" or "vendor"',
      });
    }

    // Find and update user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Update user role
    user.role = role;
    if (role === 'vendor') {
      user.isVendor = true;
    }
    await user.save();

    console.log(`✅ User role updated: ${user.email} -> ${role}`);

    // Return updated user data
    const userResponse = {
      _id: user._id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isVendor: user.isVendor || false,
    };

    return res.status(200).json({
      success: true,
      message: 'Role updated successfully',
      user: userResponse,
    });
  } catch (error: any) {
    console.error('❌ Update user role error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update user role',
      error: error.message,
    });
  }
};

export const refreshAccessToken = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token is required.' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET as string) as any;

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.', error: 'REFRESH_TOKEN_INVALID' });
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.', error: 'USER_NOT_FOUND' });
    }

    const newToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role || 'user',
        phone: user.phone,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '24h' }
    );

    return res.status(200).json({ success: true, token: newToken });
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Refresh token expired. Please log in again.', error: 'REFRESH_TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid refresh token.', error: 'REFRESH_TOKEN_INVALID' });
  }
};
