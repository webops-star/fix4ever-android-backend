import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME!;
const CLOUDFRONT_URL = process.env.AWS_CLOUDFRONT_URL;

const getContentType = (filename: string): string => {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes: { [key: string]: string } = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
  };
  return contentTypes[ext] || 'application/octet-stream';
};

export const uploadServiceRequestImage = async (
  localFilePath: string,
  userEmailOrId: string,
  retries: number = 3
): Promise<{ url: string; key: string } | null> => {
  try {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      console.error('File does not exist:', localFilePath);
      return null;
    }

    if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS S3 configuration is incomplete');
      return null;
    }

    const fileContent = fs.readFileSync(localFilePath);
    const originalName = path.basename(localFilePath);
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(6).toString('hex');
    const extension = path.extname(originalName);
    const sanitizedUser = userEmailOrId.replace(/[^a-zA-Z0-9_@.-]/g, '_').toLowerCase();

    const s3Key = `service-request/${sanitizedUser}/images/${timestamp}_${randomString}${extension}`;
    const contentType = getContentType(originalName);

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    console.log('Service request image uploaded:', fileUrl);
    fs.unlinkSync(localFilePath);

    return { url: fileUrl, key: s3Key };
  } catch (error: any) {
    console.error('Error uploading service request image:', error);
    if (retries > 0 && (error.code === 'NetworkingError' || error.message?.includes('timeout'))) {
      console.log(`Retrying upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return uploadServiceRequestImage(localFilePath, userEmailOrId, retries - 1);
    }
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    return null;
  }
};

export const uploadChatImage = async (
  localFilePath: string,
  serviceRequestId: string,
  retries: number = 3
): Promise<{ url: string; key: string } | null> => {
  try {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      console.error('File does not exist:', localFilePath);
      return null;
    }

    if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS S3 configuration is incomplete');
      return null;
    }

    const fileContent = fs.readFileSync(localFilePath);
    const originalName = path.basename(localFilePath);
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(6).toString('hex');
    const extension = path.extname(originalName);

    const s3Key = `service-request/${serviceRequestId}/chat/${timestamp}_${randomString}${extension}`;
    const contentType = getContentType(originalName);

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    console.log('Chat image uploaded:', fileUrl);
    fs.unlinkSync(localFilePath);

    return { url: fileUrl, key: s3Key };
  } catch (error: any) {
    console.error('Error uploading chat image:', error);
    if (retries > 0 && (error.code === 'NetworkingError' || error.message?.includes('timeout'))) {
      console.log(`Retrying upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return uploadChatImage(localFilePath, serviceRequestId, retries - 1);
    }
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    return null;
  }
};

export const uploadVendorOnboardingDocument = async (
  localFilePath: string,
  email: string,
  documentType: string,
  retries: number = 3
): Promise<{ url: string; key: string } | null> => {
  try {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      console.error('File does not exist:', localFilePath);
      return null;
    }

    if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS S3 configuration is incomplete');
      return null;
    }

    const fileContent = fs.readFileSync(localFilePath);
    const originalName = path.basename(localFilePath);
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(6).toString('hex');
    const extension = path.extname(originalName);
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9_@.-]/g, '_').toLowerCase();
    const sanitizedDocType = documentType.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    const s3Key = `vendor/onboarding/${sanitizedEmail}/${sanitizedDocType}_${timestamp}_${randomString}${extension}`;
    const contentType = getContentType(originalName);

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    console.log('Vendor document uploaded:', fileUrl);
    fs.unlinkSync(localFilePath);

    return { url: fileUrl, key: s3Key };
  } catch (error: any) {
    console.error('Error uploading vendor document:', error);
    if (retries > 0 && (error.code === 'NetworkingError' || error.message?.includes('timeout'))) {
      console.log(`Retrying upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return uploadVendorOnboardingDocument(localFilePath, email, documentType, retries - 1);
    }
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    return null;
  }
};

export const uploadCaptainOnboardingDocument = async (
  localFilePath: string,
  email: string,
  documentType: string,
  retries: number = 3
): Promise<{ url: string; key: string } | null> => {
  try {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      console.error('File does not exist:', localFilePath);
      return null;
    }

    if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS S3 configuration is incomplete');
      return null;
    }

    const fileContent = fs.readFileSync(localFilePath);
    const originalName = path.basename(localFilePath);
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(6).toString('hex');
    const extension = path.extname(originalName);
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9_@.-]/g, '_').toLowerCase();
    const sanitizedDocType = documentType.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    const s3Key = `captain/onboarding/${sanitizedEmail}/${sanitizedDocType}_${timestamp}_${randomString}${extension}`;
    const contentType = getContentType(originalName);

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    console.log('Captain document uploaded:', fileUrl);
    fs.unlinkSync(localFilePath);

    return { url: fileUrl, key: s3Key };
  } catch (error: any) {
    console.error('Error uploading captain document:', error);
    if (retries > 0 && (error.code === 'NetworkingError' || error.message?.includes('timeout'))) {
      console.log(`Retrying upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return uploadCaptainOnboardingDocument(localFilePath, email, documentType, retries - 1);
    }
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    return null;
  }
};

export const deleteFromS3 = async (s3Key: string): Promise<boolean> => {
  try {
    if (!s3Key) {
      console.error('S3 key is required for deletion');
      return false;
    }

    const deleteParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
    };

    await s3Client.send(new DeleteObjectCommand(deleteParams));
    console.log('Deleted from S3:', s3Key);
    return true;
  } catch (error) {
    console.error('Error deleting from S3:', error);
    return false;
  }
};

/**
 * Upload device handover verification images with metadata
 * @param localFilePath - Path to the local file
 * @param serviceRequestId - Service request ID
 * @param checkpoint - Checkpoint type (customerPickup, deliveryToTechnician, etc.)
 * @param uploadedByRole - Role of the person uploading (captain or technician)
 * @param uploadedById - ID of the person uploading
 * @param location - GPS location { latitude, longitude }
 * @param retries - Number of retry attempts
 * @returns S3 upload response with URL and key
 */
export const uploadHandoverImage = async (
  localFilePath: string,
  serviceRequestId: string,
  checkpoint: string,
  uploadedByRole: 'captain' | 'technician',
  uploadedById: string,
  location?: { latitude: number; longitude: number },
  retries: number = 3
): Promise<{ url: string; key: string; metadata: any } | null> => {
  try {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      console.error('File does not exist:', localFilePath);
      return null;
    }

    if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS S3 configuration is incomplete');
      return null;
    }

    const fileContent = fs.readFileSync(localFilePath);
    const originalName = path.basename(localFilePath);
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(6).toString('hex');
    const extension = path.extname(originalName);

    // S3 key structure: handover-verification/{serviceRequestId}/{checkpoint}/{timestamp}_{random}.{ext}
    const s3Key = `handover-verification/${serviceRequestId}/${checkpoint}/${timestamp}_${randomString}${extension}`;
    const contentType = getContentType(originalName);

    // Create metadata object
    const metadata: any = {
      timestamp: new Date().toISOString(),
      uploadedByRole: uploadedByRole,
      uploadedById: uploadedById,
      checkpoint: checkpoint,
      serviceRequestId: serviceRequestId,
    };

    if (location) {
      metadata.latitude = location.latitude.toString();
      metadata.longitude = location.longitude.toString();
    }

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
      Metadata: metadata,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    console.log('Handover image uploaded:', fileUrl);
    fs.unlinkSync(localFilePath);

    return {
      url: fileUrl,
      key: s3Key,
      metadata: {
        ...metadata,
        location: location || null,
      },
    };
  } catch (error: any) {
    console.error('Error uploading handover image:', error);
    if (retries > 0 && (error.code === 'NetworkingError' || error.message?.includes('timeout'))) {
      console.log(`Retrying upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return uploadHandoverImage(
        localFilePath,
        serviceRequestId,
        checkpoint,
        uploadedByRole,
        uploadedById,
        location,
        retries - 1
      );
    }
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    return null;
  }
};

export const extractS3KeyFromUrl = (url: string): string | null => {
  try {
    if (!url) return null;

    if (CLOUDFRONT_URL && url.startsWith(CLOUDFRONT_URL)) {
      return url.replace(`${CLOUDFRONT_URL}/`, '');
    }

    // Match any S3 URL regardless of bucket name (handles legacy buckets too)
    const s3UrlPattern = /https:\/\/[^.]+\.s3(?:\.[^.]+)?\.amazonaws\.com\/(.+)/;
    const match = url.match(s3UrlPattern);

    if (match && match[1]) {
      return match[1];
    }

    console.warn('Unable to extract S3 key from URL:', url);
    return null;
  } catch (error) {
    console.error('Error extracting S3 key from URL:', error);
    return null;
  }
};

export const getPresignedUrl = async (
  s3Key: string,
  expiresIn: number = 3600
): Promise<string | null> => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return presignedUrl;
  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    return null;
  }
};

/**
 * Generate a presigned URL for PUT operation (upload from frontend)
 * @param s3Key - S3 object key
 * @param contentType - Content type of the file
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns Presigned URL for PUT operation
 */
export const getPresignedUploadUrl = async (
  s3Key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string | null> => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return presignedUrl;
  } catch (error) {
    console.error('Error generating presigned upload URL:', error);
    return null;
  }
};

/**
 * Upload a test video to S3 directly from buffer (no local file storage)
 * @param fileBuffer - File buffer from multer
 * @param fileName - Original filename
 * @param email - User email for organizing files
 * @param questionId - Question ID from the filename
 * @param retries - Number of retry attempts
 * @returns S3 upload response with URL and key
 */
export const uploadTestVideo = async (
  fileBuffer: Buffer,
  fileName: string,
  email: string,
  questionId: number,
  retries: number = 3
): Promise<{ url: string; key: string } | null> => {
  try {
    if (!fileBuffer || fileBuffer.length === 0) {
      console.error('Test video buffer is empty');
      return null;
    }

    if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS S3 configuration is incomplete');
      return null;
    }

    const timestamp = Date.now();
    const randomString = crypto.randomBytes(6).toString('hex');
    const extension = path.extname(fileName);
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9_@.-]/g, '_').toLowerCase();

    // S3 key format: test-submissions/{email}/q{questionId}_{timestamp}_{random}.{ext}
    const s3Key = `test-submissions/${sanitizedEmail}/q${questionId}_${timestamp}_${randomString}${extension}`;
    const contentType = getContentType(fileName);

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    console.log('Test video uploaded to S3:', fileUrl);

    return { url: fileUrl, key: s3Key };
  } catch (error: any) {
    console.error('Error uploading test video to S3:', error);
    if (retries > 0 && (error.code === 'NetworkingError' || error.message?.includes('timeout'))) {
      console.log(`Retrying test video upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return uploadTestVideo(fileBuffer, fileName, email, questionId, retries - 1);
    }
    return null;
  }
};
