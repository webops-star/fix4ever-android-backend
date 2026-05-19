import express from 'express';
import http from 'http';
import { connect } from './config/dbConfig';
import { createSocketServer } from './sockets/sockets';
import { migrateRequestIds } from './utils/migrateRequestIds';
import { ensureDraftTtlIndex } from './utils/ensureDraftTtlIndex';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { auth } from 'express-openid-connect';
import { expireOldServiceRequests } from './controllers/serviceRequest.controller';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import mongoose, { deleteModel } from 'mongoose';
import testSubmissionModel from './models/testSubmission.model';

// Removed Cloudinary imports to fix upload errors

// Load environment variables first
dotenv.config();

// Import routes
import authRoutes from './routes/auth.routes';
import paymentTransactionRoutes from './routes/PaymentTransaction.routes';
import reviewRoutes from './routes/review.routes';
import serviceListingRoutes from './routes/serviceListing.routes';
import serviceRequestRoutes from './routes/serviceRequest.routes';
import vendorRoutes from './routes/vendor.routes';
import captainRoutes from './routes/captain.routes';
import captainWalletRoutes from './routes/captainWallet.routes';
import pickupRequestRoutes from './routes/pickupRequest.routes';
import adminRoutes from './routes/admin.routes';
import notificationRoutes from './routes/notification.routes';
import scheduleRoutes from './routes/schedule.routes';
import draftServiceRequestRoutes from './routes/draftServiceRequest.routes';
import technicianRoutes from './routes/technician.routes';
import walletRoutes from './routes/wallet.routes';
import { uploadChatImage } from './utils/s3Upload';
import uploadTest from './routes/uploadTest';
import deleteTest from './routes/deleteTest';
import brandRoutes from './routes/brand.routes';
import problemRoutes from './routes/problems.routes';
import referralRoutes from './routes/referral.routes';
import couponRoutes from './routes/coupon.routes';
import WorkspaceRoutes from './routes/workspace.rotues';
import workshopTechnicianRoutes from './routes/workshopTechnician.routes';
import contactRoutes from './routes/contact.routes';

import dns from 'node:dns/promises';

dns.setServers(['1.1.1.1', '8.8.8.8']);
// Connect to database
(async () => {
  await connect();
})();

// CORS configuration with proper security settings
const corsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) {
    // Allow requests from configured origins
    const allowedOrigins = [
      // Primary frontend URL from environment
      process.env.CORS_ORIGIN || 'https://fix4ever.com' || 'https://dev.fix4ever.com',
      process.env.FRONTEND_URL || 'http://localhost:3000',

      // Production and dev domains
      'https://fix4ever.com',
      'https://www.fix4ever.com',
      'https://dev.fix4ever.com',
      'https://main.d3901fw5qiteft.amplifyapp.com',
      'https://dev.fix4ever.com',
      'https://www.dev.fix4ever.com',

      // Cashfree payment gateway domains (CRITICAL for payment callbacks)
      'https://sandbox.cashfree.com',
      'https://api.cashfree.com',
      'https://www.cashfree.com',
      'https://payments.cashfree.com',

      // Local development
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://localhost:5173',
      'http://localhost:8080',
    ];

    // Allow requests with no origin (mobile apps, Postman, webhooks, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      // In production, log but don't block Cashfree domains
      if (origin.includes('cashfree.com')) {
        console.log('Allowing Cashfree domain:', origin);
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true, // Essential for cookie-based authentication
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'x-session-id',
    'X-Verify', // Cashfree webhook signature header
  ],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
};

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
console.log('Creating Socket.IO server...');
const io = createSocketServer(server);
app.set('socketio', io); // make accessible via req.app.get('socketio') in controllers

// Middleware setup - ORDER MATTERS!
// 1. Cookie parser (before CORS to handle cookies properly)
app.use(cookieParser());

// 2. CORS (before other middleware)
app.use(cors(corsOptions));

// 3. Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Serve static files for uploads (fallback for local storage)
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// 4. Trust proxy (for production environments)
app.set('trust proxy', 1);

// 5. Request logging for debugging (disabled to reduce log spam)
// Uncomment below for debugging specific routes
/*
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    // Only log important routes, not every request
    if (req.path.includes('/onboard/') || req.path.includes('/auth/')) {
      console.log(`${req.method} ${req.path}`, {
        origin: req.get('origin') || 'none',
        auth: req.get('authorization') ? 'Bearer token present' : 'no auth header',
      });
    }
    next();
  });
}
*/

// Health check endpoint with database status
app.get('/health', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStateMap: { [key: number]: string } = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  // Test database connection with timeout
  let dbHealthy = false;
  let dbLatency = null;

  if (dbState === 1) {
    try {
      const startTime = Date.now();
      await Promise.race([
        mongoose.connection.db.admin().ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database ping timeout')), 3000)
        ),
      ]);
      dbLatency = Date.now() - startTime;
      dbHealthy = true;
    } catch (error) {
      console.error('Database health check failed:', error);
      dbHealthy = false;
    }
  }

  const healthStatus = {
    status: dbHealthy ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 8080,
    database: {
      status: dbStateMap[dbState],
      healthy: dbHealthy,
      latency: dbLatency ? `${dbLatency}ms` : 'N/A',
    },
  };

  res.status(dbHealthy ? 200 : 503).json(healthStatus);
});

// 6. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/payment-transactions', paymentTransactionRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/service-listings', serviceListingRoutes);
app.use('/api/service-requests', serviceRequestRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/vendor', vendorRoutes);
app.use('/api/captains', captainRoutes);
app.use('/api/captain', captainRoutes);
app.use('/api/captain-wallet', captainWalletRoutes);
app.use('/api/pickup-requests', pickupRequestRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/draft-service-requests', draftServiceRequestRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/technicians', technicianRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api', deleteTest);
app.use('/api', uploadTest);
app.use('/api', brandRoutes);

//workspace
app.use('/api/workSpace', WorkspaceRoutes);
app.use('/api/workshop-technicians', workshopTechnicianRoutes);
// v2 Problem catalog API (JSON-driven, no auth required)
app.use('/api/problems', problemRoutes);

// Referral & Coupon system
app.use('/api/referral', referralRoutes);
app.use('/api/coupon', couponRoutes);

// Temporarily comment out problematic route

// INLINE CHAT ROUTES IMPLEMENTATION
// ==============================
console.log('Setting up inline chat routes...');

// Test endpoint to verify routes are working
app.get('/api/chat-simple/test', (req: any, res: any) => {
  console.log('Simple chat test endpoint accessed');
  res.status(200).json({
    success: true,
    message: 'Simple chat routes are working correctly!',
    timestamp: new Date().toISOString(),
  });
});

// Helper to resolve service request by request_id or _id (matches serviceRequest.controller pattern)
async function resolveServiceRequest(serviceRequestId: string) {
  const ServiceRequest = mongoose.model('ServiceRequest');
  let serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId });
  if (!serviceRequest && mongoose.Types.ObjectId.isValid(serviceRequestId)) {
    serviceRequest = await ServiceRequest.findById(serviceRequestId);
  }
  return serviceRequest;
}

// Get chat messages endpoint - uses serviceRequest._id for chat lookup (consistent with send-v2)
app.get('/api/chat-simple/service-request/:serviceRequestId', async (req: any, res: any) => {
  try {
    const { serviceRequestId } = req.params;

    if (!serviceRequestId) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required',
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, data: [] });
    }

    const serviceRequest = await resolveServiceRequest(serviceRequestId);
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    const db = mongoose.connection.db;
    const chatCollection = db.collection('simplechats');
    const srObjectId = serviceRequest._id;

    let chat = await chatCollection.findOne({ serviceRequestId: srObjectId });
    if (!chat) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const messages = chat.messages || [];
    return res.json({
      success: true,
      data: messages,
    });
  } catch (error: any) {
    console.error('Error getting messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: error.message,
    });
  }
});

// Simple local storage configuration - NO CLOUDINARY
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads/chat');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 5, // Maximum 5 files
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp4|mp3/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

// Send message endpoint with error handling - REDIRECTS TO NEW ENDPOINT
app.post('/api/chat-simple/send', (req: any, res: any) => {
  console.log('Redirecting to new chat endpoint');
  req.url = '/api/chat-simple/send-v2';
  app._router.handle(req, res);
  return;

  // Old implementation kept for reference
  upload.array('attachments', 5)(req, res, async (err: any) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error',
      });
    }

    try {
      console.log('=== CHAT POST REQUEST ===');
      console.log('Request Body:', req.body);
      console.log('Request Files:', req.files);
      console.log('Request URL:', req.url);
      console.log('Request Method:', req.method);
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Body Keys:', Object.keys(req.body || {}));
      console.log('Files Count:', req.files ? req.files.length : 0);
      console.log('Raw Body Type:', typeof req.body);
      console.log('Raw Body String:', JSON.stringify(req.body));
      console.log('========================');

      const { serviceRequestId, content, senderType, senderId } = req.body;

      if (!serviceRequestId) {
        console.log('Missing serviceRequestId:', {
          serviceRequestId,
          content,
          senderType,
          senderId,
        });
        return res.status(400).json({
          success: false,
          message: 'Service request ID is required',
        });
      }

      // Allow empty content if there are attachments
      const hasAttachments = req.files && req.files.length > 0;
      if (!content && !hasAttachments) {
        console.log('Missing content and no attachments:', {
          serviceRequestId,
          content,
          senderType,
          senderId,
        });
        return res.status(400).json({
          success: false,
          message: 'Message content or attachments are required',
        });
      }

      // Check if mongoose is connected
      if (mongoose.connection.readyState !== 1) {
        console.log('Database not connected, but simulating successful message send');
        return res.json({
          success: true,
          message: 'Message sent successfully (offline mode)',
          data: {
            senderId: senderId,
            senderType: senderType || 'customer',
            content: content,
            timestamp: new Date(),
            status: 'sent',
          },
        });
      }

      // Get ServiceRequest model
      const ServiceRequest = mongoose.model('ServiceRequest');

      // Validate service request
      const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId });

      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found',
        });
      }

      // Create simple chat schema if not exists
      let Chat;
      try {
        Chat = mongoose.model('SimpleChat');
      } catch (e) {
        const ChatSchema = new mongoose.Schema(
          {
            serviceRequestId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'ServiceRequest',
              required: true,
            },
            vendorId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'Vendor',
              required: true,
            },
            customerId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
              required: true,
            },
            messages: [
              {
                senderId: String,
                senderType: {
                  type: String,
                  enum: ['customer', 'vendor'],
                  required: true,
                },
                content: {
                  type: String,
                  required: true,
                },
                timestamp: {
                  type: Date,
                  default: Date.now,
                },
                status: {
                  type: String,
                  enum: ['sent', 'delivered', 'read'],
                  default: 'sent',
                },
                attachments: {
                  type: [
                    {
                      url: String,
                      type: String,
                      name: String,
                    },
                  ],
                  default: [],
                },
              },
            ],
          },
          {
            timestamps: true,
          }
        );

        Chat = mongoose.model('SimpleChat', ChatSchema);
      }

      // Process attachments if any - LOCAL STORAGE ONLY
      const attachments: any = [];

      if (req.files && Array.isArray(req.files)) {
        req.files.forEach((file: any) => {
          const fileType = file.mimetype.startsWith('image/') ? 'image' : 'file';

          attachments.push({
            url: `/uploads/chat/${file.filename}`,
            type: fileType,
            name: file.originalname,
          });
        });
      }

      // Create message
      const newMessage = {
        senderId: senderId || 'anonymous',
        senderType: senderType || 'customer',
        content: content || (attachments.length > 0 ? '📎 File attachment' : ''),
        timestamp: new Date(),
        status: 'sent',
        attachments: attachments, // Always pass the array, even if empty
      };

      // Find or create chat
      let chat = await (Chat as any).findOne({ serviceRequestId });

      if (!chat) {
        chat = await (Chat as any).create({
          serviceRequestId,
          vendorId: serviceRequest.vendorId || serviceRequest.assignedVendor?._id,
          customerId: serviceRequest.customerId,
          messages: [newMessage],
        });
      } else {
        chat.messages.push(newMessage);
        await chat.save();
      }

      console.log('Message sent successfully');
      return res.json({
        success: true,
        message: 'Message sent successfully',
        data: newMessage,
      });
    } catch (error: any) {
      console.error('Error sending message:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send message',
        error: error.message,
      });
    }
  });
});

app.get('/api/gets3url', async (req, res) => {
  try {
    const { requestId } = req.query;

    const data = await testSubmissionModel.findOne({ 'video.serviceRequestId': requestId });

    if (!data)
      return res.json({
        success: false,
        message: 'service request Not found',
      });

    res.json({ success: true, data: data.video.s3Url });
  } catch (err: any) {
    res.status(404).json({
      success: false,
      message: 'this is the error',
    });
  }
});
// NEW SIMPLIFIED CHAT ENDPOINT - COMPLETELY REWRITTEN
app.post('/api/chat-simple/send-v2', (req: any, res: any) => {
  // Use the simple upload middleware
  upload.array('attachments', 5)(req, res, async (err: any) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error',
      });
    }

    try {
      console.log('=== NEW CHAT POST REQUEST ===');
      console.log('Request Body:', req.body);
      console.log('Request Files:', req.files ? req.files.length : 0);
      console.log('========================');

      const { serviceRequestId, content, senderType, senderId } = req.body;

      if (!serviceRequestId) {
        return res.status(400).json({
          success: false,
          message: 'Service request ID is required',
        });
      }

      // Allow empty content if there are attachments
      const hasAttachments = req.files && req.files.length > 0;
      if (!content && !hasAttachments) {
        return res.status(400).json({
          success: false,
          message: 'Message content or attachments are required',
        });
      }

      // Check if mongoose is connected
      if (mongoose.connection.readyState !== 1) {
        console.log('Database not connected, returning success anyway');
        return res.json({
          success: true,
          message: 'Message sent successfully (offline mode)',
          data: {
            senderId: senderId,
            senderType: senderType || 'customer',
            content: content,
            timestamp: new Date(),
            status: 'sent',
          },
        });
      }

      // Process files - upload to S3
      const fileAttachments = [];
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          try {
            const uploadResult = await uploadChatImage(file.path, serviceRequestId);
            if (uploadResult) {
              fileAttachments.push({
                url: uploadResult.url,
                type: file.mimetype.startsWith('image/') ? 'image' : 'file',
                name: file.originalname,
              });
            }
          } catch (error) {
            console.error('Error uploading chat file to S3:', error);
          }
        }
      }

      // Create message directly in MongoDB without using Mongoose schemas
      // This bypasses all the validation issues
      const db = mongoose.connection.db;

      // Resolve service request by request_id or _id (consistent with GET)
      const serviceRequest = await resolveServiceRequest(serviceRequestId);
      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found',
        });
      }

      // Prepare message with unique ID
      const messageId = new mongoose.Types.ObjectId().toString();
      const newMessage = {
        _id: messageId,
        senderId: senderId || 'anonymous',
        senderType: senderType || 'customer',
        content: content || (fileAttachments.length > 0 ? '📎 File attachment' : ''),
        timestamp: new Date(),
        status: 'sent',
        attachments: fileAttachments,
      };

      // Get chat collection
      const chatCollection = db.collection('simplechats');

      // Find or create chat (use serviceRequest._id as internal ObjectId reference)
      const chat = await chatCollection.findOne({
        serviceRequestId: serviceRequest._id,
      });

      if (!chat) {
        // Create new chat
        await chatCollection.insertOne({
          serviceRequestId: serviceRequest._id,
          vendorId: serviceRequest.vendorId || serviceRequest.assignedVendor,
          customerId: serviceRequest.customerId,
          messages: [newMessage],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        // Update existing chat
        await chatCollection.updateOne(
          { _id: chat._id },
          {
            $push: { messages: newMessage },
            $set: { updatedAt: new Date() },
          }
        );
      }

      console.log('Message sent successfully');

      // Emit real-time socket event to all clients in the service request room
      const io = (global as any).io;
      if (io) {
        const roomName = `service-${serviceRequestId}`;
        io.to(roomName).emit('new-message', {
          serviceRequestId,
          message: newMessage,
        });
        console.log(`Emitted new-message to room: ${roomName}`);
      }

      return res.json({
        success: true,
        message: 'Message sent successfully',
        data: newMessage,
      });
    } catch (error: any) {
      console.error('Error sending message:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send message',
        error: error.message,
      });
    }
  });
});

// 7. Catch-all route for undefined endpoints
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /health',
      'POST /api/auth/login',
      'POST /api/auth/signup',
      'GET /api/auth/google/login',
      'GET /api/service-listings',
      'GET /api/vendors',
    ],
  });
});

// 8. Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Global error handler:', err);

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      error: err.message,
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
      error: err.message,
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Use port 8080 for all services
const PORT = 8080;
const HOST = '0.0.0.0';

// Log environment variables for debugging
console.log('🔧 Environment Configuration:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`   PORT (env): ${process.env.PORT || 'not set'}`);
console.log(`   PORT (forced): ${PORT}`);
console.log(`   CORS_ORIGIN: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
console.log(`   MONGODB_URI: ${process.env.MONGODB_URL ? 'configured' : 'not configured'}`);
console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? 'configured' : 'not configured'}`);
console.log(
  `   AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? 'configured' : 'not configured'}`
);
console.log(
  `   AWS_SES_SENDER_EMAIL: ${process.env.AWS_SES_SENDER_EMAIL ? 'configured' : 'not configured'}`
);
console.log(
  `   GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? 'configured' : 'not configured'}`
);

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  // Run startup migrations once DB is ready (connection may still be opening at this point)
  const runMigrations = async () => {
    try {
      await migrateRequestIds();
      await ensureDraftTtlIndex();
    } catch (err) {
      console.error('[Migration] Failed:', err);
    }
  };
  if (mongoose.connection.readyState === 1) {
    runMigrations();
  } else {
    mongoose.connection.once('connected', runMigrations);
  }
  console.log(`🔗 API URL: http://${HOST}:${PORT}/api`);
  console.log(`🔗 OAuth URLs:`);
  console.log(`   Google login: http://${HOST}:${PORT}/api/auth/google/login`);
  const backendUrl = process.env.BACKEND_URL || `http://${HOST}:${PORT}`;
  console.log(
    `   Google redirect URI (add this in Google Cloud Console): ${backendUrl}/api/auth/google/callback`
  );
  console.log(`🔌 Socket.IO is also listening on port ${PORT}`);
  console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
});

// Set up cron job to expire old service requests every minute
setInterval(async () => {
  try {
    const expiredCount = await expireOldServiceRequests();
    if (expiredCount > 0) {
      console.log(`⏰ Expired ${expiredCount} service requests`);
    }
  } catch (error) {
    console.error('Error in service request expiration cron job:', error);
  }
}, 60000); // Run every minute

console.log('⏰ Service request expiration cron job started (runs every minute)');

// Handle uncaught exceptions
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
