import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import dotenv from 'dotenv';
dotenv.config();

// Initialize AWS SES Client
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const mailSender = async (email: string, title: string, body: string) => {
  try {
    // Validate AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS credentials are not configured');
    }

    if (!process.env.AWS_SES_SENDER_EMAIL) {
      throw new Error('AWS SES sender email is not configured');
    }

    // Create SendEmail command
    const command = new SendEmailCommand({
      Source: process.env.AWS_SES_SENDER_EMAIL, // Must be verified in AWS SES
      Destination: {
        ToAddresses: [email],
      },
      Message: {
        Subject: {
          Data: title,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: body,
            Charset: 'UTF-8',
          },
        },
      },
    });

    // Send email via AWS SES
    const response = await sesClient.send(command);

    console.log('Email sent successfully via AWS SES:', response.MessageId);
    return {
      messageId: response.MessageId,
      success: true,
    };
  } catch (error: any) {
    console.error('Error sending email via AWS SES:', error.message);
    throw error; // Re-throw to handle in calling function
  }
};

/**
 * Send email with PDF attachment
 * @param email - Recipient email address
 * @param title - Email subject
 * @param body - Email HTML body
 * @param pdfBuffer - PDF file buffer
 * @param filename - PDF filename (e.g., 'invoice.pdf')
 */
export const mailSenderWithAttachment = async (
  email: string,
  title: string,
  body: string,
  pdfBuffer: Buffer,
  filename: string
) => {
  try {
    // Validate AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS credentials are not configured');
    }

    if (!process.env.AWS_SES_SENDER_EMAIL) {
      throw new Error('AWS SES sender email is not configured');
    }

    // Create multipart MIME message
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const senderEmail = process.env.AWS_SES_SENDER_EMAIL;

    // Encode PDF to base64
    const pdfBase64 = pdfBuffer.toString('base64');

    // Construct raw email message
    const rawMessage = [
      `From: ${senderEmail}`,
      `To: ${email}`,
      `Subject: ${title}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      body,
      ``,
      `--${boundary}`,
      `Content-Type: application/pdf`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${filename}"`,
      ``,
      pdfBase64,
      ``,
      `--${boundary}--`,
    ].join('\n');

    // Create SendRawEmail command
    const command = new SendRawEmailCommand({
      Source: senderEmail,
      Destinations: [email],
      RawMessage: {
        Data: Buffer.from(rawMessage),
      },
    });

    // Send email via AWS SES
    const response = await sesClient.send(command);

    console.log('Email with attachment sent successfully via AWS SES:', response.MessageId);
    return {
      messageId: response.MessageId,
      success: true,
    };
  } catch (error: any) {
    console.error('Error sending email with attachment via AWS SES:', error.message);
    throw error; // Re-throw to handle in calling function
  }
};

export default mailSender;
