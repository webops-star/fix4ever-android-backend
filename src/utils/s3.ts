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

// Initialize S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME!;
const CLOUDFRONT_URL = process.env.AWS_CLOUDFRONT_URL; // Optional CloudFront distribution URL

/**
 * Generate a unique S3 key for the file with proper folder structure
 * @param originalName - Original filename
 * @param folder - Base folder path (e.g., 'vendor/onboarding', 'captain/onboarding')
 * @param username - Username for organizing files
 * @param documentType - Type of document (e.g., 'aadhaar_card', 'pan_card', 'driving_license')
 * @returns Unique S3 key
 *
 * Examples:
 * - vendor/onboarding/john_doe/aadhaar_card_1234567890.pdf
 * - captain/onboarding/jane_smith/driving_license_1234567890.jpg
 */
const generateS3Key = (
  originalName: string,
  folder: string = 'uploads',
  username?: string,
  documentType?: string
): string => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(6).toString('hex');
  const extension = path.extname(originalName);

  const sanitizedUsername = username
    ? username.replace(/[^a-zA-Z0-9_@.-]/g, '_').toLowerCase()
    : 'user_' + timestamp;

  const docType = documentType
    ? documentType.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
    : 'document';

  return `${folder}/${sanitizedUsername}/${docType}_${timestamp}_${randomString}${extension}`;
};

/**
 * Get the content type based on file extension
 * @param filename - Filename with extension
 * @returns Content-Type string
 */
const getContentType = (filename: string): string => {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes: { [key: string]: string } = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.webp': 'image/webp',
  };

  return contentTypes[ext] || 'application/octet-stream';
};

/**
 * Upload a file to AWS S3 with organized folder structure
 * @param localFilePath - Path to the local file
 * @param folder - S3 folder path (e.g., 'vendor/onboarding', 'captain/onboarding')
 * @param username - Username for organizing files (creates subfolder)
 * @param documentType - Type of document for naming (e.g., 'aadhaar_card', 'pan_card')
 * @param retries - Number of retry attempts
 * @returns S3 upload response with URL and key
 */
export const uploadToS3 = async (
  localFilePath: string,
  folder: string = 'uploads',
  username?: string,
  documentType?: string,
  retries: number = 3
): Promise<{ url: string; key: string } | null> => {
  try {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      console.error('File does not exist:', localFilePath);
      return null;
    }

    if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS S3 configuration is incomplete. Please check environment variables.');
      return null;
    }

    const fileContent = fs.readFileSync(localFilePath);
    const originalName = path.basename(localFilePath);
    const s3Key = generateS3Key(originalName, folder, username, documentType);
    const contentType = getContentType(originalName);

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
    };

    // Upload to S3
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // Generate public URL
    const fileUrl = CLOUDFRONT_URL
      ? `${CLOUDFRONT_URL}/${s3Key}`
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`;

    console.log('File uploaded to S3. File URL:', fileUrl);

    // Delete local file after successful upload
    fs.unlinkSync(localFilePath);

    return {
      url: fileUrl,
      key: s3Key,
    };
  } catch (error: any) {
    console.error('Error uploading to S3:', error);

    // Retry logic for network errors or timeouts
    if (retries > 0 && (error.code === 'NetworkingError' || error.message?.includes('timeout'))) {
      console.log(`Retrying upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return uploadToS3(localFilePath, folder, username, documentType, retries - 1);
    }

    // Clean up local file if it exists and we're not retrying
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    return null;
  }
};

/**
 * Delete a file from AWS S3
 * @param s3Key - S3 object key (path) to delete
 * @returns true if successful, false otherwise
 */
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

    const command = new DeleteObjectCommand(deleteParams);
    await s3Client.send(command);

    console.log('Deleted from S3. Key:', s3Key);
    return true;
  } catch (error) {
    console.error('Error deleting from S3:', error);
    return false;
  }
};

export async function listObjects(folderName: string) {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Prefix: folderName, // Specify the folder name (prefix)
    };

    const data = await s3Client.send(new ListObjectsV2Command(params));

    console.log('Objects in folder:', data.Contents);
    return data.Contents; // Returns the list of objects
  } catch (error) {
    console.error('Error listing objects: ', error);
  }
}

/**
 * Extract S3 key from a full S3 URL
 * @param url - Full S3 or CloudFront URL
 * @returns S3 key (object path)
 */
export const extractS3KeyFromUrl = (url: string): string | null => {
  try {
    if (!url) return null;

    // Handle CloudFront URLs
    if (CLOUDFRONT_URL && url.startsWith(CLOUDFRONT_URL)) {
      return url.replace(`${CLOUDFRONT_URL}/`, '');
    }

    // Match any S3 URL regardless of bucket name (handles legacy buckets too)
    // Format: https://bucket-name.s3.region.amazonaws.com/key
    const s3UrlPattern = /https:\/\/[^.]+\.s3(?:\.[^.]+)?\.amazonaws\.com\/(.+)/;
    const match = url.match(s3UrlPattern);

    if (match && match[1]) {
      return match[1];
    }

    // If URL doesn't match expected patterns, return null
    console.warn('Unable to extract S3 key from URL:', url);
    return null;
  } catch (error) {
    console.error('Error extracting S3 key from URL:', error);
    return null;
  }
};

/**
 * Generate a pre-signed URL for temporary access to a private S3 object
 * @param s3Key - S3 object key
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns Pre-signed URL
 */
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
 * Upload multiple files to S3
 * @param files - Array of objects with filePath and documentType
 * @param folder - S3 folder path
 * @param username - Username for organizing files
 * @returns Array of upload results
 */
export const uploadMultipleToS3 = async (
  files: Array<{ filePath: string; documentType?: string }>,
  folder: string = 'uploads',
  username?: string
): Promise<Array<{ url: string; key: string } | null>> => {
  const uploadPromises = files.map(file =>
    uploadToS3(file.filePath, folder, username, file.documentType)
  );
  return Promise.all(uploadPromises);
};

// Backward compatibility with Cloudinary naming
export const uploadOnCloudinary = uploadToS3;
export const deleteFromCloudinary = async (urlOrKey: string): Promise<boolean> => {
  const s3Key = extractS3KeyFromUrl(urlOrKey) || urlOrKey;
  return deleteFromS3(s3Key);
};
