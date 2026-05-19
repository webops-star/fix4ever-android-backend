import mongoose from 'mongoose';
import mailSender from '../utils/mailSender';

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
  },
  otp: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 5, //OTP expires in 5 minutes
  },
});

async function sendVerificationEmail(email: string, otp: string) {
  try {
    const mailResponse = await mailSender(
      email,
      'Verification Email',
      `<h1>Please confirm your OTP</h1>
         <p>Here is your OTP code: ${otp}</p>`
    );
    console.log('Email sent successfully: ', mailResponse);
  } catch (error) {
    console.log('Error occurred while sending email: ', error);
    throw error;
  }
}

otpSchema.pre('save', async function (next) {
  console.log('New document saved to Database.');
  if (this.isNew) {
    // Only send email if the email field contains an actual email address (not a phone number)
    // Phone numbers start with + or contain only digits
    const isPhoneNumber = this.email.startsWith('+') || /^\d+$/.test(this.email);

    if (!isPhoneNumber) {
      await sendVerificationEmail(this.email, this.otp);
    } else {
      console.log('Skipping email for phone number OTP');
    }
  }
});
export const OTP = mongoose.model('Otp', otpSchema);
