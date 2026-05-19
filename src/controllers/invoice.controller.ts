import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import ServiceRequest from '../models/serviceRequest.model';
import PaymentTransaction from '../models/PaymentTransaction.model';
import mongoose from 'mongoose';
import {
  checkInvoiceExistsInS3,
  uploadInvoiceToS3,
  generateInvoiceHTML,
  generatePDFFromHTML,
} from '../utils/invoiceService';
import { mailSenderWithAttachment } from '../utils/mailSender';

/**
 * Download/Generate Invoice PDF
 *
 * Flow:
 * 1. Check if invoice exists in S3 (future-ready, commented)
 * 2. If exists, return it
 * 3. If not, generate new invoice:
 *    - Fetch service request & payment data
 *    - Build invoice HTML template
 *    - Generate PDF using Puppeteer
 *    - Auto-email invoice to customer
 *    - Upload to S3 (future-ready, commented)
 *    - Return PDF for preview/download
 */
export const downloadInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Generate invoice number
    const invoiceNumber = `INV-${id}`;

    // FUTURE: Check if invoice exists in S3
    // const existingInvoice = await checkInvoiceExistsInS3(invoiceNumber);
    // if (existingInvoice) {
    //   console.log(`Invoice ${invoiceNumber} found in S3, returning existing PDF`);
    //   res.setHeader('Content-Type', 'application/pdf');
    //   res.setHeader('Content-Disposition', `inline; filename="${invoiceNumber}.pdf"`);
    //   return res.send(existingInvoice);
    // }

    // Fetch service request with populated data (dual-lookup: request_id or ObjectId)
    let serviceRequest = await ServiceRequest.findOne({ request_id: id })
      .populate('customerId', 'username email phone')
      .populate(
        'assignedVendor',
        'pocInfo.fullName pocInfo.phone pocInfo.email businessDetails.businessName'
      );
    if (!serviceRequest && mongoose.Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id)
        .populate('customerId', 'username email phone')
        .populate(
          'assignedVendor',
          'pocInfo.fullName pocInfo.phone pocInfo.email businessDetails.businessName'
        );
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify user has access to this invoice
    const customerId =
      (serviceRequest.customerId as any)?._id?.toString() || serviceRequest.customerId?.toString();
    if (customerId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this invoice.',
      });
    }

    // Check if payment is completed
    if (serviceRequest.paymentStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Invoice can only be generated for completed payments.',
      });
    }

    // Fetch payment transaction (use serviceRequest._id — ObjectId ref in PaymentTransaction)
    const paymentTransaction = await PaymentTransaction.findOne({
      serviceRequestId: serviceRequest._id,
      customerId: userId,
      status: 'Completed',
    }).sort({ createdAt: -1 }); // Get most recent completed payment

    if (!paymentTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Payment transaction not found.',
      });
    }

    // Validate payment transaction has required data
    if (!paymentTransaction.amount || paymentTransaction.amount <= 0) {
      console.error('Invalid payment transaction amount:', {
        transactionId: paymentTransaction._id,
        amount: paymentTransaction.amount,
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid payment transaction: amount is missing or invalid.',
      });
    }

    // Extract customer information
    const customer = serviceRequest.customerId as any;
    const customerName = customer?.username || serviceRequest.userName || 'Customer';
    const customerEmail = customer?.email || '';
    // Use phone number from service request (userPhone) instead of customer login details
    // If request is for someone else, use beneficiary phone, otherwise use userPhone
    const customerPhone =
      serviceRequest.requestType === 'other' && serviceRequest.beneficiaryPhone
        ? serviceRequest.beneficiaryPhone
        : serviceRequest.userPhone || customer?.phone || '';

    // Extract vendor information
    const vendor = serviceRequest.assignedVendor as any;
    const vendorName =
      vendor?.pocInfo?.fullName || vendor?.businessDetails?.businessName || 'Service Provider';

    // Build invoice items from payment breakdown
    // Use GST breakdown from payment transaction if available (preferred method)
    const items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      tax: number;
      total: number;
    }> = [];

    let subtotal: number;
    let totalTax: number;
    let grandTotal: number;

    // Check if payment transaction has GST breakdown (new method)
    if (paymentTransaction.gstBreakdown && paymentTransaction.gstBreakdown.baseAmount > 0) {
      // Use GST breakdown from payment transaction
      const baseAmount = paymentTransaction.gstBreakdown.baseAmount;
      const gstAmount = paymentTransaction.gstBreakdown.gstAmount || 0;

      // Build detailed items from payment breakdown if available
      if (serviceRequest.paymentBreakdown) {
        // Service cost
        if (serviceRequest.paymentBreakdown.serviceCost > 0) {
          items.push({
            description: `Service Charge - ${serviceRequest.problemDescription || 'Device Repair'}`,
            quantity: 1,
            unitPrice: serviceRequest.paymentBreakdown.serviceCost,
            tax: 0, // GST shown separately at bottom
            total: serviceRequest.paymentBreakdown.serviceCost,
          });
        }

        // Component cost
        if (serviceRequest.paymentBreakdown.componentCost > 0) {
          items.push({
            description: `Component Replacement - ${serviceRequest.adminComponentNotes || 'Parts & Components'}`,
            quantity: 1,
            unitPrice: serviceRequest.paymentBreakdown.componentCost,
            tax: 0,
            total: serviceRequest.paymentBreakdown.componentCost,
          });
        }

        // Pickup & Delivery Charge (pickup-drop) / Onsite Visit Charge (onsite)
        // paymentBreakdown.pickupCost is only stored for pickup-drop; onsite fee is always 0 there,
        // so derive it from calculatedPricing.serviceTypeFee when needed.
        const _storedPickup = (serviceRequest as any).paymentBreakdown?.pickupCost || 0;
        const _derivedServiceFee =
          _storedPickup === 0 &&
          ['pickup-drop', 'onsite'].includes(String(serviceRequest.serviceType)) &&
          (serviceRequest as any).calculatedPricing?.serviceTypeFee > 0
            ? (serviceRequest as any).calculatedPricing.serviceTypeFee
            : 0;
        const _serviceTypeFee = _storedPickup > 0 ? _storedPickup : _derivedServiceFee;
        if (_serviceTypeFee > 0) {
          items.push({
            description:
              serviceRequest.serviceType === 'onsite'
                ? 'Onsite Visit Charge'
                : 'Pickup & Delivery Charge',
            quantity: 1,
            unitPrice: _serviceTypeFee,
            tax: 0,
            total: _serviceTypeFee,
          });
        }

        // Captain home delivery charge (visit-shop captain delivery)
        const _deliveryCost = (serviceRequest as any).paymentBreakdown?.deliveryCost || 0;
        if (_deliveryCost > 0) {
          items.push({
            description: 'Captain Home Delivery',
            quantity: 1,
            unitPrice: _deliveryCost,
            tax: 0,
            total: _deliveryCost,
          });
        }

        // Emergency charges
        if (serviceRequest.paymentBreakdown.emergencyCharges > 0) {
          items.push({
            description: 'Emergency Service Charges',
            quantity: 1,
            unitPrice: serviceRequest.paymentBreakdown.emergencyCharges,
            tax: 0,
            total: serviceRequest.paymentBreakdown.emergencyCharges,
          });
        }

        // Warranty charges
        if (serviceRequest.paymentBreakdown.warrantyCharges > 0) {
          items.push({
            description: 'Extended Warranty',
            quantity: 1,
            unitPrice: serviceRequest.paymentBreakdown.warrantyCharges,
            tax: 0,
            total: serviceRequest.paymentBreakdown.warrantyCharges,
          });
        }

        // Data safety charges
        if (serviceRequest.paymentBreakdown.dataSafetyCharges > 0) {
          items.push({
            description: 'Data Safety & Backup Service',
            quantity: 1,
            unitPrice: serviceRequest.paymentBreakdown.dataSafetyCharges,
            tax: 0,
            total: serviceRequest.paymentBreakdown.dataSafetyCharges,
          });
        }
      }

      // If no detailed items, create a single item
      if (items.length === 0) {
        items.push({
          description: `Service Charge - ${serviceRequest.problemDescription || 'Device Repair'}`,
          quantity: 1,
          unitPrice: baseAmount,
          tax: 0, // GST shown separately
          total: baseAmount,
        });
      }

      // Calculate totals
      subtotal = baseAmount;
      totalTax = gstAmount;
      grandTotal = paymentTransaction.amount || 0;
    } else {
      // Fallback: Old method (calculate GST on each item) - for backward compatibility
      // Service cost
      if (
        serviceRequest.paymentBreakdown?.serviceCost &&
        serviceRequest.paymentBreakdown.serviceCost > 0
      ) {
        const serviceCost = serviceRequest.paymentBreakdown.serviceCost;
        const tax = serviceCost * 0.18; // 18% GST
        items.push({
          description: `Service Charge - ${serviceRequest.problemDescription || 'Device Repair'}`,
          quantity: 1,
          unitPrice: serviceCost,
          tax: tax,
          total: serviceCost + tax,
        });
      }

      // Component cost
      if (
        serviceRequest.paymentBreakdown?.componentCost &&
        serviceRequest.paymentBreakdown.componentCost > 0
      ) {
        const componentCost = serviceRequest.paymentBreakdown.componentCost;
        const tax = componentCost * 0.18; // 18% GST
        items.push({
          description: `Component Replacement - ${serviceRequest.adminComponentNotes || 'Parts & Components'}`,
          quantity: 1,
          unitPrice: componentCost,
          tax: tax,
          total: componentCost + tax,
        });
      }

      // Pickup & Delivery Charge (pickup-drop) / Onsite Visit Charge (onsite)
      {
        const _storedPickupFb = (serviceRequest as any).paymentBreakdown?.pickupCost || 0;
        const _derivedFb =
          _storedPickupFb === 0 &&
          ['pickup-drop', 'onsite'].includes(String(serviceRequest.serviceType)) &&
          (serviceRequest as any).calculatedPricing?.serviceTypeFee > 0
            ? (serviceRequest as any).calculatedPricing.serviceTypeFee
            : 0;
        const _feeAmtFb = _storedPickupFb > 0 ? _storedPickupFb : _derivedFb;
        if (_feeAmtFb > 0) {
          const tax = _feeAmtFb * 0.18;
          items.push({
            description:
              serviceRequest.serviceType === 'onsite'
                ? 'Onsite Visit Charge'
                : 'Pickup & Delivery Charge',
            quantity: 1,
            unitPrice: _feeAmtFb,
            tax,
            total: _feeAmtFb + tax,
          });
        }
      }

      // Captain home delivery charge (visit-shop captain delivery)
      {
        const _deliveryCostFb = (serviceRequest as any).paymentBreakdown?.deliveryCost || 0;
        if (_deliveryCostFb > 0) {
          const tax = _deliveryCostFb * 0.18;
          items.push({
            description: 'Captain Home Delivery',
            quantity: 1,
            unitPrice: _deliveryCostFb,
            tax,
            total: _deliveryCostFb + tax,
          });
        }
      }

      // Emergency charges
      if (
        serviceRequest.paymentBreakdown?.emergencyCharges &&
        serviceRequest.paymentBreakdown.emergencyCharges > 0
      ) {
        const emergencyCharges = serviceRequest.paymentBreakdown.emergencyCharges;
        const tax = emergencyCharges * 0.18; // 18% GST
        items.push({
          description: 'Emergency Service Charges',
          quantity: 1,
          unitPrice: emergencyCharges,
          tax: tax,
          total: emergencyCharges + tax,
        });
      }

      // Warranty charges
      if (
        serviceRequest.paymentBreakdown?.warrantyCharges &&
        serviceRequest.paymentBreakdown.warrantyCharges > 0
      ) {
        const warrantyCharges = serviceRequest.paymentBreakdown.warrantyCharges;
        const tax = warrantyCharges * 0.18; // 18% GST
        items.push({
          description: 'Extended Warranty',
          quantity: 1,
          unitPrice: warrantyCharges,
          tax: tax,
          total: warrantyCharges + tax,
        });
      }

      // Data safety charges
      if (
        serviceRequest.paymentBreakdown?.dataSafetyCharges &&
        serviceRequest.paymentBreakdown.dataSafetyCharges > 0
      ) {
        const dataSafetyCharges = serviceRequest.paymentBreakdown.dataSafetyCharges;
        const tax = dataSafetyCharges * 0.18; // 18% GST
        items.push({
          description: 'Data Safety & Backup Service',
          quantity: 1,
          unitPrice: dataSafetyCharges,
          tax: tax,
          total: dataSafetyCharges + tax,
        });
      }

      // If no items found, create a single item from total amount
      if (items.length === 0) {
        const totalAmount = paymentTransaction.amount;
        const subtotal = totalAmount / 1.18; // Reverse calculate subtotal (assuming 18% tax)
        const tax = totalAmount - subtotal;
        items.push({
          description: `Service Charge - ${serviceRequest.problemDescription || 'Device Repair'}`,
          quantity: 1,
          unitPrice: subtotal,
          tax: tax,
          total: totalAmount,
        });
      }

      // Calculate totals
      subtotal = items.reduce((sum, item) => sum + item.unitPrice, 0);
      totalTax = items.reduce((sum, item) => sum + item.tax, 0);
      grandTotal = paymentTransaction.amount || 0;
    }

    // Validate totals
    if (grandTotal <= 0) {
      console.error('Invalid grand total calculated:', {
        serviceRequestId: id,
        grandTotal,
        paymentAmount: paymentTransaction.amount,
        itemsCount: items.length,
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice total. Please contact support.',
      });
    }

    // Format dates
    const issueDate = new Date().toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const serviceDate = serviceRequest.completedAt
      ? new Date(serviceRequest.completedAt).toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : new Date(serviceRequest.updatedAt).toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

    // Build invoice data
    const invoiceData = {
      invoiceNumber,
      issueDate,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress: serviceRequest.address || undefined,
      serviceDescription:
        (serviceRequest as any).subProblem?.name ||
        (serviceRequest as any).mainProblem?.name ||
        serviceRequest.problemDescription ||
        'Device Repair Service',
      deviceBrand: String(serviceRequest.brand || ''),
      deviceModel: String(serviceRequest.model || ''),
      serviceType: String(serviceRequest.serviceType || 'pickup-drop'),
      items,
      subtotal,
      totalTax,
      grandTotal,
      paymentMethod: String(paymentTransaction.paymentMethod || 'Online'),
      serviceDate,
      companyName: 'Fix4Ever',
      companyAddress: 'Nirmaan, IIT Madras, Chennai, TN, INDIA',
      companyPhone: '+91 8092902191',
      companyEmail: 'support@fix4ever.com',
      companyGstin: process.env.COMPANY_GSTIN || undefined,
      // GST breakdown from payment transaction
      ...(paymentTransaction.gstBreakdown && paymentTransaction.gstBreakdown.gstAmount > 0
        ? {
            gstBreakdown: {
              baseAmount: paymentTransaction.gstBreakdown.baseAmount,
              gstAmount: paymentTransaction.gstBreakdown.gstAmount,
              gstRate: paymentTransaction.gstBreakdown.gstRate || 18,
            },
          }
        : {}),
      // Discount details
      ...(paymentTransaction.couponDiscount && paymentTransaction.couponDiscount > 0
        ? {
            couponCode: paymentTransaction.couponCode || '',
            couponDiscount: paymentTransaction.couponDiscount,
          }
        : {}),
      ...((paymentTransaction as any).walletAmountUsed > 0
        ? { walletAmountUsed: (paymentTransaction as any).walletAmountUsed }
        : {}),
    };

    // Generate HTML invoice
    let html: string;
    try {
      html = generateInvoiceHTML(invoiceData);
    } catch (htmlError: any) {
      console.error('Error generating invoice HTML:', htmlError);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate invoice template',
        error: htmlError.message,
      });
    }

    // Generate PDF with better error handling
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generatePDFFromHTML(html);

      // Validate PDF buffer
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('Generated PDF buffer is empty');
      }
    } catch (pdfError: any) {
      console.error('Error generating PDF:', pdfError);
      console.error('PDF generation error details:', {
        serviceRequestId: id,
        invoiceNumber,
        errorMessage: pdfError.message,
        errorStack: pdfError.stack,
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF. Please try again or contact support.',
        error: process.env.NODE_ENV === 'development' ? pdfError.message : 'PDF generation failed',
      });
    }

    // Auto-email invoice to customer
    try {
      if (customerEmail) {
        const emailSubject = `Invoice ${invoiceNumber} - ${invoiceData.serviceDescription}`;
        const emailBody = `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <h2>Thank you for your business!</h2>
              <p>Dear ${customerName},</p>
              <p>Please find attached your invoice for the service request.</p>
              <p><strong>Invoice Number:</strong> ${invoiceNumber}</p>
              <p><strong>Service:</strong> ${invoiceData.serviceDescription}</p>
              <p><strong>Device:</strong> ${invoiceData.deviceBrand} ${invoiceData.deviceModel}</p>
              <p><strong>Total Amount:</strong> ₹${grandTotal.toFixed(2)}</p>
              <p>If you have any questions, please don't hesitate to contact us.</p>
              <br>
              <p>Best regards,<br>Fix4Ever Team</p>
            </body>
          </html>
        `;

        await mailSenderWithAttachment(
          customerEmail,
          emailSubject,
          emailBody,
          pdfBuffer,
          `${invoiceNumber}.pdf`
        );

        console.log(`Invoice ${invoiceNumber} sent via email to ${customerEmail}`);
      }
    } catch (emailError: any) {
      // Log error but don't fail the request
      console.error('Error sending invoice email:', emailError);
    }

    // FUTURE: Upload invoice to S3
    // await uploadInvoiceToS3(pdfBuffer, invoiceNumber);

    // Return PDF for preview/download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('Error generating invoice:', error);
    console.error('Invoice generation error details:', {
      serviceRequestId: req.params.id,
      userId: req.user?.userId,
      errorMessage: error.message,
      errorStack: error.stack,
    });

    // Don't expose internal error details in production
    const errorMessage =
      process.env.NODE_ENV === 'development'
        ? error.message
        : 'An unexpected error occurred while generating the invoice';

    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice. Please try again or contact support.',
      error: errorMessage,
    });
  }
};
