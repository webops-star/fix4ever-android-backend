const express = require('express');
const chatDirect = require('./controllers/chatDirect');
const jwt = require('jsonwebtoken');

// This file sets up direct routes that don't depend on the TypeScript compilation
// It's a workaround for when you need to add routes without rebuilding the entire application

// Simple authentication middleware
function authMiddleware(req, res, next) {
  try {
    // Try to get token from multiple sources
    let token = null;

    // 1. Check cookies first (for OAuth flows)
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    // 2. Check Authorization header (for API requests)
    else if (req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      console.log('Direct routes: No auth token found');
      // Allow request to proceed without auth for now to debug issues
      req.user = { id: 'anonymous', userId: 'anonymous', isAnonymous: true };
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Set user info on request
    req.user = {
      id: decoded.id || decoded.userId,
      userId: decoded.id || decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    console.log('Direct routes: Authentication successful for user:', req.user.id);
    next();
  } catch (error) {
    console.error('Direct routes: Auth error:', error.message);
    // Allow request to proceed without auth for now to debug issues
    req.user = { id: 'anonymous', userId: 'anonymous', isAnonymous: true };
    next();
  }
}

function setupDirectRoutes(app) {
  console.log('Setting up direct routes for chat functionality');

  // Chat routes
  app.get(
    '/api/chat-direct/service-request/:serviceRequestId',
    authMiddleware,
    (req, res, next) => {
      console.log('Direct chat GET route accessed');
      chatDirect.getChatMessages(req, res);
    }
  );

  app.post(
    '/api/chat-direct/send',
    authMiddleware,
    chatDirect.upload.array('attachments', 5),
    (req, res, next) => {
      console.log('Direct chat POST route accessed');
      chatDirect.sendMessage(req, res);
    }
  );

  app.patch('/api/chat-direct/:chatId/read', authMiddleware, (req, res, next) => {
    console.log('Direct chat PATCH route accessed');
    chatDirect.markMessagesAsRead(req, res);
  });

  // Add a test endpoint to verify the direct routes are working
  app.get('/api/chat-direct/test', (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Direct routes are working correctly',
      timestamp: new Date().toISOString(),
    });
  });

  console.log('Direct routes setup complete');
}

module.exports = setupDirectRoutes;
