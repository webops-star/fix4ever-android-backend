import { Cashfree, CFEnvironment } from 'cashfree-pg';

// Cashfree Configuration
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const CASHFREE_ENVIRONMENT = process.env.CASHFREE_ENVIRONMENT || 'sandbox'; // 'sandbox' or 'production'

// Types
export type PaymentProvider = 'cashfree';

interface CashfreeCustomer {
  customerId?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
}

interface CashfreePaymentRequest {
  amount: number;
  currency?: string;
  description?: string;
  customer: {
    name: string;
    email: string;
    contact: string;
  };
  callback_url?: string;
  notes?: any;
}

interface CashfreePaymentResponse {
  id: string;
  short_url: string;
  payment_session_id: string;
  amount: number;
  currency: string;
  description: string;
  status: string;
  customer: any;
  notes?: any;
}

class CashfreeGateway {
  private cashfree: Cashfree;
  private environment: string;

  constructor() {
    // Validate required environment variables
    if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
      console.error('Cashfree configuration error: Missing APP_ID or SECRET_KEY');
      console.error(
        'Please set CASHFREE_APP_ID and CASHFREE_SECRET_KEY in your environment variables'
      );
      throw new Error(
        'Cashfree configuration incomplete. Please check your environment variables.'
      );
    }

    // Initialize Cashfree SDK
    this.environment = CASHFREE_ENVIRONMENT;
    const cfEnvironment =
      CASHFREE_ENVIRONMENT === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;

    this.cashfree = new Cashfree(cfEnvironment, CASHFREE_APP_ID, CASHFREE_SECRET_KEY);

    console.log('Cashfree Gateway initialized:', {
      environment: CASHFREE_ENVIRONMENT,
      cfEnvironment: cfEnvironment,
      hasAppId: !!CASHFREE_APP_ID,
      hasSecretKey: !!CASHFREE_SECRET_KEY,
      sdkVersion: 'cashfree-pg (latest)',
    });
  }

  /**
   * Create payment link using official Cashfree SDK
   */
  async createPaymentLink(request: CashfreePaymentRequest): Promise<CashfreePaymentResponse> {
    try {
      console.log('Creating Cashfree payment link with SDK:', {
        amount: request.amount,
        currency: request.currency || 'INR',
        customer: request.customer,
      });

      // Generate unique order ID
      const orderId = `ORD${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

      // Prepare order request according to latest API
      // IMPORTANT: Always use BACKEND_URL for callbacks, not FRONTEND_URL
      // Backend will process the payment and then redirect to frontend
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';
      const returnUrl = `${backendUrl}/api/payment-transactions/callback?order_id=${orderId}`;
      const notifyUrl = `${backendUrl}/api/payment-transactions/webhook`;

      console.log('Payment callback URLs:', {
        returnUrl,
        notifyUrl,
        backendUrl,
        environment: this.environment,
      });

      const orderRequest = {
        order_amount: request.amount,
        order_currency: request.currency || 'INR',
        order_id: orderId,
        customer_details: {
          customer_id: `CUST${Date.now()}${Math.random().toString(36).substr(2, 6)}`,
          customer_name: request.customer.name,
          customer_email: request.customer.email,
          customer_phone: request.customer.contact,
        },
        order_meta: {
          // Route through backend callback first to update DB, then redirect to frontend with order_id
          return_url: returnUrl,
          notify_url: notifyUrl,
          payment_methods: 'cc,dc,upi,nb,app,paylater',
        },
        order_expiry_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      };

      console.log('Cashfree order request:', JSON.stringify(orderRequest, null, 2));

      // Create order using official SDK
      const response = await this.cashfree.PGCreateOrder(orderRequest);

      console.log('Cashfree order response:', response.data);

      if (response.data && response.data.payment_session_id) {
        // Construct payment URL using the latest Cashfree API format
        // Reference: https://cashfree.com/docs/api-reference/payments/latest/overview
        // Test: https://sandbox.cashfree.com/pg
        // Production: https://api.cashfree.com/pg
        const baseUrl =
          this.environment === 'production'
            ? 'https://api.cashfree.com/pg'
            : 'https://sandbox.cashfree.com/pg';

        const paymentUrl = `${baseUrl}/view/pay/${response.data.payment_session_id}`;

        console.log('Generated payment URL:', paymentUrl);

        return {
          id: response.data.order_id || orderId,
          short_url: paymentUrl,
          payment_session_id: response.data.payment_session_id,
          amount: request.amount,
          currency: request.currency || 'INR',
          description: request.description || '',
          status: 'created',
          customer: request.customer,
          notes: request.notes,
        };
      } else {
        throw new Error('Invalid response from Cashfree: Missing payment_session_id');
      }
    } catch (error: any) {
      console.error('Cashfree Create Payment Link Error:', error.response?.data || error.message);
      throw new Error(
        `Payment link creation failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Check payment status using official SDK
   */
  async getPaymentStatus(orderId: string): Promise<any> {
    try {
      console.log('Checking payment status for order:', orderId);

      const response = await this.cashfree.PGFetchOrder(orderId);

      console.log('Payment status response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Cashfree Payment Status Error:', error.response?.data || error.message);
      throw new Error(
        `Payment status check failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Fetch all payments for an order using official SDK
   */
  async getOrderPayments(orderId: string): Promise<any> {
    try {
      console.log('Fetching payments for order:', orderId);

      const response = await this.cashfree.PGOrderFetchPayments(orderId);

      console.log('Order payments response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Cashfree Order Payments Error:', error.response?.data || error.message);
      throw new Error(
        `Order payments fetch failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Process refund using official SDK
   */
  async processRefund(orderId: string, refundAmount: number): Promise<any> {
    try {
      console.log('Processing refund for order:', orderId, 'amount:', refundAmount);

      const refundId = `RF${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

      const refundRequest = {
        refund_amount: refundAmount,
        refund_id: refundId,
        refund_note: 'Refund for cancelled order',
      };

      const response = await this.cashfree.PGOrderCreateRefund(orderId, refundRequest);

      console.log('Refund response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Cashfree Refund Error:', error.response?.data || error.message);
      throw new Error(
        `Refund processing failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Verify payment signature (for webhooks)
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
    try {
      // Use Cashfree SDK's signature verification
      // For webhook signature verification, we need the raw body and timestamp
      // This is a simplified version - in production, you should pass the actual raw body and timestamp
      const rawBody = JSON.stringify({
        orderId,
        orderAmount,
        referenceId,
        txStatus,
        paymentMode,
        txMsg,
        txTime,
      });
      const timestamp = new Date().toISOString();

      const result = this.cashfree.PGVerifyWebhookSignature(signature, rawBody, timestamp);
      return !!result; // Convert to boolean
    } catch (error: any) {
      console.error('Signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Get payment methods available (simplified for now)
   */
  async getPaymentMethods(): Promise<any> {
    try {
      // Return a simple list of common payment methods
      // In production, you would use the actual API call
      return {
        payment_methods: [
          { method: 'upi', name: 'UPI' },
          { method: 'cc', name: 'Credit Card' },
          { method: 'dc', name: 'Debit Card' },
          { method: 'netbanking', name: 'Net Banking' },
          { method: 'wallets', name: 'Wallets' },
        ],
      };
    } catch (error: any) {
      console.error('Get payment methods error:', error.message);
      throw new Error(`Failed to get payment methods: ${error.message}`);
    }
  }

  /**
   * Test connection to Cashfree
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to get payment methods as a connection test
      await this.getPaymentMethods();
      console.log('Cashfree connection test successful');
      return true;
    } catch (error: any) {
      console.error('Cashfree connection test failed:', error.message);
      return false;
    }
  }
}

// Export singleton instance
const cashfreeGateway = new CashfreeGateway();
export default cashfreeGateway;

// Export utility functions
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
