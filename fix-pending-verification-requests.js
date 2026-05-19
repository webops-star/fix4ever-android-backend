// Script to convert "Pending Verification" requests to "Pending" requests
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const serviceRequestSchema = new mongoose.Schema({}, { strict: false, collection: 'servicerequests' });
const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);

async function fixPendingVerificationRequests() {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log('Connected to MongoDB');

    // Find all "Pending Verification" requests
    const pendingVerificationRequests = await ServiceRequest.find({
      status: 'Pending Verification',
    });

    console.log(`\nFound ${pendingVerificationRequests.length} "Pending Verification" requests`);

    if (pendingVerificationRequests.length === 0) {
      console.log('No requests to fix!');
      await mongoose.disconnect();
      process.exit(0);
      return;
    }

    console.log('\nConverting to "Pending" status with 30-minute timer...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const request of pendingVerificationRequests) {
      try {
        // Update to Pending status with timer
        request.status = 'Pending';
        request.isTimerActive = true;
        request.timerStartedAt = new Date();
        request.timerExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

        await request.save();

        console.log(`✅ Fixed: ${request.brand} ${request.model} (ID: ${request._id})`);
        successCount++;
      } catch (error) {
        console.error(`❌ Error fixing request ${request._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`✅ Successfully converted: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`\nThese requests should now be visible in vendor's "Pending" tab!`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixPendingVerificationRequests();
