import { Request, Response } from 'express';
import { OTP } from '../models/otp.model';
import User from '../models/user.model';
import otpGenerator from 'otp-generator';
import { sendOTPViaSMS } from '../utils/smsSender';
import dotenv from 'dotenv';
dotenv.config();

export const sendOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    console.log('Sending OTP to email:', email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.',
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email.',
      });
    }

    let otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    let result = await OTP.findOne({ otp: otp });
    while (result) {
      otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
      result = await OTP.findOne({ otp: otp });
    }

    console.log('Generated OTP:', otp);

    // Delete any existing OTP for this email
    await OTP.deleteMany({ email });

    const otpPayload = { email, otp };
    const otpDoc = await OTP.create(otpPayload);

    console.log('OTP document created:', otpDoc);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully, please check your email.',
      data: { email }, // Don't send OTP in response for security
    });
  } catch (error: any) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong while sending OTP.',
      error: error.message,
    });
  }
};

export const sendOTPworkspace = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    console.log('Sending OTP to email:', email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.',
      });
    }

    // Check if user exists

    let otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    let result = await OTP.findOne({ otp: otp });
    while (result) {
      otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
      result = await OTP.findOne({ otp: otp });
    }

    console.log('Generated OTP:', otp);

    // Delete any existing OTP for this email
    await OTP.deleteMany({ email });

    const otpPayload = { email, otp };
    const otpDoc = await OTP.create(otpPayload);

    console.log('OTP document created:', otpDoc);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully, please check your email.',
      data: { email }, // Don't send OTP in response for security
    });
  } catch (error: any) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong while sending OTP.',
      error: error.message,
    });
  }
};

export const sendLoginOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    console.log('Sending login OTP to email:', email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.',
      });
    }

    // Check if user exists - for login, user MUST exist
    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found with this email. Please sign up first.',
      });
    }

    let otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    let result = await OTP.findOne({ otp: otp });
    while (result) {
      otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
      result = await OTP.findOne({ otp: otp });
    }

    console.log('Generated login OTP:', otp);

    // Delete any existing OTP for this email
    await OTP.deleteMany({ email });

    const otpPayload = { email, otp };
    const otpDoc = await OTP.create(otpPayload);

    console.log('Login OTP document created:', otpDoc);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your email.',
      data: { email },
    });
  } catch (error: any) {
    console.error('Error sending login OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong while sending OTP.',
      error: error.message,
    });
  }
};

export const sendOTPToPhone = async (req: Request, res: Response) => {
  try {
    const { countryCode, phone } = req.body;
    console.log('Sending OTP to phone:', countryCode, phone);

    if (!countryCode || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number are required.',
      });
    }

    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(500).json({
        success: false,
        message: 'SMS service is not configured.',
      });
    }

    // Generate OTP
    let otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    // Ensure OTP is unique
    let result = await OTP.findOne({ otp: otp });
    while (result) {
      otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
      result = await OTP.findOne({ otp: otp });
    }

    console.log('Generated OTP for phone:', otp);

    const fullPhone = `${countryCode}${phone}`;

    // Delete any existing OTP for this phone
    await OTP.deleteMany({ email: fullPhone });

    // Store OTP in database (using email field for phone)
    const otpPayload = { email: fullPhone, otp };
    await OTP.create(otpPayload);

    // Send OTP via AWS SNS
    await sendOTPViaSMS(fullPhone, otp);

    console.log('OTP sent to phone via AWS SNS');

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your phone.',
      data: { phone: `+${fullPhone}` },
    });
  } catch (error: any) {
    console.error('Error sending phone OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong while sending OTP to phone.',
      error: error.message,
    });
  }
};
