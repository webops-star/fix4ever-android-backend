// controllers/paymentTransaction.controller.ts
import { Request, Response } from 'express';
import PaymentTransaction from '../models/PaymentTransaction.model';
import Vendor from '../models/vendor.model';
import ServiceRequest from '../models/serviceRequest.model';
import User from '../models/user.model';
import mailSender from '../utils/mailSender';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  paymentGateway,
  generateReceiptId,
  isValidAmount,
  formatAmount,
  PaymentProvider,
} from '../utils/paymentGateway';
import cashfreeGateway from '../utils/cashfreeGateway';
import mongoose from 'mongoose';
import { creditTechnicianWallet } from '../utils/walletService';
import { validateCoupon, applyCoupon } from '../utils/couponService';

// Helper function to calculate base amount (without GST)
const calculateBaseAmount = (serviceRequest: any): number => {
  // PRIORITY 1: If paymentBreakdown exists (admin has set final price), use totalCost
  if (serviceRequest.paymentBreakdown && serviceRequest.paymentBreakdown.totalCost > 0) {
    return serviceRequest.paymentBreakdown.totalCost;
  }

  // PRIORITY 2: If admin has set a final price, use that directly
  if (serviceRequest.adminFinalPrice && serviceRequest.adminFinalPrice > 0) {
    return serviceRequest.adminFinalPrice;
  }

  // PRIORITY 3: Calculate from pricing estimates if no admin price set yet
  let baseAmount = 0;
  if (serviceRequest.calculatedPricing) {
    if (serviceRequest.calculatedPricing.finalChargeRange) {
      // Use the average of min and max from final charge range
      baseAmount =
        (serviceRequest.calculatedPricing.finalChargeRange.min +
          serviceRequest.calculatedPricing.finalChargeRange.max) /
        2;
    } else if (serviceRequest.calculatedPricing.netChargeRange) {
      // Use the average of min and max from net charge range
      baseAmount =
        (serviceRequest.calculatedPricing.netChargeRange.min +
          serviceRequest.calculatedPricing.netChargeRange.max) /
        2;

      // Add addon fees
      baseAmount += serviceRequest.calculatedPricing.serviceTypeFee || 0;
      baseAmount += serviceRequest.calculatedPricing.warrantyFee || 0;
      baseAmount += serviceRequest.calculatedPricing.urgencyFee || 0;
      baseAmount += serviceRequest.calculatedPricing.dataSafetyFee || 0;
    }
  }

  // PRIORITY 4: Fall back to vendor service charge or estimated cost
  if (baseAmount === 0) {
    baseAmount = serviceRequest.vendorServiceCharge || serviceRequest.estimatedCost || 0;
  }

  return Math.max(baseAmount, 0);
};

// Helper function to calculate total payment amount (with GST if admin has set price)
const calculateTotalPaymentAmount = (
  serviceRequest: any
): { baseAmount: number; gstAmount: number; totalAmount: number } => {
  const baseAmount = calculateBaseAmount(serviceRequest);

  // If admin has set final price (paymentBreakdown or adminFinalPrice exists), add 18% GST
  const hasAdminPrice =
    (serviceRequest.paymentBreakdown && serviceRequest.paymentBreakdown.totalCost > 0) ||
    (serviceRequest.adminFinalPrice && serviceRequest.adminFinalPrice > 0);

  if (hasAdminPrice) {
    // Add 18% GST to admin's final price
    const gstAmount = Math.round(baseAmount * 0.18 * 100) / 100; // Round to 2 decimal places
    const totalAmount = Math.round((baseAmount + gstAmount) * 100) / 100;

    return {
      baseAmount: Math.round(baseAmount * 100) / 100,
      gstAmount,
      totalAmount,
    };
  }

  // If no admin price set, return base amount without GST
  return {
    baseAmount: Math.round(baseAmount * 100) / 100,
    gstAmount: 0,
    totalAmount: Math.max(baseAmount, 1),
  };
};

// Customer initiates payment for a service request
export const createCustomerPayment = async (req: AuthRequest, res: Response) => {
  try {
    const customerUserId = req.user?.userId;
    const {
      serviceRequestId,
      vendorId,
      amount,
      description,
      customerNotes,
      walletAmount: rawWalletAmount,
      couponCode: rawCouponCode,
    } = req.body;
    const paymentProvider = 'cashfree'; // Always use Cashfree as payment gateway

    // Debug logging
    console.log('=== Payment Request Received ===');
    console.log('Request Body:', req.body);
    console.log('Customer User ID:', customerUserId);
    console.log('Service Request ID:', serviceRequestId);
    console.log('Vendor ID:', vendorId);
    console.log('Amount:', amount, 'Type:', typeof amount);

    if (!customerUserId) {
      console.error('Authentication failed: No customer user ID');
      return res.status(401).json({
        success: false,
        message: 'Customer authentication required',
      });
    }

    // Validate required fields
    if (!serviceRequestId || !vendorId || !amount) {
      console.error('Validation failed: Missing required fields', {
        hasServiceRequestId: !!serviceRequestId,
        hasVendorId: !!vendorId,
        hasAmount: !!amount,
      });
      return res.status(400).json({
        success: false,
        message: 'Service request ID, vendor ID, and amount are required',
      });
    }

    // Validate amount
    if (!isValidAmount(amount)) {
      console.error('Amount validation failed:', {
        amount,
        type: typeof amount,
        isValidAmount: isValidAmount(amount),
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid payment amount. Amount must be between ₹1 and ₹10,00,000',
      });
    }

    // Get service request details (dual-lookup: request_id string or ObjectId)
    let serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId }).populate(
      'customerId'
    );
    if (!serviceRequest && mongoose.Types.ObjectId.isValid(serviceRequestId)) {
      serviceRequest = await ServiceRequest.findById(serviceRequestId).populate('customerId');
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Calculate the correct total amount (admin price + GST if applicable)
    const amountBreakdown = calculateTotalPaymentAmount(serviceRequest);
    console.log('=== Payment Amount Calculation ===');
    console.log('Amount from request:', amount);
    console.log('Amount breakdown:', {
      baseAmount: amountBreakdown.baseAmount,
      gstAmount: amountBreakdown.gstAmount,
      totalAmount: amountBreakdown.totalAmount,
    });

    // Apply coupon: validate + record usage at payment-initiation time (not at UI "Apply" click)
    let couponDiscount = 0;
    let couponCode: string | null = null;
    if (rawCouponCode) {
      try {
        const validation = await validateCoupon(
          rawCouponCode,
          customerUserId,
          amountBreakdown.totalAmount
        );
        if (validation.valid && validation.coupon && validation.discountAmount != null) {
          const applyResult = await applyCoupon(
            validation.coupon._id.toString(),
            customerUserId,
            (serviceRequest as any)._id.toString(),
            validation.discountAmount
          );
          if (applyResult.success) {
            couponDiscount = validation.discountAmount;
            couponCode = rawCouponCode.toUpperCase();
            // Persist on ServiceRequest so processPaymentSuccess can mark it REDEEMED
            await ServiceRequest.findByIdAndUpdate(serviceRequest._id, {
              couponCode,
              couponDiscount,
              couponUsageId: applyResult.usageId,
            });
          }
        }
      } catch (couponErr) {
        console.error('Coupon apply error (non-fatal, continuing without coupon):', couponErr);
      }
    } else {
      // Fall back: coupon may have been applied via old flow (backward compat)
      couponDiscount = serviceRequest.couponDiscount ?? 0;
      couponCode = serviceRequest.couponCode ?? null;
    }

    // Apply wallet discount if customer passed walletAmount
    const SystemConfig = require('../models/systemConfig.model').default;
    const DEFAULT_REFERRAL_CONFIG = require('../models/systemConfig.model').DEFAULT_REFERRAL_CONFIG;
    const walletCap: number = await SystemConfig.getValue(
      'wallet_usage_cap_per_order',
      DEFAULT_REFERRAL_CONFIG.wallet_usage_cap_per_order
    );
    let walletAmountUsed = 0;
    if (rawWalletAmount && rawWalletAmount > 0) {
      // Fetch customer wallet balance
      const CustomerWallet = require('../models/customerWallet.model').default;
      const wallet = await CustomerWallet.findOne({ userId: customerUserId });
      const walletBalance: number = wallet?.balance ?? 0;
      // Cap: cannot exceed wallet balance, configured cap, or remaining amount after coupon
      const maxWallet = Math.min(
        walletBalance,
        walletCap,
        Math.max(0, amountBreakdown.totalAmount - couponDiscount - 1)
      );
      walletAmountUsed = Math.min(Math.max(0, Number(rawWalletAmount)), maxWallet);
      if (walletAmountUsed > 0) {
        // Persist on ServiceRequest so processPaymentSuccess can read it
        await ServiceRequest.findByIdAndUpdate(serviceRequest._id, { walletAmountUsed });
      }
    }

    const finalAmount = Math.max(
      1,
      Math.round((amountBreakdown.totalAmount - couponDiscount - walletAmountUsed) * 100) / 100
    );
    console.log(
      'Final amount to be charged (after coupon + wallet):',
      finalAmount,
      'coupon:',
      couponCode,
      couponDiscount,
      'wallet:',
      walletAmountUsed
    );

    // Debug logging
    console.log('Customer User ID:', customerUserId);
    console.log(
      'Service Request Customer ID:',
      (serviceRequest.customerId as any)?._id || serviceRequest.customerId
    );

    // Verify customer owns this service request
    console.log('=== Authorization Check ===');
    console.log('Service Request Customer ID (string):', serviceRequest.customerId._id.toString());
    console.log('Customer User ID:', customerUserId);
    console.log('IDs Match:', serviceRequest.customerId._id.toString() === customerUserId);

    if (serviceRequest.customerId._id.toString() !== customerUserId) {
      console.error('Authorization failed: Customer does not own this service request');
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to make payment for this service request',
      });
    }

    console.log('✅ Authorization passed, fetching vendor...');

    // Get vendor details (optional — not required to create the Cashfree payment session)
    console.log('=== Vendor Fetch ===');
    console.log('Vendor ID:', vendorId);
    const vendor = await Vendor.findById(vendorId).catch(() => null);
    if (vendor) {
      console.log('✅ Vendor found:', vendor._id);
    } else {
      console.warn('⚠️  Vendor not found for ID:', vendorId, '— proceeding without vendor record');
    }

    // Check if payment already exists for this service request (use ObjectId)
    console.log('=== Checking Existing Payment ===');
    const existingPayment = await PaymentTransaction.findOne({
      serviceRequestId: serviceRequest._id,
      status: { $in: ['Pending', 'Requested', 'Processing', 'Completed'] },
    });
    console.log('Existing payment found:', !!existingPayment);

    if (existingPayment) {
      console.log(
        'Existing payment found. Transaction ID:',
        existingPayment._id,
        'Status:',
        existingPayment.status
      );

      // If a payment link already exists, check if it's valid and not expired
      if (existingPayment.paymentLink) {
        const now = new Date();
        const isExpired =
          existingPayment.paymentRequestExpiresAt && existingPayment.paymentRequestExpiresAt < now;
        const hasWrongFormat =
          existingPayment.paymentLink.includes('checkout.cashfree.com') ||
          existingPayment.paymentLink.includes('/pay/session_') ||
          existingPayment.paymentLink.includes('paymentpayment') ||
          existingPayment.paymentLink.includes('www.cashfree.com') ||
          existingPayment.paymentLink.includes('/checkout/pay/');

        if (isExpired || hasWrongFormat) {
          console.log(
            'Existing payment link is expired or has wrong format, creating fresh payment link'
          );

          // Create a fresh payment link using the same logic as new payments
          const contactPhone =
            serviceRequest.requestType === 'other'
              ? serviceRequest.beneficiaryPhone
              : serviceRequest.userPhone;

          const contactName =
            serviceRequest.requestType === 'other'
              ? serviceRequest.beneficiaryName
              : serviceRequest.userName;

          // Recalculate amount with GST if needed
          const amountBreakdown = calculateTotalPaymentAmount(serviceRequest);
          const freshAmount = amountBreakdown.totalAmount;

          console.log('Creating fresh payment link with contact:', {
            contactPhone,
            contactName,
            baseAmount: amountBreakdown.baseAmount,
            gstAmount: amountBreakdown.gstAmount,
            totalAmount: freshAmount,
          });

          const paymentResult = await cashfreeGateway.createPaymentLink({
            amount: freshAmount,
            currency: 'INR',
            description: `Payment for service request ${serviceRequestId}`,
            customer: {
              name:
                contactName ||
                serviceRequest.customerId?.username ||
                serviceRequest.customerId?.name ||
                'Customer',
              email: serviceRequest.customerId?.email || 'customer@example.com',
              contact: contactPhone || serviceRequest.customerId?.phone || '9999999999',
            },
            callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/callback`,
          });

          if (!paymentResult) {
            console.error('Failed to create fresh payment link');
            return res.status(500).json({
              success: false,
              message: 'Failed to generate fresh payment link',
            });
          }

          // Update the existing payment transaction with fresh details
          existingPayment.amount = freshAmount;
          existingPayment.paymentLink = paymentResult.short_url;
          existingPayment.paymentSessionId = paymentResult.payment_session_id;
          existingPayment.gatewayOrderId = paymentResult.id;
          existingPayment.status = 'Pending';
          existingPayment.paymentRequestExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
          existingPayment.gstBreakdown = {
            baseAmount: amountBreakdown.baseAmount,
            gstAmount: amountBreakdown.gstAmount,
            gstRate: amountBreakdown.gstAmount > 0 ? 18 : 0,
          };
          await existingPayment.save();

          console.log('Successfully created fresh payment link:', existingPayment.paymentLink);
          return res.status(200).json({
            success: true,
            message: 'Fresh payment link created',
            data: {
              transactionId: existingPayment._id,
              orderId: existingPayment.gatewayOrderId,
              paymentLink: existingPayment.paymentLink,
              paymentSessionId: existingPayment.paymentSessionId,
              status: existingPayment.status,
            },
          });
        }

        console.log('Returning existing valid payment link:', existingPayment.paymentLink);
        return res.status(200).json({
          success: true,
          message: 'Payment already exists for this service request',
          data: {
            transactionId: existingPayment._id,
            orderId: existingPayment.gatewayOrderId,
            paymentLink: existingPayment.paymentLink,
            paymentSessionId: existingPayment.paymentSessionId,
            status: existingPayment.status,
          },
        });
      } else {
        // If no payment link exists for the pending transaction, try to create one
        console.log(
          'Existing payment found but no payment link. Attempting to create a new payment link for existing transaction.'
        );

        // Re-use the logic for creating a payment link
        const contactPhone =
          serviceRequest.requestType === 'other'
            ? serviceRequest.beneficiaryPhone
            : serviceRequest.userPhone;

        const contactName =
          serviceRequest.requestType === 'other'
            ? serviceRequest.beneficiaryName
            : serviceRequest.userName;

        // Recalculate amount with GST if needed
        const amountBreakdown = calculateTotalPaymentAmount(serviceRequest);
        const freshAmount = amountBreakdown.totalAmount;

        console.log('Creating payment link for existing transaction with contact:', {
          contactPhone,
          contactName,
          baseAmount: amountBreakdown.baseAmount,
          gstAmount: amountBreakdown.gstAmount,
          totalAmount: freshAmount,
        });

        const paymentResult = await cashfreeGateway.createPaymentLink({
          amount: freshAmount,
          currency: 'INR',
          description: `Payment for service request ${serviceRequestId}`,
          customer: {
            name:
              contactName ||
              serviceRequest.customerId?.username ||
              serviceRequest.customerId?.name ||
              'Customer',
            email: serviceRequest.customerId?.email || 'customer@example.com',
            contact: contactPhone || serviceRequest.customerId?.phone || '9999999999',
          },
          callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/callback`,
        });

        if (!paymentResult) {
          console.error('Cashfree payment link creation failed for existing transaction');
          return res.status(500).json({
            success: false,
            message: 'Failed to generate payment link for existing transaction',
          });
        }

        // Update the existing payment transaction with Cashfree details
        existingPayment.amount = freshAmount;
        existingPayment.paymentLink = paymentResult.short_url;
        existingPayment.paymentSessionId = paymentResult.payment_session_id;
        existingPayment.gatewayOrderId = paymentResult.id;
        existingPayment.status = 'Pending'; // Ensure status is pending if a new link is generated
        existingPayment.gstBreakdown = {
          baseAmount: amountBreakdown.baseAmount,
          gstAmount: amountBreakdown.gstAmount,
          gstRate: amountBreakdown.gstAmount > 0 ? 18 : 0,
        };
        await existingPayment.save();

        console.log(
          'Successfully generated new payment link for existing transaction:',
          existingPayment.paymentLink
        );
        return res.status(200).json({
          success: true,
          message: 'Payment link generated for existing transaction',
          data: {
            transactionId: existingPayment._id,
            orderId: existingPayment.gatewayOrderId,
            paymentLink: existingPayment.paymentLink,
            paymentSessionId: existingPayment.paymentSessionId,
            status: existingPayment.status,
          },
        });
      }
    }

    // Create payment with Cashfree using official SDK
    console.log(
      'Creating Cashfree payment link for total amount (including all fees):',
      finalAmount
    );

    // Determine the correct phone number based on requestType
    const contactPhone =
      serviceRequest.requestType === 'other'
        ? serviceRequest.beneficiaryPhone
        : serviceRequest.userPhone;

    const contactName =
      serviceRequest.requestType === 'other'
        ? serviceRequest.beneficiaryName
        : serviceRequest.userName;

    console.log('Payment contact details:', {
      requestType: serviceRequest.requestType,
      contactPhone,
      contactName,
      userPhone: serviceRequest.userPhone,
      beneficiaryPhone: serviceRequest.beneficiaryPhone,
    });

    const paymentResult = await cashfreeGateway.createPaymentLink({
      amount: finalAmount, // Using calculated total amount (admin price + service type + addons)
      currency: 'INR',
      description: `Payment for service request ${serviceRequestId}`,
      customer: {
        name:
          contactName ||
          serviceRequest.customerId?.username ||
          serviceRequest.customerId?.name ||
          'Customer',
        email: serviceRequest.customerId?.email || 'customer@example.com',
        contact: contactPhone || serviceRequest.customerId?.phone || '9999999999',
      },
      callback_url: `${process.env.FRONTEND_URL}/payment/callback`,
    });

    if (!paymentResult) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment request',
        error: 'Payment gateway returned no response',
      });
    }

    // Create payment transaction record using the calculated total amount
    // Calculate platform fee on base amount (before GST)
    const platformFee = Math.round(amountBreakdown.baseAmount * 0.025);
    const vendorEarnings = amountBreakdown.baseAmount - platformFee;

    const paymentTransaction = new PaymentTransaction({
      serviceRequestId: serviceRequest._id, // Use ObjectId, not request_id string
      customerId: (serviceRequest.customerId as any)?._id || customerUserId,
      vendorId,
      amount: finalAmount, // Total amount including GST (sent to Cashfree)
      platformFee,
      vendorEarnings,
      paymentDescription: description || `Payment for service request ${serviceRequestId}`,
      customerNotes: customerNotes || '',
      paymentMethod: 'Cashfree', // Only Cashfree payments allowed
      gatewayProvider: 'Cashfree',
      gatewayOrderId: paymentResult.id || 'TXN_' + Date.now(),
      paymentLink: paymentResult.short_url,
      paymentSessionId: paymentResult.payment_session_id,
      status: 'Pending',
      earningsStatus: 'Pending',
      // Coupon discount applied
      ...(couponCode ? { couponCode, couponDiscount } : {}),
      // Wallet amount used
      ...(walletAmountUsed > 0 ? { walletAmountUsed } : {}),
      // Store GST breakdown for invoice generation
      gstBreakdown: {
        baseAmount: amountBreakdown.baseAmount,
        gstAmount: amountBreakdown.gstAmount,
        gstRate: amountBreakdown.gstAmount > 0 ? 18 : 0,
      },
    });

    await paymentTransaction.save();

    res.status(200).json({
      success: true,
      message: 'Payment request created successfully',
      data: {
        transactionId: paymentTransaction._id,
        paymentLink: paymentResult.short_url || paymentResult.id,
        paymentSessionId: paymentResult.payment_session_id,
        orderId: paymentResult.id,
      },
    });
  } catch (error: any) {
    console.error('Create customer payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// Create payment request (vendor initiates payment request to customer)
export const createPaymentRequest = async (req: AuthRequest, res: Response) => {
  try {
    const vendorUserId = req.user?.userId;
    const {
      serviceRequestId,
      amount,
      description,
      customerNotes,
      paymentProvider = 'cashfree',
    } = req.body;

    if (!vendorUserId) {
      return res.status(401).json({
        success: false,
        message: 'Vendor authentication required',
      });
    }

    // Get vendor details
    const vendor = await Vendor.findOne({ 'pocInfo.userId': vendorUserId });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Get service request details (dual-lookup: request_id string or ObjectId)
    let serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId }).populate(
      'customerId'
    );
    if (!serviceRequest && mongoose.Types.ObjectId.isValid(serviceRequestId)) {
      serviceRequest = await ServiceRequest.findById(serviceRequestId).populate('customerId');
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Verify vendor is assigned to this service request
    if (serviceRequest.assignedTechnician?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to create payment request for this service',
      });
    }

    // Calculate the correct total amount (admin price + GST if applicable)
    const amountBreakdown = calculateTotalPaymentAmount(serviceRequest);
    console.log('=== Vendor Payment Request Amount Calculation ===');
    console.log('Amount from vendor request:', amount);
    console.log('Amount breakdown:', {
      baseAmount: amountBreakdown.baseAmount,
      gstAmount: amountBreakdown.gstAmount,
      totalAmount: amountBreakdown.totalAmount,
    });

    // Use the calculated total amount (includes GST if admin price is set)
    const finalAmount = amountBreakdown.totalAmount;
    console.log('Final amount for payment request (including GST):', finalAmount);

    // Validate the final amount
    if (!isValidAmount(finalAmount)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment amount. Amount must be between ₹1 and ₹10,00,000',
      });
    }

    // Check if payment already exists for this service request
    const existingPayment = await PaymentTransaction.findOne({
      serviceRequestId: serviceRequest._id, // Use ObjectId
      status: { $in: ['Pending', 'Requested', 'Processing', 'Completed'] },
    });

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: 'Payment request already exists for this service',
      });
    }

    const customer = serviceRequest.customerId as any;

    // Calculate platform fee on base amount (before GST)
    const platformFee = Math.round(amountBreakdown.baseAmount * 0.025);
    const vendorEarnings = amountBreakdown.baseAmount - platformFee;

    // Create payment transaction record using the calculated total amount
    const paymentTransaction = new PaymentTransaction({
      vendorId: vendor._id,
      serviceRequestId: serviceRequest._id, // Use ObjectId, not request_id string
      customerId: customer._id,
      amount: finalAmount, // Total amount including GST (sent to Cashfree)
      platformFee,
      vendorEarnings,
      paymentDescription:
        description || `Payment for ${serviceRequest.brand} ${serviceRequest.model} service`,
      customerNotes,
      status: 'Requested',
      paymentMethod: 'UPI', // Default, will be updated when customer pays
      gatewayProvider: paymentProvider === 'cashfree' ? 'Cashfree' : 'PhonePe',
      paymentRequestSentAt: new Date(),
      paymentRequestExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      // Store GST breakdown for invoice generation
      gstBreakdown: {
        baseAmount: amountBreakdown.baseAmount,
        gstAmount: amountBreakdown.gstAmount,
        gstRate: amountBreakdown.gstAmount > 0 ? 18 : 0,
      },
    });

    let paymentLink: any;
    let gatewayOrderId: string;

    {
      // Create payment link using Cashfree

      // Determine the correct phone number based on requestType
      const contactPhone =
        serviceRequest.requestType === 'other'
          ? serviceRequest.beneficiaryPhone
          : serviceRequest.userPhone;

      const contactName =
        serviceRequest.requestType === 'other'
          ? serviceRequest.beneficiaryName
          : serviceRequest.userName;

      console.log('Payment request contact details:', {
        requestType: serviceRequest.requestType,
        contactPhone,
        contactName,
        userPhone: serviceRequest.userPhone,
        beneficiaryPhone: serviceRequest.beneficiaryPhone,
      });

      const paymentLinkRequest = {
        amount: finalAmount, // Using calculated total (admin price + service type + addons)
        currency: 'INR',
        description: paymentTransaction.paymentDescription,
        customer: {
          name: contactName || customer.username,
          email: customer.email,
          contact: contactPhone || customer.phone || '9999999999',
        },
        notify: {
          sms: true,
          email: true,
        },
        reminder_enable: true,
        callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/callback`,
        callback_method: 'get',
        expire_by: paymentTransaction.paymentRequestExpiresAt
          ? Math.floor(paymentTransaction.paymentRequestExpiresAt.getTime() / 1000)
          : Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
        notes: {
          serviceRequestId,
          vendorId: vendor._id.toString(),
          transactionId: paymentTransaction._id.toString(),
        },
      };

      paymentLink = await cashfreeGateway.createPaymentLink(paymentLinkRequest);
      gatewayOrderId = paymentLink.id;
    }

    // Update transaction with payment link details
    paymentTransaction.paymentLink = paymentLink.short_url;
    paymentTransaction.gatewayOrderId = gatewayOrderId;
    await paymentTransaction.save();

    // Send email to customer
    await mailSender(
      customer.email,
      'Payment Request for Your Service',
      `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Payment Request</h2>
                <p>Dear ${customer.username},</p>
                <p>You have received a payment request for your recent service.</p>
                
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #007bff; margin-top: 0;">Service Details</h3>
                    <p><strong>Service:</strong> ${serviceRequest.brand} ${serviceRequest.model}</p>
                    <p><strong>Description:</strong> ${paymentTransaction.paymentDescription}</p>
                    <p><strong>Total Amount (includes all fees):</strong> ${formatAmount(finalAmount)}</p>
                    <p><strong>Vendor:</strong> ${vendor.pocInfo.fullName}</p>
                    ${customerNotes ? `<p><strong>Notes:</strong> ${customerNotes}</p>` : ''}
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${paymentLink.short_url}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                        Pay Now
                    </a>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                    This payment request will expire in 24 hours. If you have any questions, please contact the vendor directly.
                </p>
                
                <p>Best regards,<br>The Support Team</p>
            </div>
            `
    );

    res.status(201).json({
      success: true,
      message: 'Payment request created successfully',
      data: {
        transactionId: paymentTransaction._id,
        paymentLink: paymentLink.short_url,
        amount: formatAmount(finalAmount), // Total amount including all fees
        expiresAt: paymentTransaction.paymentRequestExpiresAt,
      },
    });
  } catch (error: any) {
    console.error('Create payment request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating payment request',
      error: error.message,
    });
  }
};

// Get vendor payment transactions
export const getVendorPayments = async (req: AuthRequest, res: Response) => {
  try {
    const vendorUserId = req.user?.userId;
    const { status, page = 1, limit = 10 } = req.query;

    if (!vendorUserId) {
      return res.status(401).json({
        success: false,
        message: 'Vendor authentication required',
      });
    }

    // Get vendor details
    const vendor = await Vendor.findOne({ 'pocInfo.userId': vendorUserId });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Build query
    const query: any = { vendorId: vendor._id };
    if (status && status !== 'all') {
      query.status = status;
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Get payments
    const payments = await PaymentTransaction.find(query)
      .populate('serviceRequestId', 'brand model problemDescription createdAt')
      .populate('customerId', 'username email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await PaymentTransaction.countDocuments(query);

    // Get earnings summary
    const earningsSummary = await PaymentTransaction.aggregate([
      { $match: { vendorId: vendor._id } },
      {
        $group: {
          _id: '$earningsStatus',
          totalAmount: { $sum: '$amount' },
          totalEarnings: { $sum: '$vendorEarnings' },
          totalPlatformFee: { $sum: '$platformFee' },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        payments,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
        },
        earningsSummary,
      },
    });
  } catch (error: any) {
    console.error('Get vendor payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message,
    });
  }
};

// Get customer payment history
export const getCustomerPayments = async (req: AuthRequest, res: Response) => {
  try {
    const customerId = req.user?.userId;
    const { status, page = 1, limit = 10 } = req.query;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Build query
    const query: any = { customerId };
    if (status && status !== 'all') {
      query.status = status;
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Get payments
    const payments = await PaymentTransaction.find(query)
      .populate('serviceRequestId', 'brand model problemDescription createdAt')
      .populate('vendorId', 'pocInfo.fullName pocInfo.email pocInfo.phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await PaymentTransaction.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        payments,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
        },
      },
    });
  } catch (error: any) {
    console.error('Get customer payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message,
    });
  }
};

// Payment webhook handler (Cashfree)
export const handlePaymentWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.get('X-VERIFY');
    const body = JSON.stringify(req.body);

    // Verify webhook signature for Cashfree
    if (
      !signature ||
      !cashfreeGateway.verifyPaymentSignature(
        req.body.orderId,
        req.body.orderAmount,
        req.body.referenceId,
        req.body.txStatus,
        req.body.paymentMode,
        req.body.txMsg,
        req.body.txTime,
        signature
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook signature',
      });
    }

    const txStatus = req.body.txStatus;
    const orderId = req.body.orderId;
    const paymentDetails = req.body;

    switch (txStatus) {
      case 'SUCCESS':
        await handlePaymentSuccess(orderId, paymentDetails);
        break;

      case 'CANCELLED':
        await handlePaymentCancelled(orderId, paymentDetails);
        break;

      case 'FAILED':
        await handlePaymentFailed(orderId, paymentDetails);
        break;

      default:
        console.log('Unhandled Cashfree webhook status:', txStatus);
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Payment webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed',
      error: error.message,
    });
  }
};

/**
 * Shared function to process successful payment and credit technician wallet
 * This function is idempotent - it can be called multiple times safely
 * @param orderId - Gateway order ID
 * @param paymentDetails - Payment details from gateway
 * @returns Object with success status and transaction details
 */
export async function processPaymentSuccess(
  orderId: string,
  paymentDetails: any
): Promise<{ success: boolean; transaction?: any; error?: string }> {
  try {
    // Validate inputs
    if (!orderId || typeof orderId !== 'string') {
      console.error('❌ Invalid order ID:', orderId);
      return { success: false, error: 'Invalid order ID' };
    }

    // Find transaction with all required data
    const transaction = await PaymentTransaction.findOne({
      gatewayOrderId: orderId,
    })
      .populate('vendorId')
      .populate('customerId')
      .populate('serviceRequestId');

    if (!transaction) {
      console.error('❌ Transaction not found for order ID:', orderId);
      return { success: false, error: 'Transaction not found' };
    }

    // Security check: Verify payment amount matches if provided in paymentDetails
    if (
      paymentDetails?.orderAmount &&
      transaction.amount !== parseFloat(paymentDetails.orderAmount)
    ) {
      console.error('❌ Payment amount mismatch:', {
        transactionAmount: transaction.amount,
        gatewayAmount: paymentDetails.orderAmount,
        orderId,
      });
      // Log but don't fail - amounts might be in different formats
      // This is a warning, not a blocker
    }

    // Check if already processed (idempotency check)
    if (transaction.status === 'Completed' && transaction.earningsStatus === 'Available') {
      // Check if wallet was already credited
      const WalletTransaction = require('../models/walletTransaction.model').default;
      const existingWalletTransaction = await WalletTransaction.findOne({
        paymentTransactionId: transaction._id.toString(),
      });

      if (existingWalletTransaction) {
        console.log('✅ Payment already processed and wallet credited for order:', orderId);
        return { success: true, transaction };
      } else {
        // Transaction marked as completed but wallet not credited - credit it now
        console.log('⚠️ Payment marked as completed but wallet not credited. Crediting now...');
      }
    }

    const serviceRequest = transaction.serviceRequestId as any;
    const vendor = transaction.vendorId as any;

    if (!serviceRequest) {
      console.error('❌ Service request not found for transaction:', transaction._id);
      return { success: false, error: 'Service request not found' };
    }

    if (!vendor) {
      console.error('❌ Vendor not found for transaction:', transaction._id);
      return { success: false, error: 'Vendor not found' };
    }

    // Calculate payment breakdown
    let serviceCost = 0;
    let componentCost = 0;
    let pickupCost = 0;
    let emergencyCharges = 0;
    let warrantyCharges = 0;
    let dataSafetyCharges = 0;

    // Use paymentBreakdown if it exists (preferred method with all fees)
    if (serviceRequest.paymentBreakdown && serviceRequest.paymentBreakdown.totalCost > 0) {
      serviceCost = serviceRequest.paymentBreakdown.serviceCost || 0;
      componentCost = serviceRequest.paymentBreakdown.componentCost || 0;
      pickupCost = serviceRequest.paymentBreakdown.pickupCost || 0;
      emergencyCharges = serviceRequest.paymentBreakdown.emergencyCharges || 0;
      warrantyCharges = serviceRequest.paymentBreakdown.warrantyCharges || 0;
      dataSafetyCharges = serviceRequest.paymentBreakdown.dataSafetyCharges || 0;
    } else {
      // Fallback: Calculate from adminFinalPrice and calculatedPricing
      const adminPrice = serviceRequest.adminFinalPrice || serviceRequest.vendorServiceCharge || 0;
      componentCost = serviceRequest.adminComponentCharges || serviceRequest.componentCost || 0;

      // Get fees from calculatedPricing
      const calculatedPricing = serviceRequest.calculatedPricing || {};
      emergencyCharges = calculatedPricing.urgencyFee || 0;
      warrantyCharges = calculatedPricing.warrantyFee || 0;
      dataSafetyCharges = calculatedPricing.dataSafetyFee || 0;

      if (serviceRequest.serviceType === 'pickup-drop') {
        pickupCost = calculatedPricing.serviceTypeFee || 249;
        serviceCost = Math.max(
          0,
          adminPrice -
            componentCost -
            pickupCost -
            emergencyCharges -
            warrantyCharges -
            dataSafetyCharges
        );
      } else if (serviceRequest.serviceType === 'onsite') {
        pickupCost = calculatedPricing.serviceTypeFee || 149;
        serviceCost = Math.max(
          0,
          adminPrice -
            componentCost -
            pickupCost -
            emergencyCharges -
            warrantyCharges -
            dataSafetyCharges
        );
      } else {
        serviceCost = Math.max(
          0,
          adminPrice - componentCost - emergencyCharges - warrantyCharges - dataSafetyCharges
        );
        pickupCost = 0;
      }
    }

    // Credit technician wallet (idempotent - will check for existing transaction)
    console.log('💰 Crediting wallet for technician:', vendor._id.toString());
    console.log('📊 Payment breakdown:', {
      serviceCost,
      componentCost,
      pickupCost,
      emergencyCharges,
      warrantyCharges,
      dataSafetyCharges,
      totalCost: transaction.amount,
    });

    try {
      const walletResult = await creditTechnicianWallet(
        vendor._id.toString(),
        serviceRequest._id.toString(),
        transaction._id.toString(),
        {
          serviceCost,
          componentCost,
          pickupCost,
          emergencyCharges,
          warrantyCharges,
          dataSafetyCharges,
          totalCost: transaction.amount,
        }
      );

      if (!walletResult.success) {
        console.error('❌ Failed to credit wallet:', walletResult.error);
        // Log detailed error for debugging
        console.error('Wallet credit failure details:', {
          technicianId: vendor._id.toString(),
          serviceRequestId: serviceRequest._id.toString(),
          paymentTransactionId: transaction._id.toString(),
          error: walletResult.error,
        });
        // Don't fail the entire process if wallet credit fails - log and continue
        // This allows for manual intervention if needed
        // However, we should retry or alert admin
      } else {
        console.log('✅ Wallet credited successfully for transaction:', transaction._id);
        console.log('💰 Wallet transaction ID:', walletResult.transaction?._id);
      }
    } catch (walletError: any) {
      console.error('❌ Exception during wallet credit:', walletError);
      console.error('Stack trace:', walletError.stack);
      // Continue processing - wallet can be credited manually if needed
    }

    // Update transaction status (idempotent - safe to call multiple times)
    const wasAlreadyCompleted = transaction.status === 'Completed';
    transaction.status = 'Completed';
    transaction.paymentMethod =
      paymentDetails?.paymentMode || transaction.paymentMethod || 'Cashfree';
    if (paymentDetails?.referenceId) {
      transaction.gatewayTransactionId = paymentDetails.referenceId;
    }
    if (paymentDetails) {
      transaction.gatewayResponse = paymentDetails;
    }
    transaction.paymentCompletedAt = transaction.paymentCompletedAt || new Date();
    transaction.earningsStatus = 'Available';
    await transaction.save();

    // Update service request status (idempotent)
    await ServiceRequest.findByIdAndUpdate(transaction.serviceRequestId, {
      paymentStatus: 'completed',
      status: 'Completed',
      paymentTransactionId: transaction._id.toString(),
    });

    // ── Referral & Coupon post-payment hooks (non-blocking) ──────────────────
    if (!wasAlreadyCompleted) {
      const customerId =
        (transaction.customerId as any)?._id?.toString() ||
        (transaction.customerId as any)?.toString();
      const srId =
        (transaction.serviceRequestId as any)?._id?.toString() ||
        transaction.serviceRequestId?.toString();

      // 1. Mark coupon as REDEEMED if one was applied to this service request
      if (srId) {
        try {
          const { markCouponUsed } = require('../utils/couponService');
          const sr = await ServiceRequest.findById(srId).select('couponUsageId');
          if (sr?.couponUsageId) {
            await markCouponUsed(sr.couponUsageId.toString());
          }
        } catch (couponErr) {
          console.error('Coupon mark used error (non-fatal):', couponErr);
        }
      }

      // 2. Debit customer wallet if wallet was used for this payment
      if (customerId) {
        try {
          const walletUsed = (transaction as any).walletAmountUsed ?? 0;
          if (walletUsed > 0) {
            const { debitCustomerWallet } = require('../utils/rewardService');
            const debitResult = await debitCustomerWallet(
              customerId,
              walletUsed,
              `Wallet used for service request payment`,
              srId
            );
            if (!debitResult.success) {
              console.error('Wallet debit failed (non-fatal):', debitResult.error);
            }
          }
        } catch (walletErr) {
          console.error('Wallet debit error (non-fatal):', walletErr);
        }
      }

      // 3. Trigger referral reward if this is the referee's first completed booking
      if (customerId && srId) {
        try {
          const { onFirstBookingComplete } = require('../utils/referralService');
          await onFirstBookingComplete(customerId, srId);
        } catch (refErr) {
          console.error('Referral reward trigger error (non-fatal):', refErr);
        }
      }
    }
    // ── End referral & coupon hooks ──────────────────────────────────────────

    // Send confirmation emails only if this is the first time processing
    if (!wasAlreadyCompleted) {
      const customer = transaction.customerId as any;

      // Email to vendor
      try {
        await mailSender(
          vendor.pocInfo.email,
          'Payment Received',
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #28a745;">Payment Received!</h2>
                <p>Dear ${vendor.pocInfo.fullName},</p>
                <p>Great news! You have received a payment for your service.</p>
                
                <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #155724; margin-top: 0;">Payment Details</h3>
                    <p><strong>Amount:</strong> ${formatAmount(transaction.amount)}</p>
                    <p><strong>Your Earnings:</strong> ${formatAmount(transaction.vendorEarnings || transaction.amount * 0.85)}</p>
                    <p><strong>Platform Fee:</strong> ${formatAmount(transaction.platformFee || transaction.amount * 0.15)}</p>
                    <p><strong>Customer:</strong> ${customer?.username || 'Customer'}</p>
                    <p><strong>Payment Method:</strong> ${paymentDetails?.paymentMode || 'Cashfree'}</p>
                </div>
                
                <p>Your earnings have been credited to your wallet and are available for withdrawal.</p>
                <p>Best regards,<br>The Support Team</p>
            </div>
            `
        );
      } catch (emailError) {
        console.error('Failed to send vendor email:', emailError);
        // Don't fail the process if email fails
      }

      // Email to customer
      try {
        await mailSender(
          customer?.email || 'customer@example.com',
          'Payment Confirmation',
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #28a745;">Payment Successful!</h2>
                <p>Dear ${customer?.username || 'Customer'},</p>
                <p>Your payment has been processed successfully.</p>
                
                <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #155724; margin-top: 0;">Payment Details</h3>
                    <p><strong>Amount:</strong> ${formatAmount(transaction.amount)}</p>
                    <p><strong>Transaction ID:</strong> ${paymentDetails?.referenceId || transaction.gatewayTransactionId || 'N/A'}</p>
                    <p><strong>Payment Method:</strong> ${paymentDetails?.paymentMode || 'Cashfree'}</p>
                    <p><strong>Service Provider:</strong> ${vendor.pocInfo.fullName}</p>
                </div>
                
                <p>Thank you for using our service!</p>
                <p>Best regards,<br>The Support Team</p>
            </div>
            `
        );
      } catch (emailError) {
        console.error('Failed to send customer email:', emailError);
        // Don't fail the process if email fails
      }
    }

    console.log('✅ Payment success processed successfully for order:', orderId);
    return { success: true, transaction };
  } catch (error: any) {
    console.error('❌ Error processing payment success:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Legacy function name for backward compatibility
 * Now calls the shared processPaymentSuccess function
 */
async function handlePaymentSuccess(orderId: string, paymentDetails: any) {
  return await processPaymentSuccess(orderId, paymentDetails);
}

async function handlePaymentCancelled(orderId: string, paymentDetails: any) {
  try {
    await PaymentTransaction.findOneAndUpdate(
      { gatewayOrderId: orderId },
      {
        status: 'Cancelled',
        earningsStatus: 'Pending',
        gatewayResponse: paymentDetails,
      }
    );
  } catch (error) {
    console.error('Error handling payment cancelled:', error);
  }
}

// This function is now covered by handlePaymentSuccess

async function handlePaymentFailed(orderId: string, paymentDetails: any) {
  try {
    await PaymentTransaction.findOneAndUpdate(
      { gatewayOrderId: orderId },
      {
        status: 'Failed',
        failureReason: paymentDetails.txMsg || 'Payment failed',
        gatewayResponse: paymentDetails,
      }
    );
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
}

// Get payment details
export const getPaymentDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const transaction = await PaymentTransaction.findById(transactionId)
      .populate('vendorId', 'pocInfo.fullName pocInfo.email pocInfo.phone')
      .populate('serviceRequestId', 'brand model problemDescription createdAt')
      .populate('customerId', 'username email phone');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Payment transaction not found',
      });
    }

    // Check if user has access to this transaction
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    const isVendor = vendor && vendor._id.toString() === transaction.vendorId.toString();
    const isCustomer = transaction.customerId.toString() === userId;

    if (!isVendor && !isCustomer) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error: any) {
    console.error('Get payment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment details',
      error: error.message,
    });
  }
};

// Legacy create transaction endpoint (for backward compatibility)
export const createTransaction = async (req: Request, res: Response) => {
  try {
    const { vendorId, serviceRequestId, amount, paymentMethod } = req.body;

    const vendor = await Vendor.findById(vendorId);
    const serviceRequest = await ServiceRequest.findOne({ request_id: serviceRequestId });

    if (!vendor || !serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Vendor or Service Request not found.',
      });
    }

    const transaction = await PaymentTransaction.create({
      vendorId,
      serviceRequestId,
      customerId: serviceRequest.customerId,
      amount,
      paymentMethod,
      status: 'Completed',
      earningsStatus: 'Available',
    });

    await mailSender(
      vendor?.pocInfo?.email,
      'New Payment Transaction Created',
      `<p>Dear ${vendor?.pocInfo?.fullName},</p>
             <p>A new payment transaction has been created for your service request.</p>
             <p>Transaction ID: ${transaction._id}</p>
             <p>Amount: ${formatAmount(transaction.amount)}</p>
             <p>Payment Method: ${transaction.paymentMethod}</p>
             <p>Status: ${transaction.status}</p>`
    );

    res.status(201).json({
      success: true,
      data: transaction,
    });
  } catch (err: any) {
    console.error('Create transaction error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating transaction',
      error: err.message,
    });
  }
};

// Get transactions by vendor
export const getTransactionsByVendor = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    const query: any = { vendorId };
    if (status && status !== 'all') {
      query.status = status;
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const transactions = await PaymentTransaction.find(query)
      .populate('serviceRequestId', 'brand model problemDescription')
      .populate('customerId', 'username email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await PaymentTransaction.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
        },
      },
    });
  } catch (err: any) {
    console.error('Get transactions by vendor error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions',
      error: err.message,
    });
  }
};

// Get transaction by ID
export const getTransactionById = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    const transaction = await PaymentTransaction.findById(transactionId)
      .populate('vendorId', 'pocInfo.fullName pocInfo.email pocInfo.phone')
      .populate('serviceRequestId', 'brand model problemDescription createdAt')
      .populate('customerId', 'username email phone');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (err: any) {
    console.error('Get transaction by ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction',
      error: err.message,
    });
  }
};

// Get payment history by service request
export const getPaymentHistoryByServiceRequest = async (req: Request, res: Response) => {
  try {
    const { serviceRequestId } = req.params;

    // Dual-lookup: try request_id string first, then ObjectId fallback
    const serviceRequest =
      (await ServiceRequest.findOne({ request_id: serviceRequestId })) ||
      (mongoose.Types.ObjectId.isValid(serviceRequestId)
        ? await ServiceRequest.findById(serviceRequestId)
        : null);
    if (!serviceRequest) {
      return res.status(404).json({ success: false, message: 'Service request not found.' });
    }

    const payments = await PaymentTransaction.find({ serviceRequestId: serviceRequest._id })
      .populate('vendorId', 'pocInfo.fullName pocInfo.email')
      .populate('customerId', 'username email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (err: any) {
    console.error('Get payment history by service request error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment history',
      error: err.message,
    });
  }
};
