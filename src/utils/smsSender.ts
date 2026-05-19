import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import dotenv from 'dotenv';
dotenv.config();

// Initialize AWS SNS Client
const snsClient = new SNSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/**
 * Send SMS via AWS SNS
 * @param phoneNumber - Phone number with country code (e.g., +919876543210)
 * @param message - Message to send
 * @returns Promise with message ID
 */
const smsSender = async (phoneNumber: string, message: string) => {
  try {
    // Validate AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS credentials are not configured');
    }

    // Ensure phone number starts with +
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    // Create Publish command for SMS
    const command = new PublishCommand({
      PhoneNumber: formattedPhone,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional', // Use 'Transactional' for OTPs, 'Promotional' for marketing
        },
      },
    });

    // Send SMS via AWS SNS
    const response = await snsClient.send(command);

    console.log('SMS sent successfully via AWS SNS:', response.MessageId);
    return {
      messageId: response.MessageId,
      success: true,
    };
  } catch (error: any) {
    console.error('Error sending SMS via AWS SNS:', error.message);
    throw error; // Re-throw to handle in calling function
  }
};

/**
 * Send OTP via SMS
 * @param phoneNumber - Phone number with country code
 * @param otp - OTP code to send
 * @returns Promise with message ID
 */
export const sendOTPViaSMS = async (phoneNumber: string, otp: string) => {
  const message = `Your Fix4Ever OTP is: ${otp}. This OTP is valid for 5 minutes. Do not share this OTP with anyone.`;
  return smsSender(phoneNumber, message);
};

export default smsSender;
