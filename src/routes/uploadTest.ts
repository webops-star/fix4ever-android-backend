import express from 'express';
import TestSubmission from '../models/testSubmission.model';
import User from '../models/user.model';
import { getPresignedUploadUrl } from '../utils/s3Upload';
import path from 'path';
import crypto from 'crypto';

const router = express.Router();

/**
 * GET /api/upload-test/presigned-url
 * Generate presigned URLs for direct S3 uploads from frontend
 * Query params: email, fileName, questionId
 */
router.get('/upload-test/presigned-url', async (req, res) => {
  try {
    const { email, fileName, questionId } = req.query;

    if (!email || !fileName || !questionId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: email, fileName, questionId',
      });
    }

    // Validate user exists
    const user = await User.findOne({ email: email as string });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const timestamp = Date.now();
    const randomString = crypto.randomBytes(6).toString('hex');
    const extension = path.extname(fileName as string);
    const sanitizedEmail = (email as string).replace(/[^a-zA-Z0-9_@.-]/g, '_').toLowerCase();

    // Generate S3 key
    const s3Key = `test-submissions/${sanitizedEmail}/q${questionId}_${timestamp}_${randomString}${extension}`;

    // Get content type
    const getContentType = (filename: string): string => {
      const ext = path.extname(filename).toLowerCase();
      const contentTypes: { [key: string]: string } = {
        '.webm': 'video/webm',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
      };
      return contentTypes[ext] || 'video/webm';
    };

    const contentType = getContentType(fileName as string);

    // Generate presigned URL
    const presignedUrl = await getPresignedUploadUrl(s3Key, contentType, 3600); // 1 hour expiry

    if (!presignedUrl) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate presigned URL',
      });
    }

    // Generate final URL after upload
    const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME!;
    const CLOUDFRONT_URL = process.env.AWS_CLOUDFRONT_URL;
    const finalUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    res.json({
      success: true,
      presignedUrl,
      s3Key,
      finalUrl,
      contentType,
    });
  } catch (err: any) {
    console.error('Presigned URL generation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate presigned URL',
      error: err.message,
    });
  }
});

/**
 * POST /api/upload-test/metadata
 * Save test submission metadata after video is uploaded to S3
 * Body: { email, name, video: { questionId, fileName, s3Url, s3Key, size, ServiceRequestID } }
 */
router.post('/upload-test/metadata', async (req, res) => {
  try {
    const { email, name, video, serviceId } = req.body;

    console.log(req.body);
    const serviceRequestId = serviceId;

    if (!email || !name || !video || !serviceId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required data: email, name, and video object serviceRequestId',
      });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const formattedVideo = {
      questionId: parseInt(video.questionId),
      fileName: video.fileName,
      s3Url: video.s3Url,
      s3Key: video.s3Key,
      size: video.size || 0,
      uploadedAt: new Date(),
      serviceRequestId: serviceRequestId,
    };

    // Upsert: replace the single video for this user's submission
    let submission = await TestSubmission.findOne({
      userId: user._id,
      serviceRequestId: serviceRequestId,
    });

    if (submission) {
      submission.video = formattedVideo;
      submission.submittedAt = new Date();
    } else {
      submission = new TestSubmission({
        userId: user._id,
        userName: name,
        userEmail: email,
        video: formattedVideo,
        submittedAt: new Date(),
        serviceRequestId: serviceRequestId,
      });
    }

    await submission.save();

    res.json({
      success: true,
      message: 'Successfully saved video metadata',
      data: {
        submissionId: submission._id,
        userId: user._id,
        userName: name,
        userEmail: email,
        serviceRequestId,
      },
    });
  } catch (err: any) {
    console.error('Save metadata error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to save metadata',
      error: err.message,
    });
  }
});

export default router;
