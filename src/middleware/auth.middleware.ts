import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/user.model';

export interface AuthRequest extends Request {
  user?: any;
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Try to get token from multiple sources
  let token: string | null = null;
  let tokenSource = '';

  // 1. Check cookies first (for OAuth flows)
  if (req.cookies.token) {
    token = req.cookies.token;
    tokenSource = 'cookie';
  }
  // 2. Check Authorization header (for API requests)
  else if (req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
      tokenSource = 'header';
    }
  }

  // Log authentication attempt for debugging
  // Only log authentication attempts for sensitive routes or failures
  if (req.path.includes('/admin/') || req.path.includes('/onboard/')) {
    console.log('🔐 Authentication attempt:', {
      path: req.path,
      method: req.method,
      tokenSource: tokenSource || 'none',
      hasToken: !!token,
      origin: req.get('origin'),
    });
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please sign in.',
      error: 'NO_TOKEN',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;

    // If JWT is valid but we have database issues, we can still allow access with token data
    try {
      // Set a timeout for the database query
      const user = (await Promise.race([
        User.findById(decoded.id).select('-password'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database query timeout')), 5000)
        ),
      ])) as any;

      if (!user) {
        console.log('❌ User not found in database:', decoded.id);
        return res.status(401).json({
          success: false,
          message: 'User not found. Please sign in again.',
          error: 'USER_NOT_FOUND',
        });
      }

      // Set comprehensive user info in request
      req.user = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        username: user.username,
        phone: user.phone,
      };

      // Only log successful authentication for sensitive routes
      if (req.path.includes('/admin/') || req.path.includes('/onboard/')) {
        console.log('✅ Authentication successful:', {
          userId: user._id.toString(),
          role: user.role,
          tokenSource,
          path: req.path,
        });
      }

      next();
    } catch (dbError: any) {
      console.log('⚠️ Database error during authentication, using token data:', {
        error: dbError.message,
        userId: decoded.id,
        tokenSource,
        path: req.path,
      });

      // If database is unavailable but JWT is valid, use token data as fallback
      req.user = {
        userId: decoded.id,
        email: decoded.email,
        role: decoded.role || 'user',
        username: decoded.username,
        phone: decoded.phone || '',
      };

      console.log('✅ Authentication successful using token fallback:', {
        userId: decoded.id,
        role: decoded.role || 'user',
        tokenSource,
        path: req.path,
        fallback: true,
      });

      next();
    }
  } catch (error: any) {
    console.error('❌ Token verification failed:', {
      error: error.message,
      tokenSource,
      path: req.path,
      isExpired: error.name === 'TokenExpiredError',
      isInvalid: error.name === 'JsonWebTokenError',
    });

    // Provide more specific error messages
    let message = 'Authentication failed';
    let errorCode = 'TOKEN_INVALID';

    if (error.name === 'TokenExpiredError') {
      message = 'Your session has expired. Please sign in again.';
      errorCode = 'TOKEN_EXPIRED';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Invalid authentication token. Please sign in again.';
      errorCode = 'TOKEN_MALFORMED';
    } else if (error.name === 'NotBeforeError') {
      message = 'Token not active yet.';
      errorCode = 'TOKEN_NOT_ACTIVE';
    }

    return res.status(403).json({
      success: false,
      message,
      error: errorCode,
    });
  }
};

// Optional: Middleware for routes that work with or without authentication
export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token: string | null = null;

  // Try to get token from cookies or headers
  if (req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;

      try {
        // Set a timeout for the database query
        const user = (await Promise.race([
          User.findById(decoded.id).select('-password'),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database query timeout')), 3000)
          ),
        ])) as any;

        if (user) {
          req.user = {
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
            username: user.username,
            phone: user.phone,
          };
          console.log('🔓 Optional auth successful for user:', user._id.toString());
        }
      } catch (dbError: any) {
        console.log('⚠️ Database error in optional auth, using token fallback:', dbError.message);

        // Use token data as fallback
        req.user = {
          userId: decoded.id,
          email: decoded.email || 'unknown@example.com',
          role: decoded.role || 'user',
          username: decoded.username || 'User',
          phone: decoded.phone || '',
        };
        console.log('🔓 Optional auth using token fallback for user:', decoded.id);
      }
    } catch (error) {
      console.log('⚠️ Optional auth failed, continuing without user:', error);
      // Don't throw error, just continue without user
    }
  }

  next();
};
