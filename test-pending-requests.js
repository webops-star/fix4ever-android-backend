// Quick script to check pending requests in database
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const serviceRequestSchema = new mongoose.Schema({}, { strict: false, collection: 'servicerequests' });
const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);

async function checkPendingRequests() {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log('Connected to MongoDB');

    const currentTime = new Date();
    console.log('Current time:', currentTime.toISOString());

    // Check all requests
    const allRequests = await ServiceRequest.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .select('status isTimerActive timerExpiresAt createdAt brand model knowsProblem');

    console.log('\n=== LAST 5 REQUESTS ===');
    allRequests.forEach((req, i) => {
      console.log(`\n${i + 1}. Request ID: ${req._id}`);
      console.log(`   Brand/Model: ${req.brand} ${req.model}`);
      console.log(`   Status: ${req.status}`);
      console.log(`   Timer Active: ${req.isTimerActive}`);
      console.log(`   Timer Expires: ${req.timerExpiresAt ? req.timerExpiresAt.toISOString() : 'N/A'}`);
      console.log(`   Created: ${req.createdAt.toISOString()}`);
      console.log(`   Knows Problem: ${req.knowsProblem}`);

      if (req.timerExpiresAt) {
        const timeRemaining = req.timerExpiresAt - currentTime;
        const minutesRemaining = Math.floor(timeRemaining / 1000 / 60);
        console.log(`   Time Remaining: ${minutesRemaining} minutes`);
      }
    });

    // Check specifically for pending requests
    const pendingRequests = await ServiceRequest.find({
      status: 'Pending',
      isTimerActive: true,
      timerExpiresAt: { $gt: currentTime },
    }).select('status isTimerActive timerExpiresAt createdAt brand model');

    console.log('\n=== PENDING REQUESTS (Should show in vendor tab) ===');
    console.log(`Found ${pendingRequests.length} pending requests`);

    if (pendingRequests.length === 0) {
      console.log('\n⚠️ NO PENDING REQUESTS FOUND!');
      console.log('This explains why vendors cannot see any requests.');
      console.log('\nPossible reasons:');
      console.log('1. All timers have expired (check timerExpiresAt above)');
      console.log('2. Status is not "Pending"');
      console.log('3. isTimerActive is false');
    } else {
      pendingRequests.forEach((req, i) => {
        console.log(`\n${i + 1}. ${req.brand} ${req.model} - Created: ${req.createdAt.toISOString()}`);
      });
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPendingRequests();
