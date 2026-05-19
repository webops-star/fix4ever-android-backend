import crypto from 'crypto';
import axios from 'axios';
import cashfreeGateway from './cashfreeGateway';

// Payment Gateway Types
export type PaymentProvider = 'cashfree';

// Cashfree interfaces are implemented in cashfreeGateway.ts

interface CreatePaymentLinkRequest {
  amount: number;
  currency?: string;
  description?: string;
  customer: {
    name: string;
    email: string;
    contact: string;
  };
  notify?: {
    sms?: boolean;
    email?: boolean;
  };
  reminder_enable?: boolean;
  callback_url?: string;
  callback_method?: string;
  expire_by?: number;
  notes?: any;
}

interface PaymentLinkResponse {
  id: string;
  short_url: string;
  amount: number;
  currency: string;
  description: string;
  status: string;
  customer: any;
  notes?: any;
}

class PaymentGateway {
  constructor() {
    // Using Cashfree as the primary payment gateway
  }

  // Removed PhonePe specific methods in favor of Cashfree implementation

  /**
   * Create a payment order with Cashfree (using createPaymentLink)
   */
  async createOrder(
    amount: number,
    currency: string = 'INR',
    receipt?: string,
    notes?: any
  ): Promise<any> {
    return cashfreeGateway.createPaymentLink({
      amount,
      currency,
      description: receipt || 'Payment',
      customer: {
        name: 'Customer',
        email: 'customer@example.com',
        contact: '9999999999',
      },
      notes,
    });
  }

  /**
   * Create a payment link with Cashfree
   */
  async createPaymentLink(request: CreatePaymentLinkRequest): Promise<PaymentLinkResponse> {
    return cashfreeGateway.createPaymentLink(request);
  }

  /**
   * Verify payment signature (for webhook)
   */
  verifyPaymentSignature(
    orderId: string,
    orderAmount: string,
    referenceId: string,
    txStatus: string,
    paymentMode: string,
    txMsg: string,
    txTime: string,
    signature: string
  ): boolean {
    return cashfreeGateway.verifyPaymentSignature(
      orderId,
      orderAmount,
      referenceId,
      txStatus,
      paymentMode,
      txMsg,
      txTime,
      signature
    );
  }

  /**
   * Check payment status
   */
  async getPaymentStatus(orderId: string): Promise<any> {
    return cashfreeGateway.getPaymentStatus(orderId);
  }

  /**
   * Process refund
   */
  async processRefund(orderId: string, amount: number): Promise<any> {
    return cashfreeGateway.processRefund(orderId, amount);
  }
}

// Utility functions
export const generateReceiptId = (prefix: string = 'receipt'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const isValidAmount = (amount: number): boolean => {
  return amount >= 1 && amount <= 1000000; // Min ₹1, Max ₹10,00,000
};

export const formatAmount = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount);
};

// Create singleton instance
export const paymentGateway = new PaymentGateway();
export default paymentGateway;
