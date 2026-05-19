// routes/paymentTransaction.routes.ts
import express from 'express';
import {
  createCustomerPayment,
  createPaymentRequest,
  getVendorPayments,
  getCustomerPayments,
  handlePaymentWebhook,
  getPaymentDetails,
  createTransaction,
  getTransactionsByVendor,
  getTransactionById,
  getPaymentHistoryByServiceRequest,
  processPaymentSuccess,
} from '../controllers/PaymentTransaction.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = express.Router();

// Test endpoint for debugging Cashfree configuration
router.get('/test-config', (req, res) => {
  const config = {
    hasAppId: !!process.env.CASHFREE_APP_ID,
    hasSecretKey: !!process.env.CASHFREE_SECRET_KEY,
    environment: process.env.CASHFREE_ENVIRONMENT || 'not set',
    appIdLength: process.env.CASHFREE_APP_ID?.length || 0,
    secretKeyLength: process.env.CASHFREE_SECRET_KEY?.length || 0,
  };

  res.json({
    success: true,
    message: 'Cashfree configuration check',
    config,
  });
});

// Customer payment endpoints
router.post(
  '/pay',
  authenticateToken,
  (req, res, next) => {
    console.log('=== Payment Route Hit ===');
    console.log('Method:', req.method);
    console.log('Path:', req.path);
    console.log('Body:', req.body);
    console.log('Headers:', req.headers);
    console.log('User:', req.user);
    next();
  },
  createCustomerPayment
);

// Vendor payment management endpoints
router.post('/request', authenticateToken, createPaymentRequest);
router.get('/vendor/payments', authenticateToken, getVendorPayments);
router.get('/customer/payments', authenticateToken, getCustomerPayments);
router.get('/details/:transactionId', authenticateToken, getPaymentDetails);

// Payment webhooks (no authentication required)
router.post('/webhook', handlePaymentWebhook);

// Payment callback handler (for return_url)
router.get('/callback', async (req, res) => {
  try {
    // Cashfree may send order_id in different formats
    const order_id = req.query.order_id || req.query.orderId || req.query.cf_order_id;
    const payment_status = req.query.order_status || req.query.payment_status;

    console.log('Payment callback received:', { order_id, payment_status, query: req.query });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (!order_id) {
      console.error('No order ID in callback URL');
      // Redirect to frontend with error instead of returning JSON
      return res.redirect(
        `${frontendUrl}/payment/callback?order_status=FAILED&error=missing_order_id`
      );
    }

    // Find the transaction
    const PaymentTransaction = require('../models/PaymentTransaction.model').default;
    const transaction = await PaymentTransaction.findOne({
      gatewayOrderId: order_id,
    });

    if (!transaction) {
      console.error('Transaction not found for order ID:', order_id);
      // Redirect to frontend with error instead of returning JSON
      return res.redirect(
        `${frontendUrl}/payment/callback?order_id=${order_id}&order_status=FAILED&error=transaction_not_found`
      );
    }

    // Check payment status with Cashfree
    try {
      const cashfreeGateway = require('../utils/cashfreeGateway').default;
      const payments = await cashfreeGateway.getOrderPayments(order_id as string);

      // Analyze payment status
      let orderStatus = 'Pending';
      if (payments && payments.length > 0) {
        const successPayments = payments.filter(
          (payment: any) => payment.payment_status === 'SUCCESS'
        );
        const pendingPayments = payments.filter(
          (payment: any) => payment.payment_status === 'PENDING'
        );

        if (successPayments.length > 0) {
          orderStatus = 'Success';
        } else if (pendingPayments.length > 0) {
          orderStatus = 'Pending';
        } else {
          orderStatus = 'Failure';
        }
      }

      // Process payment success (credits wallet, updates status, sends emails)
      // This is idempotent - safe to call multiple times
      if (orderStatus === 'Success') {
        console.log('Processing payment success for order:', order_id);
        const paymentDetails = payments && payments.length > 0 ? payments[0] : {};
        const result = await processPaymentSuccess(order_id as string, paymentDetails);

        if (result.success) {
          console.log('✅ Payment processed successfully for order:', order_id);
        } else {
          console.error('❌ Failed to process payment success:', result.error);
          // Still redirect to frontend - let user know payment was received
          // Admin can manually credit wallet if needed
        }
      }

      // Redirect to frontend callback page with status
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = `${frontendUrl}/payment/callback?order_id=${order_id}&order_status=${orderStatus === 'Success' ? 'PAID' : orderStatus === 'Failure' ? 'FAILED' : 'PENDING'}`;

      res.redirect(redirectUrl);
    } catch (cashfreeError: any) {
      console.error('Error checking payment status:', cashfreeError);

      // Redirect with error status
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = `${frontendUrl}/payment/callback?order_id=${order_id}&order_status=FAILED`;

      res.redirect(redirectUrl);
    }
  } catch (error: any) {
    console.error('Payment callback error:', error);

    // Redirect to frontend with error
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/payment/callback?order_status=FAILED`);
  }
});

// Payment callback handler (for return_url)
router.get('/mcallback', async (req, res) => {
  try {
    // Cashfree may send order_id in different formats
    const order_id = req.query.order_id || req.query.orderId || req.query.cf_order_id;

    if (!order_id) {
      console.error('No order ID in callback URL');
      // Redirect to frontend with error instead of returning JSON
      return res.status(400).json({
        order_status: 'FAILED',
        error: 'missing_order_id',
      });
    }

    // Find the transaction
    const PaymentTransaction = require('../models/PaymentTransaction.model').default;
    const transaction = await PaymentTransaction.findOne({
      gatewayOrderId: order_id,
    });

    if (!transaction) {
      console.error('Transaction not found for order ID:', order_id);
      // Redirect to frontend with error instead of returning JSON
      return res.status(400).json({
        order_id: order_id,
        order_status: 'FAILED',
        error: 'transaction_not_found',
      });
    }

    // Check payment status with Cashfree
    try {
      const cashfreeGateway = require('../utils/cashfreeGateway').default;
      const payments = await cashfreeGateway.getOrderPayments(order_id as string);

      // Analyze payment status
      let orderStatus = 'Pending';
      if (payments && payments.length > 0) {
        const successPayments = payments.filter(
          (payment: any) => payment.payment_status === 'SUCCESS'
        );
        const pendingPayments = payments.filter(
          (payment: any) => payment.payment_status === 'PENDING'
        );

        if (successPayments.length > 0) {
          orderStatus = 'Success';
        } else if (pendingPayments.length > 0) {
          orderStatus = 'Pending';
        } else {
          orderStatus = 'Failure';
        }
      }

      // Process payment success (credits wallet, updates status, sends emails)
      // This is idempotent - safe to call multiple times
      if (orderStatus === 'Success') {
        console.log('Processing payment success for order:', order_id);
        const paymentDetails = payments && payments.length > 0 ? payments[0] : {};
        const result = await processPaymentSuccess(order_id as string, paymentDetails);

        if (result.success) {
          console.log('✅ Payment processed successfully for order:', order_id);
        } else {
          console.error('❌ Failed to process payment success:', result.error);
          // Still redirect to frontend - let user know payment was received
          // Admin can manually credit wallet if needed
        }
      }

      res.status(200).json({
        order_id: order_id,
        order_status:
          orderStatus === 'Success' ? 'PAID' : orderStatus === 'Failure' ? 'FAILED' : 'PENDING',
        error: '',
      });
    } catch (cashfreeError: any) {
      console.error('Error checking payment status:', cashfreeError);

      res.status(404).json({
        error: cashfreeError.error || cashfreeError.message || 'Cashfree Error',
      });
    }
  } catch (error: any) {
    console.error('Payment callback error:', error);

    res.status(404).json({
      error: 'Something went wrong',
    });
  }
});

// Verify payment status by order ID (for callback page)
router.get('/verify/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required',
      });
    }

    // Find the transaction by gateway order ID
    const PaymentTransaction = require('../models/PaymentTransaction.model').default;
    const ServiceRequest = require('../models/serviceRequest.model').default;

    const transaction = await PaymentTransaction.findOne({
      gatewayOrderId: orderId,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // If transaction is completed but service request payment status is not updated, update it now
    if (transaction.status === 'Completed') {
      const serviceRequest = await ServiceRequest.findById(transaction.serviceRequestId);

      if (serviceRequest && serviceRequest.paymentStatus !== 'completed') {
        console.log('Verify endpoint: Updating service request payment status to completed');
        await ServiceRequest.findByIdAndUpdate(transaction.serviceRequestId, {
          paymentStatus: 'completed',
          paymentTransactionId: transaction._id.toString(),
        });

        // Return updated service request
        const updatedServiceRequest = await ServiceRequest.findById(transaction.serviceRequestId);
        return res.status(200).json({
          success: true,
          data: {
            transaction: {
              _id: transaction._id,
              amount: transaction.amount,
              status: transaction.status,
              paymentMethod: transaction.paymentMethod || 'Cashfree',
              serviceRequestId: transaction.serviceRequestId,
            },
            serviceRequest: updatedServiceRequest
              ? {
                  _id: updatedServiceRequest._id,
                  paymentStatus: updatedServiceRequest.paymentStatus,
                  status: updatedServiceRequest.status,
                }
              : null,
          },
        });
      }
    }

    // Get the associated service request
    const serviceRequest = await ServiceRequest.findById(transaction.serviceRequestId);

    res.status(200).json({
      success: true,
      data: {
        transaction: {
          _id: transaction._id,
          amount: transaction.amount,
          status: transaction.status,
          paymentMethod: transaction.paymentMethod || 'Cashfree',
          serviceRequestId: transaction.serviceRequestId,
        },
        serviceRequest: serviceRequest
          ? {
              _id: serviceRequest._id,
              paymentStatus: serviceRequest.paymentStatus,
              status: serviceRequest.status,
            }
          : null,
      },
    });
  } catch (error: any) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message,
    });
  }
});

// Get payment history by service request (must be before /:transactionId)
router.get(
  '/service-request/:serviceRequestId',
  authenticateToken,
  getPaymentHistoryByServiceRequest
);

// Legacy endpoints (for backward compatibility)
router.post('/create', createTransaction);
router.get('/vendor/:vendorId', getTransactionsByVendor);
router.get('/:transactionId', getTransactionById);

// Add the missing endpoint for getting all transactions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get all transactions for the authenticated user (both as customer and vendor)
    const PaymentTransaction = require('../models/PaymentTransaction.model').default;
    const mongoose = require('mongoose');

    // Try to convert userId to ObjectId for comparison
    let userObjectId;
    try {
      userObjectId = new mongoose.Types.ObjectId(userId);
    } catch (error) {
      console.error('Invalid userId format:', userId);
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format',
      });
    }

    const transactions = await PaymentTransaction.find({
      $or: [{ customerId: userObjectId }, { vendorId: userObjectId }],
    })
      .populate('serviceRequestId', 'brand model problemDescription')
      .populate('customerId', 'username email')
      .populate('vendorId', 'pocInfo.fullName pocInfo.email')
      .sort({ createdAt: -1 });

    console.log('Found transactions:', transactions.length);
    console.log('User ID:', userId);
    console.log('User ObjectId:', userObjectId);

    res.status(200).json({
      success: true,
      data: transactions,
      message: 'Transaction history retrieved successfully',
    });
  } catch (error: any) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// Check payment status for a specific service request
router.get('/check/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Find the payment transaction for this service request
    const PaymentTransaction = require('../models/PaymentTransaction.model').default;
    const mongoose = require('mongoose');

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const transaction = await PaymentTransaction.findOne({
      serviceRequestId: new mongoose.Types.ObjectId(requestId),
      customerId: userObjectId,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Payment transaction not found',
      });
    }

    // If we have a gateway order ID, check the status with Cashfree
    if (transaction.gatewayOrderId) {
      try {
        const cashfreeGateway = require('../utils/cashfreeGateway').default;
        const payments = await cashfreeGateway.getOrderPayments(transaction.gatewayOrderId);

        // Analyze payment status based on Cashfree response
        let orderStatus = 'Pending';
        if (payments && payments.length > 0) {
          const successPayments = payments.filter(
            (payment: any) => payment.payment_status === 'SUCCESS'
          );
          const pendingPayments = payments.filter(
            (payment: any) => payment.payment_status === 'PENDING'
          );

          if (successPayments.length > 0) {
            orderStatus = 'Success';
          } else if (pendingPayments.length > 0) {
            orderStatus = 'Pending';
          } else {
            orderStatus = 'Failure';
          }
        }

        // Process payment success if payment is successful (credits wallet, updates status)
        // This is idempotent - safe to call multiple times
        if (orderStatus === 'Success') {
          console.log('Processing payment success for order:', transaction.gatewayOrderId);
          const paymentDetails = payments && payments.length > 0 ? payments[0] : {};
          const result = await processPaymentSuccess(transaction.gatewayOrderId, paymentDetails);

          if (result.success) {
            console.log('✅ Payment processed successfully');
          } else {
            console.error('❌ Failed to process payment success:', result.error);
          }
        }

        return res.status(200).json({
          success: true,
          isPaid: orderStatus === 'Success',
          status: orderStatus,
          transactionStatus: transaction.status,
          payments: payments,
          message: 'Payment status checked successfully',
        });
      } catch (cashfreeError: any) {
        console.error('Error checking payment status with Cashfree:', cashfreeError);
        // Fall back to local status
      }
    }

    // Return local transaction status
    res.status(200).json({
      success: true,
      isPaid: transaction.status === 'Completed',
      status: transaction.status,
      transactionId: transaction._id,
      message: 'Payment status retrieved from local database',
    });
  } catch (error: any) {
    console.error('Error checking payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

export default router;
