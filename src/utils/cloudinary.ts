import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath: string, retries = 3) => {
  try {
    console.log(`${process.env.CLOUDINARY_API_KEY}`);

    if (!localFilePath) return null;

    // Add timeout and retry configuration for Cloudinary uploads
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: 'auto',
      timeout: 120000, // 2 minutes timeout for large files
      chunk_size: 6000000, // 6MB chunks for better performance
    });
    console.log('File uploaded on cloudinary. File src: ' + response.url);
    //once the file is uploaded we would like to delete if from our server
    fs.unlinkSync(localFilePath);
    return response;
  } catch (error) {
    console.log('Error on Cloudinary', error);

    // Retry logic for network errors or timeouts
    if (
      retries > 0 &&
      ((error as any).code === 'ECONNABORTED' || (error as any).message?.includes('timeout'))
    ) {
      console.log(`Retrying upload, ${retries} attempts left...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
      return uploadOnCloudinary(localFilePath, retries - 1);
    }

    // Only delete file if it exists and we're not retrying
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    return null;
  }
};

const deleteFromCloudinary = async (publicId: string) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('Deleted from cloudinary. Public id: ', publicId);
  } catch (error) {
    console.log('Error deleting from cloudinary', error);
    return null;
  }
};

export { uploadOnCloudinary, deleteFromCloudinary };
