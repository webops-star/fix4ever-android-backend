import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
export async function connect() {
  try {
    if (!process.env.MONGODB_URL) {
      console.error('❌ MONGODB_URL is not defined in environment variables.');
      throw new Error('MONGODB_URL is not defined in environment variables.');
    }

    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URL!, {
      // Connection Pool Settings (optimized for production)
      maxPoolSize: 15, // Increased from 10 for better concurrency
      minPoolSize: 5, // Maintain minimum connections for faster responses
      maxIdleTimeMS: 30000, // Close idle connections after 30 seconds

      // Timeout Settings
      serverSelectionTimeoutMS: 10000, // Server selection timeout
      socketTimeoutMS: 60000, // Socket timeout for long operations
      connectTimeoutMS: 10000, // Connection timeout

      // Performance & Reliability
      bufferCommands: false, // Disable buffering for immediate errors
      retryWrites: true, // Automatically retry write operations
      retryReads: true, // Automatically retry read operations

      // Write Concern (ensures data is written to majority of nodes)
      w: 'majority',

      // Compression (reduces network traffic)
      compressors: ['snappy', 'zlib'],
    });

    const connection = mongoose.connection;
    connection.on('connected', () => {
      console.log('✅ MongoDB successfully connected');
    });
    connection.on('error', err => {
      console.error('❌ MongoDB connection error:', err);
      process.exit(1);
    });
    connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
    });
  } catch (error) {
    console.error('❌ Something went wrong while connecting to database:');
    console.error(error);
  }
}
