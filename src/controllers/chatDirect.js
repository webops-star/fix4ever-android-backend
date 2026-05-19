const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Configure storage for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/chat');

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Define Chat Schema and model directly here for simplicity
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
        senderId: {
          type: String,
          required: true,
        },
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
        attachments: [
          {
            url: String,
            type: String,
            name: String,
          },
        ],
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Create Chat model
let Chat;
try {
  Chat = mongoose.model('Chat');
} catch (error) {
  Chat = mongoose.model('Chat', ChatSchema);
}

// Create ServiceRequest model reference
let ServiceRequest;
try {
  ServiceRequest = mongoose.model('ServiceRequest');
} catch (error) {
  // If this fails, we'll handle it in the route handlers
  console.error('ServiceRequest model not found, will be handled in route handlers');
}

// Get chat messages for a service request
const getChatMessages = async (req, res) => {
  try {
    console.log('Direct chat messages request received:', {
      params: req.params,
      user: req.user,
    });

    const { serviceRequestId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    if (!serviceRequestId) {
      return res.status(400).json({ success: false, message: 'Service request ID is required' });
    }

    // Validate service request exists and user has access to it
    const serviceRequest = await ServiceRequest.findById(serviceRequestId);

    if (!serviceRequest) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    // Check if the user is either the customer or the assigned vendor
    const isCustomer = serviceRequest.customerId.toString() === userId;
    const isVendor =
      serviceRequest.vendorId?.toString() === userId ||
      serviceRequest.assignedVendor?.toString() === userId;

    if (!isCustomer && !isVendor) {
      return res
        .status(403)
        .json({ success: false, message: 'You do not have access to this conversation' });
    }

    // Find the chat or create a new one if it doesn't exist
    let chat = await Chat.findOne({ serviceRequestId });

    if (!chat) {
      chat = await Chat.create({
        serviceRequestId,
        vendorId: serviceRequest.vendorId || serviceRequest.assignedVendor,
        customerId: serviceRequest.customerId,
        messages: [],
      });
    }

    // Update message status to read for the current user
    const otherUserType = isCustomer ? 'vendor' : 'customer';

    await Chat.findByIdAndUpdate(
      chat._id,
      {
        $set: {
          'messages.$[elem].status': 'read',
        },
      },
      {
        arrayFilters: [{ 'elem.senderType': otherUserType, 'elem.status': { $ne: 'read' } }],
        new: true,
      }
    );

    return res.status(200).json({
      success: true,
      data: chat.messages,
    });
  } catch (error) {
    console.error('Error getting chat messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get chat messages',
      error: error.message,
    });
  }
};

// Send a new message
const sendMessage = async (req, res) => {
  try {
    console.log('Direct send message request received:', {
      body: req.body,
      user: req.user,
      files: req.files,
    });

    const { serviceRequestId, content, recipientId } = req.body;
    const senderId = req.user?.userId || req.user?.id;
    const senderType = req.body.senderType; // 'customer' or 'vendor'

    if (!serviceRequestId || !content) {
      return res
        .status(400)
        .json({ success: false, message: 'Service request ID and content are required' });
    }

    // Validate service request exists and user has access to it
    const serviceRequest = await ServiceRequest.findById(serviceRequestId);

    if (!serviceRequest) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    // Check user's role for the service request
    const isCustomer = serviceRequest.customerId.toString() === senderId;
    const isVendor =
      serviceRequest.vendorId?.toString() === senderId ||
      serviceRequest.assignedVendor?.toString() === senderId;

    if (!isCustomer && !isVendor) {
      return res
        .status(403)
        .json({ success: false, message: 'You do not have access to this conversation' });
    }

    // Validate sender type matches user role
    if ((isCustomer && senderType !== 'customer') || (isVendor && senderType !== 'vendor')) {
      return res.status(400).json({ success: false, message: 'Invalid sender type for this user' });
    }

    // Process attachments if any
    const attachments = [];

    if (req.files && Array.isArray(req.files)) {
      req.files.forEach(file => {
        const fileType = file.mimetype.startsWith('image/') ? 'image' : 'file';
        const urlPath = `/uploads/chat/${file.filename}`;

        attachments.push({
          url: urlPath,
          type: fileType,
          name: file.originalname,
        });
      });
    }

    // Create a new message
    const newMessage = {
      senderId: senderId || '',
      senderType: senderType,
      content,
      timestamp: new Date(),
      status: 'sent',
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    // Find the chat or create if it doesn't exist
    let chat = await Chat.findOne({ serviceRequestId });

    if (!chat) {
      chat = await Chat.create({
        serviceRequestId,
        vendorId: serviceRequest.vendorId || serviceRequest.assignedVendor,
        customerId: serviceRequest.customerId,
        messages: [newMessage],
      });
    } else {
      // Add message to existing chat
      chat.messages.push(newMessage);
      await chat.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      data: newMessage,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
};

// Mark messages as read
const markMessagesAsRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    // Check if the user is part of this chat
    const isCustomer = chat.customerId.toString() === userId;
    const isVendor = chat.vendorId.toString() === userId;

    if (!isCustomer && !isVendor) {
      return res
        .status(403)
        .json({ success: false, message: 'You do not have access to this chat' });
    }

    // Mark messages from the other party as read
    const otherUserType = isCustomer ? 'vendor' : 'customer';

    await Chat.findByIdAndUpdate(
      chatId,
      {
        $set: {
          'messages.$[elem].status': 'read',
        },
      },
      {
        arrayFilters: [{ 'elem.senderType': otherUserType, 'elem.status': { $ne: 'read' } }],
        new: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Messages marked as read',
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: error.message,
    });
  }
};

module.exports = {
  getChatMessages,
  sendMessage,
  markMessagesAsRead,
  upload,
};
