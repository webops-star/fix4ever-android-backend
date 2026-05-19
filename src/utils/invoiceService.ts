import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME!;

interface InvoiceData {
  invoiceNumber: string;
  issueDate: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress?: string;
  serviceDescription: string;
  deviceBrand: string;
  deviceModel: string;
  serviceType: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    tax: number;
    total: number;
  }>;
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  paymentMethod: string;
  serviceDate: string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  couponCode?: string;
  couponDiscount?: number;
  walletAmountUsed?: number;
  companyGstin?: string;
  gstBreakdown?: {
    baseAmount: number;
    gstAmount: number;
    gstRate: number;
  };
}

/**
 * FUTURE: Check if invoice PDF already exists in S3
 * @param invoiceNumber - Invoice number (e.g., INV-12345678)
 * @returns PDF buffer if exists, null otherwise
 */
export const checkInvoiceExistsInS3 = async (invoiceNumber: string): Promise<Buffer | null> => {
  try {
    // FUTURE IMPLEMENTATION: Uncomment when S3 integration is ready
    /*
    const s3Key = `invoices/${invoiceNumber}.pdf`;
    
    try {
      // Check if object exists
      const headCommand = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      });
      await s3Client.send(headCommand);

      // Object exists, fetch it
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      });
      
      const response = await s3Client.send(getCommand);
      const chunks: Uint8Array[] = [];
      
      if (response.Body) {
        for await (const chunk of response.Body as any) {
          chunks.push(chunk);
        }
      }
      
      return Buffer.concat(chunks);
    } catch (error: any) {
      if (error.name === 'NotFound' || error.code === 'NoSuchKey') {
        return null; // Invoice doesn't exist
      }
      throw error; // Re-throw other errors
    }
    */

    // Current implementation: Always return null (no S3 check)
    return null;
  } catch (error: any) {
    console.error('Error checking invoice in S3:', error);
    return null;
  }
};

/**
 * FUTURE: Upload invoice PDF to S3
 * @param pdfBuffer - PDF buffer to upload
 * @param invoiceNumber - Invoice number
 * @returns S3 key if successful, null otherwise
 */
export const uploadInvoiceToS3 = async (
  pdfBuffer: Buffer,
  invoiceNumber: string
): Promise<string | null> => {
  try {
    // FUTURE IMPLEMENTATION: Uncomment when S3 upload is ready
    /*
    const s3Key = `invoices/${invoiceNumber}.pdf`;
    
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    });
    
    await s3Client.send(command);
    console.log(`Invoice uploaded to S3: ${s3Key}`);
    return s3Key;
    */

    // Current implementation: Log and return null
    console.log(`[FUTURE] Would upload invoice to S3: invoices/${invoiceNumber}.pdf`);
    return null;
  } catch (error: any) {
    console.error('Error uploading invoice to S3:', error);
    return null;
  }
};

/**
 * Escape HTML to prevent XSS
 */
const escapeHtml = (text: string | undefined | null): string => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Generate professional HTML invoice template
 */
export const generateInvoiceHTML = (data: InvoiceData): string => {
  // Company data is trusted, but we'll escape it for safety
  const companyName = data.companyName || 'Fix4Ever';
  const companyAddress = data.companyAddress || 'Nirmaan, IIT Madras, Chennai, TN, India';
  const companyPhone = data.companyPhone || '+91 8092902191';
  const companyEmail = data.companyEmail || 'support@fix4ever.com';
  const logoUrl =
    'https://res.cloudinary.com/dd8zhmj7u/image/upload/v1753045534/b5mizwfzxhlhegwigbe6.jpg';

  // Escape user-provided data
  const customerName = escapeHtml(data.customerName);
  const customerEmail = escapeHtml(data.customerEmail);
  const customerPhone = escapeHtml(data.customerPhone);
  const customerAddress = data.customerAddress ? escapeHtml(data.customerAddress) : '';

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Invoice ${data.invoiceNumber}</title>
  
    <!-- Tailwind CDN with timeout fallback -->
    <script src="https://cdn.tailwindcss.com" onerror="console.warn('Tailwind CDN failed to load')"></script>
  
    <style>
      body { 
        -webkit-print-color-adjust: exact;
        font-family: system-ui, -apple-system, sans-serif;
        margin: 0;
        padding: 0;
      }
      /* Fallback styles in case Tailwind doesn't load */
      .fallback-container {
        max-width: 800px;
        margin: 0 auto;
        padding: 32px;
        background: #f1f5f9;
      }
      .fallback-card {
        background: white;
        border-radius: 16px;
        padding: 32px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }
    </style>
  </head>
  
  <body class="bg-slate-100 p-8 font-sans">
    <div class="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl p-8">
  
      <!-- Header -->
      <div class="flex justify-between items-start mb-8">
        <div class="flex gap-4">
          <img src="${logoUrl}" class="w-14 h-14 rounded-full" />
          <div class="text-sm text-gray-700">
            <div class="text-2xl font-bold text-blue-600">${escapeHtml(companyName)}</div>
            <div>${escapeHtml(companyAddress)}</div>
            <div>Phone: ${escapeHtml(companyPhone)}</div>
            <div>Email: ${escapeHtml(companyEmail)}</div>
            ${data.companyGstin ? `<div class="mt-1 font-semibold">GSTIN: ${escapeHtml(data.companyGstin)}</div>` : ''}
          </div>
        </div>
  
        <div class="text-right">
          <div class="text-3xl font-bold text-blue-600">INVOICE</div>
          <div class="text-sm mt-1">Invoice #: ${escapeHtml(data.invoiceNumber)}</div>
          <div class="text-sm">Date: ${escapeHtml(data.issueDate)}</div>
        </div>
      </div>

      <div class="w-full h-px bg-gray-300 my-6"></div>

  
      <!-- Info Cards -->
      <div class="grid grid-cols-2 gap-6 mb-8">
        <div class="rounded-xl p-5 shadow-xl bg-white">
          <div class="text-sm font-semibold text-blue-600 mb-3">BILL TO</div>
          <div class="text-sm font-medium">${customerName}</div>
          <div class="text-sm">${customerEmail}</div>
          <div class="text-sm">${customerPhone}</div>
          ${customerAddress ? `<div class="text-sm mt-1">${customerAddress}</div>` : ''}
        </div>
  
        <div class="rounded-xl p-5 shadow-xl bg-white">
          <div class="text-sm font-semibold text-blue-600 mb-3">SERVICE DETAILS</div>
          <div class="text-sm">Device: ${escapeHtml(data.deviceBrand)} ${escapeHtml(data.deviceModel)}</div>
          <div class="text-sm">Service Type: ${escapeHtml(data.serviceType)}</div>
          <div class="text-sm">Service Date: ${escapeHtml(data.serviceDate)}</div>
          <div class="text-sm">Payment: ${escapeHtml(data.paymentMethod)}</div>
        </div>
      </div>

      <div class="w-full h-px bg-gray-300 my-6"></div>

  
      <!-- Cost Breakdown -->
      <div class="text-center font-bold text-blue-600 mb-3">
        COST BREAKDOWN
      </div>
  
      <table class="w-full border border-blue-800 border-collapse rounded-xl overflow-hidden">
  <thead class="bg-blue-700 text-white text-sm">
    <tr>
      <th class="px-4 py-3 text-left border border-blue-700">
        Description
      </th>
      <th class="px-4 py-3 text-right border border-blue-700">
        Unit Price
      </th>
      <th class="px-4 py-3 text-right border border-blue-700">
        Tax
      </th>
      <th class="px-4 py-3 text-right border border-blue-700">
        Total
      </th>
    </tr>
  </thead>

  <tbody class="text-sm">
    ${data.items
      .map(
        (item, index) => `
      <tr class="${index % 2 === 0 ? 'bg-blue-50' : 'bg-white'}">
        <td class="px-4 py-3 border border-blue-200">
          ${escapeHtml(item.description)}
        </td>
        <td class="px-4 py-3 text-right border border-blue-200">
          ₹${item.unitPrice.toFixed(2)}
        </td>
        <td class="px-4 py-3 text-right border border-blue-200">
          ₹${item.tax.toFixed(2)}
        </td>
        <td class="px-4 py-3 text-right border border-blue-200">
          ₹${item.total.toFixed(2)}
        </td>
      </tr>
    `
      )
      .join('')}
  </tbody>
</table>

  
      <!-- Totals -->
      <div class="w-96 ml-auto mt-6">
        <div class="flex justify-between text-sm py-1">
          <span class="text-gray-600">Taxable Amount</span>
          <span>₹${data.subtotal.toFixed(2)}</span>
        </div>

        <!-- GST Breakdown -->
        ${
          data.gstBreakdown && data.gstBreakdown.gstAmount > 0
            ? (() => {
                const rate = data.gstBreakdown!.gstRate || 18;
                const halfRate = rate / 2;
                const halfGst = data.gstBreakdown!.gstAmount / 2;
                return `
        <div class="border border-gray-200 rounded-lg my-2 overflow-hidden">
          <div class="bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">GST Breakdown (${rate}%)</div>
          <div class="flex justify-between text-sm px-3 py-1.5 border-b border-gray-100">
            <span class="text-gray-600">CGST @ ${halfRate}%</span>
            <span>₹${halfGst.toFixed(2)}</span>
          </div>
          <div class="flex justify-between text-sm px-3 py-1.5 border-b border-gray-100">
            <span class="text-gray-600">SGST @ ${halfRate}%</span>
            <span>₹${halfGst.toFixed(2)}</span>
          </div>
          <div class="flex justify-between text-sm px-3 py-1.5 font-medium">
            <span>Total GST</span>
            <span>₹${data.gstBreakdown!.gstAmount.toFixed(2)}</span>
          </div>
        </div>`;
              })()
            : `
        <div class="flex justify-between text-sm py-1">
          <span class="text-gray-600">GST (18%)</span>
          <span>₹${data.totalTax.toFixed(2)}</span>
        </div>`
        }

        ${
          data.couponDiscount && data.couponDiscount > 0
            ? `
        <div class="flex justify-between text-sm py-1" style="color:#16a34a">
          <span>Coupon Discount${data.couponCode ? ` (${escapeHtml(data.couponCode)})` : ''}</span>
          <span>-₹${data.couponDiscount.toFixed(2)}</span>
        </div>`
            : ''
        }
        ${
          data.walletAmountUsed && data.walletAmountUsed > 0
            ? `
        <div class="flex justify-between text-sm py-1" style="color:#0d9488">
          <span>Wallet Credit Applied</span>
          <span>-₹${data.walletAmountUsed.toFixed(2)}</span>
        </div>`
            : ''
        }
        <div class="flex justify-between text-xl font-bold text-blue-600 border-t-2 border-blue-600 mt-2 pt-3">
          <span>Grand Total</span>
          <span>₹${data.grandTotal.toFixed(2)}</span>
        </div>
        <div class="text-right text-xs text-gray-400 mt-1">All amounts in Indian Rupees (INR) · GST registered</div>
      </div>
  
      <!-- Footer -->
      <div class="text-center mt-10 text-sm text-gray-600">
        <div class="font-semibold text-blue-600 mb-1">Thank you for your business!</div>
        <div>For queries contact ${escapeHtml(companyEmail)}</div>
        <div class="italic mt-1">${escapeHtml(companyName)} – Authorized Service Provider</div>
      </div>
  
    </div>
  </body>
  </html>
  `;
};

/**
 * Generate PDF from HTML using Puppeteer
 */
export const generatePDFFromHTML = async (html: string): Promise<Buffer> => {
  let browser;
  try {
    // Production-ready Puppeteer configuration
    const launchOptions: any = {
      headless: 'new' as any,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Overcome limited resource problems
        '--disable-accelerated-2d-canvas',
        '--disable-gpu', // Disable GPU hardware acceleration
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      timeout: 30000, // 30 second timeout for browser launch
    };

    // Use system Chromium in production (Docker/Alpine)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1200, height: 1600 });

    // Set content with timeout and fallback strategy
    try {
      // Try with networkidle0 first (waits for network to be idle)
      await Promise.race([
        page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 15000)),
      ]);
    } catch (networkError) {
      // Fallback: Use domcontentloaded if networkidle0 times out
      console.warn('Network idle timeout, using domcontentloaded fallback');
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
      // Wait a bit for any remaining resources
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
      timeout: 30000, // 30 second timeout for PDF generation
    });

    return Buffer.from(pdfBuffer);
  } catch (error: any) {
    console.error('Error generating PDF:', error);
    console.error('Error stack:', error.stack);

    // Provide more specific error messages
    if (error.message?.includes('timeout')) {
      throw new Error(`PDF generation timeout: ${error.message}`);
    } else if (error.message?.includes('browser') || error.message?.includes('launch')) {
      throw new Error(
        `Failed to launch browser. This may be due to missing dependencies in production. Error: ${error.message}`
      );
    } else {
      throw new Error(`Failed to generate PDF: ${error.message}`);
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }
  }
};
