// src/controllers/serviceRequest.controller.ts

import { Request, Response } from 'express';
import ServiceRequest from '../models/serviceRequest.model';
import userModel from '../models/user.model';
import Vendor from '../models/vendor.model';
import Captain from '../models/captain.model';
import { Types } from 'mongoose';
// We'll use dynamic import for node-fetch
// import fetch from "node-fetch";
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { AuthRequest } from '../middleware/auth.middleware';
import { deleteFromCloudinary, uploadOnCloudinary, uploadToS3 } from '../utils/s3';
import { uploadServiceRequestImage, uploadHandoverImage } from '../utils/s3Upload';
import {
  getEmailForStatusChange,
  getTechnicianAssignmentEmail,
  generateStatusUpdateEmail,
  getVendorScheduleAcceptedEmail,
  getCustomerVendorStatusUpdateEmail,
} from '../utils/emailTemplate';
import mailSender from '../utils/mailSender';
import smsSender from '../utils/smsSender';
import { createNotification } from './notification.controller';
import { creditCaptainWallet } from '../utils/captainWalletService';
import {
  emitStatusUpdate,
  emitAdminNotification,
  sendServiceRequestNotification,
  vendornewStatusRequest,
  captainupdates,
} from '../utils/realTimeNotifications';
dotenv.config();

// Helper: emit vendor_refresh to a vendor's personal user room (identified by their Vendor ObjectId)
const notifyVendorRefresh = async (vendorObjectId: any, type: string, srId: string) => {
  try {
    const io = (global as any).io;
    if (!io || !vendorObjectId) return;
    const vendor = await Vendor.findById(vendorObjectId).select('pocInfo.userId');
    if (vendor?.pocInfo?.userId) {
      io.to(`user-${vendor.pocInfo.userId}`).emit('vendor_refresh', {
        type,
        serviceRequestId: srId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (_) {}
};

const notifyCaptainRefresh = async (captainObjectId: any, type: string, srId: string) => {
  try {
    const io = (global as any).io;
    if (!io || !captainObjectId) return;
    const captain = await Captain.findById(captainObjectId).select('personalInfo.userId');
    if (captain?.personalInfo?.userId) {
      io.to(`user-${captain.personalInfo.userId}`).emit('notification', {
        type,
        serviceRequestId: srId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (_) {}
};

// Utility function for async email sending with timeout
const sendEmailAsync = (email: string, subject: string, html: string) => {
  setImmediate(async () => {
    const startTime = Date.now();
    try {
      console.log(`Sending email to: ${email} with subject: ${subject}`);
      const emailPromise = mailSender(email, subject, html);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Email timeout after 10 seconds')), 10000);
      });

      await Promise.race([emailPromise, timeoutPromise]);
      const duration = Date.now() - startTime;
      console.log(`Email sent successfully to: ${email} in ${duration}ms`);
    } catch (emailError: any) {
      const duration = Date.now() - startTime;
      console.error(
        `Email notification failed after ${duration}ms:`,
        emailError?.message || emailError
      );
      // Email failure doesn't affect the main operation
    }
  });
};

// Define a dynamic fetch function
async function fetchApi(url: string, options?: any) {
  const { default: fetch } = await import('node-fetch');
  return fetch(url, options);
}

export const createServiceRequest = async (req: AuthRequest, res: Response) => {
  let issueImages: string[] | undefined;
  try {
    console.log('Request body:', req.body);
    console.log('Request files:', req.files);

    const customerId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!customerId) {
      return res.status(401).json({
        message: 'Unauthorized: Customer ID not found from authentication.',
      });
    }

    const {
      address,
      city,
      brand,
      model,
      problemDescription,
      preferredDate,
      preferredTime,
      selectedDate,
      selectedTimeSlot,
      budget,
      priority,
      isUrgent,
      latitude,
      longitude,
      // Enhanced fields
      userName,
      userPhone,
      requestType,
      serviceType,
      beneficiaryName,
      beneficiaryPhone,
      // Pricing fields
      problemType,
      knowsProblem,
      issueLevel,
      urgency,
      wantsWarranty,
      wantsDataSafety,
      calculatedPricing,
      // ===== NEW STRUCTURED PROBLEM FIELDS (v2) =====
      minPrice,
      maxPrice,
      level,
    } = req.body;

    // Parse JSON string fields from FormData
    const parsedMainProblem = req.body.mainProblem ? JSON.parse(req.body.mainProblem) : null;
    const parsedSubProblem = req.body.subProblem ? JSON.parse(req.body.subProblem) : null;
    const parsedRelationalBehaviors = req.body.relationalBehaviors
      ? JSON.parse(req.body.relationalBehaviors)
      : [];

    console.log('Service request data:', {
      address,
      city,
      brand,
      model,
      problemDescription,
      preferredDate,
      preferredTime,
      budget,
      priority,
      isUrgent,
      userName,
      userPhone,
      requestType,
      serviceType,
      beneficiaryName,
      beneficiaryPhone,
      problemType,
      knowsProblem,
    });

    // Enhanced validation for new required fields
    if (!address || !city || !brand || !model || !requestType || !serviceType) {
      return res.status(400).json({
        message:
          'Missing required service request details (address, city, brand, model, requestType, serviceType).',
      });
    }

    // Validate fields based on request type
    if (requestType === 'self' && (!userName || !userPhone)) {
      return res.status(400).json({
        message: 'Name and phone are required when request is for yourself.',
      });
    }

    // Validate request type and beneficiary details
    if (requestType === 'other' && (!beneficiaryName || !beneficiaryPhone)) {
      return res.status(400).json({
        message: 'Beneficiary name and phone are required when request is for someone else.',
      });
    }

    // Validate service type
    const validServiceTypes = ['pickup-drop', 'visit-shop', 'onsite'];
    if (!validServiceTypes.includes(serviceType)) {
      return res.status(400).json({
        message: 'Invalid service type. Must be one of: pickup-drop, visit-shop, onsite.',
      });
    }

    // Handle file uploads
    interface Files {
      issueImages?: Express.Multer.File[];
    }

    const files = req.files as Files | undefined;

    // Debug: Log file information
    console.log('=== FILE UPLOAD DEBUG ===');
    console.log('req.files:', req.files);
    console.log('req.files type:', typeof req.files);
    console.log('req.files is array:', Array.isArray(req.files));
    if (req.files) {
      console.log('req.files length:', (req.files as any).length);
      if (Array.isArray(req.files)) {
        console.log(
          'Files array:',
          req.files.map((f: any) => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            size: f.size,
          }))
        );
      } else if (typeof req.files === 'object') {
        console.log('Files object keys:', Object.keys(req.files));
        console.log('issueImages in files:', (req.files as any).issueImages);
      }
    }
    console.log('files variable:', files);
    console.log('files?.issueImages:', files?.issueImages);
    console.log('========================');

    // Handle image uploads to Cloudinary
    // Check both req.files (array) and files.issueImages (object)
    let filesToUpload: Express.Multer.File[] = [];

    if (Array.isArray(req.files) && req.files.length > 0) {
      // If req.files is an array (multer.array), use it directly
      filesToUpload = req.files as Express.Multer.File[];
      console.log('Using files from array:', filesToUpload.length);
    } else if (
      files?.issueImages &&
      Array.isArray(files.issueImages) &&
      files.issueImages.length > 0
    ) {
      // If files.issueImages is an array, use it
      filesToUpload = files.issueImages;
      console.log('Using files from files.issueImages:', filesToUpload.length);
    } else if ((req.files as any)?.issueImages && Array.isArray((req.files as any).issueImages)) {
      // If req.files.issueImages exists, use it
      filesToUpload = (req.files as any).issueImages;
      console.log('Using files from req.files.issueImages:', filesToUpload.length);
    }

    // Get username for S3 folder organization
    const customer = await userModel.findById(customerId).select('email username');
    const username = customer?.email || customer?.username || customerId.toString();

    if (filesToUpload.length === 0) {
      console.log('No images uploaded, continuing without images');
      issueImages = [];
    } else {
      try {
        console.log(`Uploading ${filesToUpload.length} images to S3...`);
        const uploadPromises = filesToUpload.map(async (file, index) => {
          console.log(`Uploading image ${index + 1}:`, file.originalname, file.path, file.size);
          const result = await uploadServiceRequestImage(file.path, username);
          console.log(`Image ${index + 1} uploaded:`, result?.url);
          return result?.url;
        });

        const uploadedUrls = await Promise.all(uploadPromises);
        issueImages = uploadedUrls.filter(url => url !== undefined) as string[];
        console.log('Images uploaded successfully to S3:', issueImages);
        console.log('Total images saved:', issueImages.length);
      } catch (uploadError: any) {
        console.error('Image upload error:', uploadError);
        console.error('Upload error stack:', uploadError.stack);
        // Continue without images if upload fails
        issueImages = [];
      }
    }

    // Get location data with better error handling
    // let lat = 0,
    //   lon = 0;
    // try {
    //   const locationQuery = `${address}, ${city}`;
    //   console.log('Location query:', locationQuery);

    //   const url = `https://us1.locationiq.com/v1/search.php?key=${
    //     process.env.LOCATIONIQ_API_KEY
    //   }&q=${encodeURIComponent(locationQuery)}&format=json`;
    //   console.log('Location API URL:', url);

    //   const response = await fetchApi(url);

    //   if (!response.ok) {
    //     console.error('Location API error:', response.status, response.statusText);
    //     const errorText = await response.text();
    //     console.error('Location API error response:', errorText);

    //     // Continue with default coordinates if location API fails
    //     lat = 0;
    //     lon = 0;
    //   } else {
    //     const locationData = (await response.json()) as any[];
    //     console.log('Location data:', locationData);

    //     if (locationData && Array.isArray(locationData) && locationData.length > 0) {
    //       lat = parseFloat(locationData[0].lat);
    //       lon = parseFloat(locationData[0].lon);
    //     }
    //   }
    // } catch (locationError) {
    //   console.error('Location fetch error:', locationError);
    //   // Continue with default coordinates
    //   lat = 0;
    //   lon = 0
    // }

    // Images are already uploaded to Cloudinary in the earlier section
    const uploadedImages = issueImages || [];

    // Parse calculated pricing if provided
    let parsedPricing = null;
    if (calculatedPricing) {
      try {
        const rawPricing = JSON.parse(calculatedPricing);
        // Structure the pricing data properly for the model
        parsedPricing = {
          serviceChargeRange: rawPricing.serviceChargeRange || null,
          netChargeRange: rawPricing.netChargeRange || null,
          fixedFee: rawPricing.fixedFee || 0,
          serviceTypeFee: rawPricing.serviceTypeFee || 0,
          warrantyFee: rawPricing.warrantyFee || 0,
          urgencyFee: rawPricing.urgencyFee || 0,
          dataSafetyFee: rawPricing.dataSafetyFee || 0,
          finalChargeRange: rawPricing.finalChargeRange || null,
          breakdown: rawPricing.breakdown || [],
          // Store the selected options for reference
          problemType: problemType || rawPricing.problemType || null,
          issueLevel: issueLevel || rawPricing.issueLevel || null,
          serviceType: serviceType || rawPricing.serviceType || null,
          warrantyOption: req.body.warrantyOption || rawPricing.warrantyOption || 'none',
          urgencyLevel: req.body.urgencyLevel || rawPricing.urgencyLevel || 'normal',
          dataSafety: req.body.dataSafety === 'true' || rawPricing.dataSafety || false,
        };
      } catch (error) {
        console.error('Error parsing calculated pricing:', error);
      }
    }

    // Process user-selected date and time slot
    let userSelectedDate: Date | null = null;
    let userSelectedTime: string = '';
    let userSelectedSlot: string = '';

    if (selectedDate && selectedTimeSlot) {
      // Use the new selectedDate and selectedTimeSlot
      userSelectedDate = new Date(selectedDate);
      userSelectedSlot = selectedTimeSlot;

      // Map time slot to time range
      const timeSlotMap: Record<string, string> = {
        '9-12': '09:00 - 12:00',
        '12-15': '12:00 - 15:00',
        '15-18': '15:00 - 18:00',
      };
      userSelectedTime = timeSlotMap[selectedTimeSlot] || preferredTime || '';
    } else if (preferredDate) {
      // Fallback to preferredDate for backward compatibility
      userSelectedDate = new Date(preferredDate);
      userSelectedTime = preferredTime || '';
    }

    // Create and save service request - build object conditionally based on requestType
    const serviceRequestData: any = {
      customerId,
      address,
      customerLocation: {
        latitude: latitude,
        longitude: longitude,
      },
      city,
      brand,
      model,
      problemDescription: problemDescription || '',
      issueImages: uploadedImages,
      status: 'Pending',
      preferredDate: userSelectedDate
        ? userSelectedDate.toISOString().split('T')[0]
        : preferredDate || '',
      preferredTime: userSelectedTime || preferredTime || '',
      // Store user-selected scheduling - automatically accepted since user set it
      scheduledDate: userSelectedDate,
      scheduledTime: userSelectedTime,
      scheduledSlot: userSelectedSlot || undefined,
      userSelectedDate: userSelectedDate,
      userSelectedTimeSlot: userSelectedSlot || undefined,
      scheduleStatus: userSelectedDate ? 'scheduled' : 'pending',
      // Automatically set user response as accepted since user selected the schedule
      userResponse: userSelectedDate
        ? {
            status: 'accepted',
            respondedAt: new Date(),
            userNotes: 'Schedule selected by user during request creation',
          }
        : undefined,
      priority: priority || 'medium',
      isUrgent: isUrgent || false,
      // Add location object for frontend compatibility
      location: {
        address: address,
        lat: latitude,
        lng: longitude,
      },
      // Set title and description for frontend compatibility
      title: `${brand} ${model}`,
      description: problemDescription || '',
      category: 'Device Repair',
      deviceType: 'Unknown',
      deviceBrand: brand,
      deviceModel: model,
      problemType: problemType || undefined,
      knowsProblem: knowsProblem === 'true' || knowsProblem === true,
      requestType: requestType,
      serviceType: serviceType,
      // Pricing fields
      issueLevel: issueLevel || 'software',
      urgency: urgency || 'standard',
      wantsWarranty: wantsWarranty === 'true',
      wantsDataSafety: wantsDataSafety === 'true',
      calculatedPricing: parsedPricing,
      // ===== NEW STRUCTURED PROBLEM FIELDS (v2) =====
      ...(parsedMainProblem?.id ? { mainProblem: parsedMainProblem } : {}),
      ...(parsedSubProblem?.id ? { subProblem: parsedSubProblem } : {}),
      ...(parsedRelationalBehaviors.length > 0
        ? { relationalBehaviors: parsedRelationalBehaviors }
        : {}),
      ...(minPrice !== undefined ? { minPrice: Number(minPrice) } : {}),
      ...(maxPrice !== undefined ? { maxPrice: Number(maxPrice) } : {}),
      ...(level ? { level } : {}),
      // ===== END NEW STRUCTURED PROBLEM FIELDS (v2) =====
      // Set the final charge as the budget if pricing is calculated
      budget: parsedPricing
        ? parsedPricing.finalChargeRange?.min || parsedPricing.finalChargeRange?.max || 0
        : budget || 0,
      // AI Prediction fields
      aiPredictions: req.body.aiPredictions ? JSON.parse(req.body.aiPredictions) : [],
      selectedProblem: req.body.selectedProblem ? JSON.parse(req.body.selectedProblem) : null,
      aiPredicted: req.body.aiPredicted === 'true',
      // Timer fields - so vendors can see this request
      timerStartedAt: new Date(),
      timerExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
      isTimerActive: true,
    };

    // Conditionally add fields based on requestType
    if (requestType === 'self') {
      serviceRequestData.userName = userName;
      serviceRequestData.userPhone = userPhone;
    } else if (requestType === 'other') {
      serviceRequestData.beneficiaryName = beneficiaryName;
      serviceRequestData.beneficiaryPhone = beneficiaryPhone;
    }

    const newServiceRequest = new ServiceRequest(serviceRequestData);

    const savedRequest = await newServiceRequest.save();

    vendornewStatusRequest('new-service-request');
    // Log saved images for debugging
    console.log('=== SERVICE REQUEST SAVED ===');
    console.log('Request ID:', savedRequest._id);
    console.log('Issue Images Count:', savedRequest.issueImages?.length || 0);
    console.log('Issue Images URLs:', savedRequest.issueImages || []);
    console.log('Issue Images Type:', typeof savedRequest.issueImages);
    console.log('Issue Images Is Array:', Array.isArray(savedRequest.issueImages));

    // Verify by fetching from database
    const verifyRequest = await ServiceRequest.findById(savedRequest._id);
    console.log('Verified from DB - Issue Images:', verifyRequest?.issueImages);
    console.log('Verified from DB - Count:', verifyRequest?.issueImages?.length || 0);
    console.log('================================');

    // Clean up the exact draft that was just submitted, if the client provided it.
    try {
      const DraftServiceRequest = require('../models/draftServiceRequest.model').default;
      const draftId = req.body?.draftId as string | undefined;
      if (draftId) {
        await DraftServiceRequest.deleteOne({ _id: draftId });
      }
    } catch (draftCleanupError) {
      console.error(
        'Non-critical: Failed to clean up drafts after service request creation:',
        draftCleanupError
      );
    }

    // Send response immediately
    res.status(201).json({
      success: true,
      message: 'Service request created successfully',
      data: savedRequest,
    });

    // Create notification for the customer
    const { createNotification } = require('./notification.controller');
    await createNotification(
      customerId,
      'Service Request Created',
      `Your service request for ${brand} ${model} has been created successfully. Vendors will be notified and can accept your request.`,
      'service_update',
      (savedRequest as any)._id?.toString() || ''
    );

    // Notify all approved vendors about the new service request
    const approvedVendors = await Vendor.find({
      onboardingStatus: 'Approved',
      'operationalDetails.serviceAreas': { $exists: true, $ne: [] },
    });

    const notifyIo = (global as any).io;
    for (const vendor of approvedVendors) {
      if (vendor.pocInfo?.userId) {
        await createNotification(
          vendor.pocInfo.userId.toString(),
          'New Service Request Available',
          `A new service request for ${brand} ${model} is available in your area. Check your dashboard to accept it.`,
          'vendor_assignment',
          (savedRequest as any)._id?.toString() || ''
        );
        // Real-time: push to vendor dashboard immediately
        if (notifyIo) {
          notifyIo.to(`user-${vendor.pocInfo.userId.toString()}`).emit('vendor_refresh', {
            type: 'new_service_request',
            serviceRequestId: (savedRequest as any)._id?.toString(),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Real-time: notify admins of new service request
    emitAdminNotification('new_service_request', {
      serviceRequestId: (savedRequest as any)._id?.toString(),
      requestId: (savedRequest as any).request_id,
      brand,
      model,
      serviceType,
    });

    // Send confirmation email asynchronously
    try {
      const customer = await userModel.findById(customerId).select('email username');
      if (customer?.email) {
        sendEmailAsync(
          customer.email,
          'Service Request Submitted',
          `<p>Hi ${
            customer.username || 'Customer'
          },</p><p>Your service request has been submitted successfully. We will notify you once a technician is assigned.</p>`
        );
      }
    } catch (error) {
      console.error('Error querying customer for email:', error);
    }
  } catch (error: any) {
    console.error('Error creating service request:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
};

export const getMyServiceRequests = async (req: AuthRequest, res: Response) => {
  try {
    const customerId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Customer ID not found from authentication.',
      });
    }

    console.log('Fetching service requests for customer:', customerId);

    const myRequests = await ServiceRequest.find({ customerId })
      .populate(
        'assignedTechnician',
        'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      )
      .sort({ createdAt: -1 });

    console.log('Found service requests:', myRequests.length);

    // Format the data consistently for frontend
    const formattedRequests = myRequests.map(request => ({
      _id: request._id,
      brand: request.brand,
      model: request.model,
      problemDescription: request.problemDescription,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      address: request.address,
      city: request.city,
      priority: request.priority || 'medium',
      isUrgent: request.isUrgent || false,
      budget: request.budget || 0,
      preferredDate: request.preferredDate,
      preferredTime: request.preferredTime,
      issueImages: request.issueImages || [],
      timerExpiresAt: request.timerExpiresAt,
      isTimerActive: request.isTimerActive,
      knowsProblem: request.knowsProblem || false,
      acceptedBy: request.acceptedBy,
      acceptedAt: request.acceptedAt,
      completedAt: request.completedAt,
      problemType: request.problemType || 'unknown',
      mainProblem: request.mainProblem,
      subProblem: request.subProblem,
      relationalBehaviors: request.relationalBehaviors || [],
      calculatedPricing: request.calculatedPricing,
      estimatedCost: request.estimatedCost,
      vendorServiceCharge: request.vendorServiceCharge,
      adminFinalPrice: request.adminFinalPrice,
      paymentStatus: request.paymentStatus || 'pending',
      serviceType: request.serviceType,
      assignedVendor: request.assignedVendor
        ? { _id: request.assignedVendor._id || request.assignedVendor }
        : null,
      assignedTechnician: request.assignedTechnician
        ? {
            _id: request.assignedTechnician._id,
            pocInfo: {
              fullName: request.assignedTechnician.pocInfo?.fullName || 'Unknown',
              phone: request.assignedTechnician.pocInfo?.phone || '',
              email: request.assignedTechnician.pocInfo?.email || '',
            },
          }
        : null,
      user: {
        username: req.user?.username || 'User',
        email: req.user?.email || '',
      },
    }));

    res.status(200).json({
      success: true,
      message:
        myRequests.length > 0
          ? 'Your service requests retrieved successfully'
          : 'No service requests found',
      data: formattedRequests, // Use 'data' key for consistency
      requests: formattedRequests, // Keep 'requests' for backward compatibility
      count: formattedRequests.length,
    });
  } catch (error: any) {
    console.error('Error fetching customer service requests:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      data: [],
      requests: [],
    });
  }
};

// Update existing service request with new data and restart timer
export const updateServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the owner of this service request
    if (serviceRequest.customerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    // Only allow updates for pending requests
    if (serviceRequest.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending service requests can be updated.',
      });
    }

    // Update the service request with new data
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && key !== '_id' && key !== 'customerId') {
        serviceRequest[key] = updateData[key];
      }
    });

    // Restart the timer
    serviceRequest.timerStartedAt = new Date();
    serviceRequest.timerExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
    serviceRequest.isTimerActive = true;
    serviceRequest.updatedAt = new Date();

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Service request updated successfully and timer restarted.',
      serviceRequest: serviceRequest,
    });
  } catch (error: any) {
    console.error('Update service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service request.',
      error: error.message,
    });
  }
};

// Cancel service request
export const cancelServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the owner of this service request
    if (serviceRequest.customerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to cancel this service request.',
      });
    }

    // Only allow cancellation for pending or assigned requests
    if (serviceRequest.status !== 'Pending' && serviceRequest.status !== 'Assigned') {
      return res.status(400).json({
        success: false,
        message: 'Only pending or assigned service requests can be cancelled.',
      });
    }

    // Cancel the service request
    serviceRequest.status = 'Cancelled';
    serviceRequest.isTimerActive = false;
    serviceRequest.updatedAt = new Date();

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Service request cancelled successfully.',
      serviceRequest: serviceRequest,
    });
  } catch (error: any) {
    console.error('Cancel service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel service request.',
      error: error.message,
    });
  }
};

export const updateServiceRequestStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, technicianNotes, selectedComponents, componentCost, requiresCustomerApproval } =
      req.body;

    if (!id) {
      return res.status(400).json({ message: 'Service request ID is required.' });
    }

    if (!status) {
      return res.status(400).json({ message: 'New status is required.' });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id }).populate(
      'assignedTechnician',
      'pocInfo businessDetails'
    );
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id).populate(
        'assignedTechnician',
        'pocInfo businessDetails'
      );
    }

    if (!serviceRequest) {
      return res.status(404).json({ message: 'Service request not found.' });
    }

    // CONSENT GUARD: For onsite, vendor must have customer consent before marking Arrived at Location
    if (status === 'Arrived at Location' && serviceRequest.serviceType === 'onsite') {
      const onsiteConsentStatus = (serviceRequest as any).onsiteConsent?.status || 'none';
      if (
        onsiteConsentStatus !== 'customer_confirmed_now' &&
        onsiteConsentStatus !== 'slot_approved'
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Customer consent is required before marking arrived. Use "Should I come now?" first.',
        });
      }
    }

    // Update the status and additional fields
    serviceRequest.status = status;
    if (technicianNotes) serviceRequest.technicianNotes = technicianNotes;
    if (selectedComponents) serviceRequest.selectedComponents = selectedComponents;
    if (componentCost) serviceRequest.componentCost = componentCost;
    if (requiresCustomerApproval !== undefined)
      serviceRequest.requiresCustomerApproval = requiresCustomerApproval;

    // Set completion timestamp for completed status
    if (status === 'Completed') {
      serviceRequest.completedAt = new Date();
    }

    await serviceRequest.save();

    // Create notification and send email for status changes
    const { createNotification } = require('./notification.controller');
    const customer = serviceRequest.customerId;
    const cust = await userModel.findById(customer).select('email username phone');

    // Create notification
    const notificationMessages = {
      'In Progress': {
        title: 'Service Started',
        message:
          'Your technician has started working on your device. You will receive regular updates.',
      },
      'Diagnosis Complete': {
        title: 'Diagnosis Complete',
        message:
          'Your device has been diagnosed. Please review the findings and approve any required component replacements.',
      },
      'Parts Required': {
        title: 'Component Replacement Required',
        message:
          'Your device requires component replacement. Please review the selected components and approve the additional cost.',
      },
      'Awaiting Parts': {
        title: 'Awaiting Parts',
        message:
          'We are waiting for the required parts to arrive. We will notify you once they are available.',
      },
      'Repair Complete': {
        title: 'Repair Complete',
        message:
          'Your device has been successfully repaired. We are now performing quality checks.',
      },
      'Quality Check': {
        title: 'Quality Check in Progress',
        message:
          'We are performing final quality checks on your device to ensure everything is working perfectly.',
      },
      'Ready for Pickup': {
        title: 'Ready for Pickup',
        message:
          'Your device is ready for pickup. Please contact us to schedule a convenient time.',
      },
      Completed: {
        title: 'Service Completed',
        message:
          'Your service request has been completed successfully. Thank you for choosing our services!',
      },
      Cancelled: {
        title: 'Service Request Cancelled',
        message: 'Your service request has been cancelled. You can create a new request if needed.',
      },
    };

    const notification = notificationMessages[status as keyof typeof notificationMessages];
    if (notification && customer) {
      await createNotification(
        customer.toString(),
        notification.title,
        notification.message,
        'service_update',
        (serviceRequest._id as any).toString()
      );
    }

    // Send detailed email notification
    if (cust?.email) {
      const emailContent = generateStatusUpdateEmail(
        status,
        cust.username || 'Customer',
        serviceRequest
      );
      await mailSender(cust.email, emailContent.subject, emailContent.html);
    }

    // Send SMS notification for critical status updates
    if (
      cust?.phone &&
      ['Diagnosis Complete', 'Parts Required', 'Ready for Pickup', 'Completed'].includes(status)
    ) {
      try {
        const { sendSMS } = require('./sms.controller');
        await sendSMS(cust.phone, `${notification?.title}: ${notification?.message}`);
      } catch (smsError) {
        console.error('SMS sending failed:', smsError);
        // Don't fail the request if SMS fails
      }
    }

    res.status(200).json({
      success: true,
      message: `Service request status updated to '${status}' successfully.`,
      serviceRequest: serviceRequest,
    });
  } catch (error: any) {
    console.error('Error updating service request status:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

export const updateTechnicianLocation = async (req: AuthRequest, res: Response) => {
  try {
    const { id: vendorId } = req.params;

    if (!vendorId) {
      return res.status(401).json({
        message: 'Unauthorized: Vendor/Technician ID not found from authentication.',
      });
    }

    const vendor = (await Vendor.findById(vendorId)) as typeof Vendor.prototype & {
      currentLocation?: any;
    };
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor/Technician not found.' });
    }
    const { latitude, longitude } = req.body;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ message: 'Invalid latitude or longitude provided.' });
    }

    // Only track location for requests that are "In Progress" (technician has accepted)
    const assignedRequests = await ServiceRequest.find({
      assignedTechnician: vendorId,
      status: 'In Progress', // Only track location when technician is actively working
    });

    if (assignedRequests.length === 0) {
      return res.status(404).json({
        message:
          'No active service requests found for location tracking. Location tracking only works when you have accepted a request.',
      });
    }

    // Update vendor's current location in DB
    vendor.currentLocation = { latitude, longitude, lastUpdated: new Date() };
    await vendor.save();

    const io = req.app.get('socketio');

    // For each active request, emit the live location to the customer's specific request room
    assignedRequests.forEach(request => {
      io.to((request as any)._id.toString()).emit('liveTechnicianLocation', {
        latitude: latitude,
        longitude: longitude,
        vendorId: vendorId,
        requestId: (request as any)._id.toString(),
        technicianName: vendor.pocInfo.fullName,
        estimatedArrival: '15-20 mins', // You can calculate this based on distance
        status: 'On the way',
      });
    });

    res.status(200).json({
      message: 'Vendor/Technician location updated and broadcasted to customers.',
      activeRequests: assignedRequests.length,
    });
  } catch (error: any) {
    console.error('Error updating vendor/technician location:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const assignTechnician = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { technicianId } = req.body;
    console.log('Assigning technician:', requestId, technicianId);

    if (!requestId || !technicianId) {
      return res.status(400).json({ message: 'Both requestId and technicianId are required.' });
    }

    // Find the service request
    let serviceRequest = (await ServiceRequest.findOne({
      request_id: requestId,
    })) as typeof ServiceRequest.prototype & {
      assignedTechnician?: Types.ObjectId;
      status?: string;
    };
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = (await ServiceRequest.findById(
        requestId
      )) as typeof ServiceRequest.prototype & {
        assignedTechnician?: Types.ObjectId;
        status?: string;
      };
    }
    if (!serviceRequest) {
      return res.status(404).json({ message: 'Service request not found.' });
    }

    // Find the technician (vendor)
    const technician = await Vendor.findById(technicianId);
    if (!technician) {
      return res.status(404).json({ message: 'Technician not found.' });
    }

    serviceRequest.assignedTechnician = technicianId;
    serviceRequest.status = 'Assigned';
    await serviceRequest.save();

    const { subject, html } = getTechnicianAssignmentEmail(
      technician.pocInfo.fullName,
      serviceRequest._id.toString(),
      technician._id.toString()
    );

    await mailSender(technician.pocInfo.email, subject, html);

    // Send SMS via AWS SNS
    try {
      const smsMessage = `Hi ${technician.pocInfo.fullName}, You have been assigned a new service request. Please check your dashboard for details.`;
      await smsSender('+919279897789', smsMessage);
      console.log('SMS sent successfully via AWS SNS');
    } catch (smsError: any) {
      console.error('Error sending SMS via AWS SNS:', smsError.message);
      // Don't block the response if SMS fails
    }

    res.status(200).json({ message: 'Technician assigned successfully.', serviceRequest });
  } catch (error: any) {
    console.error('Error assigning technician:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const acceptRequest = async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { technicianId } = req.query;

    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId }).populate(
      'customerId',
      'email username phone'
    );
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId).populate(
        'customerId',
        'email username phone'
      );
    }

    if (!serviceRequest) {
      return res.status(404).send('<h1>Service Request Not Found</h1>');
    }

    if (serviceRequest.assignedTechnician?.toString() !== technicianId) {
      return res
        .status(403)
        .send('<h1>Unauthorized</h1><p>You are not authorized to respond to this request.</p>');
    }

    if (serviceRequest.status !== 'Assigned') {
      return res
        .status(400)
        .send(
          `<h1>Invalid Action</h1><p>This request is currently in "${serviceRequest.status}" status and cannot be accepted.</p>`
        );
    }

    serviceRequest.status = 'In Progress';
    await serviceRequest.save();

    // Real-time: notify customer that vendor accepted the request
    emitStatusUpdate((global as any).io, serviceRequest, 'In Progress');

    const customer = serviceRequest.customerId as any;
    if (customer && customer.email) {
      await mailSender(
        customer.email,
        'Your Service Request has been Accepted',
        `<p>Hi ${customer.username},</p><p>Great news! The technician has accepted your service request and will be in touch shortly to schedule the appointment.</p>`
      );
    }
    if (customer && customer.phone) {
      // Send SMS via AWS SNS
      try {
        const smsMessage = `Hi ${customer.username}, the technician has accepted your service request and will be in touch shortly.`;
        const response = await smsSender('+919279897789', smsMessage);
        console.log('Customer SMS sent successfully via AWS SNS:', response.messageId);
      } catch (error: any) {
        console.error('Error sending acceptance SMS to customer via AWS SNS:', error.message);
      }
    }

    res.send(
      '<h1>Request Accepted</h1><p>Thank you for accepting. The customer has been notified.</p>'
    );
  } catch (error: any) {
    console.error('Error accepting request:', error);
    res
      .status(500)
      .send('<h1>Server Error</h1><p>An error occurred while processing your request.</p>');
  }
};

export const rejectRequest = async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { technicianId } = req.query;

    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }

    if (!serviceRequest) {
      return res.status(404).send('<h1>Service Request Not Found</h1>');
    }

    if (serviceRequest.assignedTechnician?.toString() !== technicianId) {
      return res
        .status(403)
        .send('<h1>Unauthorized</h1><p>You are not authorized to respond to this request.</p>');
    }

    if (serviceRequest.status !== 'Assigned') {
      return res
        .status(400)
        .send(
          `<h1>Invalid Action</h1><p>This request is currently in "${serviceRequest.status}" status and cannot be rejected.</p>`
        );
    }

    serviceRequest.status = 'Pending';
    serviceRequest.assignedTechnician = undefined;
    await serviceRequest.save();

    // Create notification for the customer
    const customer = serviceRequest.customerId;
    if (customer) {
      const { createNotification } = require('./notification.controller');
      await createNotification(
        customer.toString(),
        'Service Request Rejected',
        'A vendor has rejected your service request. It has been returned to the pending queue and other vendors can now accept it.',
        'service_update',
        (serviceRequest as any)._id?.toString() || ''
      );
    }

    res.send(
      '<h1>Request Rejected</h1><p>The service request has been returned to the pending queue for reassignment.</p>'
    );
  } catch (error: any) {
    console.error('Error rejecting request:', error);
    res
      .status(500)
      .send('<h1>Server Error</h1><p>An error occurred while processing your request.</p>');
  }
};

export const getServiceRequestById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Service request ID is required.' });
    }

    console.log('Fetching service request by ID:', id);

    const populateChain = (q: any) =>
      q
        .populate('customerId', 'username email phone')
        .populate(
          'assignedTechnician',
          'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
        )
        .populate(
          'assignedVendor',
          'pocInfo.fullName pocInfo.phone pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
        )
        .populate('deviceHandoverImages.customerPickup.uploadedBy', 'personalInfo.fullName')
        .populate('deviceHandoverImages.deliveryToTechnician.uploadedBy', 'personalInfo.fullName')
        .populate(
          'deviceHandoverImages.returnPickupFromTechnician.uploadedBy',
          'personalInfo.fullName'
        )
        .populate('deviceHandoverImages.customerDelivery.uploadedBy', 'personalInfo.fullName')
        .populate('deviceHandoverImages.deviceIntake.uploadedBy', 'pocInfo.fullName')
        .populate('deviceHandoverImages.postRepairCompletion.uploadedBy', 'pocInfo.fullName')
        .populate('deviceHandoverImages.handoverToCaptain.uploadedBy', 'pocInfo.fullName');

    // Primary lookup by request_id; fallback to _id for documents created before migration
    let request = await populateChain(ServiceRequest.findOne({ request_id: id }));
    if (!request && Types.ObjectId.isValid(id)) {
      request = await populateChain(ServiceRequest.findById(id));
    }

    if (!request) {
      return res.status(404).json({ success: false, message: 'Service request not found.' });
    }

    // Convert to plain object to ensure all nested fields (like verificationTimer) are included
    const requestData = request.toObject ? request.toObject() : request;

    res.status(200).json({ success: true, data: requestData });
  } catch (error: any) {
    console.error('Error fetching service request by ID:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get vendor assigned service requests
export const getVendorAssignedRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(200).json({
        success: false,
        message: 'Vendor profile not found',
        requiresOnboarding: true,
        data: [],
      });
    }

    // Get assigned service requests - check both assignedTechnician and assignedVendor fields
    const requests = await ServiceRequest.find({
      $or: [{ assignedTechnician: vendor._id }, { assignedVendor: vendor._id }],
    })
      .populate({
        path: 'customerId',
        select: 'username email phone',
        options: { strictPopulate: false },
      })
      .sort({ createdAt: -1 });

    console.log('Raw assigned requests found:', requests.length);

    // Debug: Log the first request to see what's in the database
    if (requests.length > 0) {
      const firstRequest = requests[0];
      console.log('First assigned request debug info:', {
        _id: firstRequest._id,
        userPhone: firstRequest.userPhone,
        customerId: firstRequest.customerId,
        assignedTechnician: firstRequest.assignedTechnician,
        assignedVendor: firstRequest.assignedVendor,
        requestType: firstRequest.requestType,
        serviceType: firstRequest.serviceType,
        beneficiaryName: firstRequest.beneficiaryName,
        beneficiaryPhone: firstRequest.beneficiaryPhone,
        knowsProblem: firstRequest.knowsProblem,
      });
    }

    // Format requests for frontend
    console.log('Processing requests for vendor:', vendor._id);
    const formattedRequests = requests.map(request => {
      console.log('Request schedule status:', {
        id: request._id,
        scheduleStatus: request.scheduleStatus,
        scheduledDate: request.scheduledDate,
        scheduledTime: request.scheduledTime,
        userResponse: request.userResponse,
      });

      return {
        _id: request._id,
        userId: request.customerId?._id,
        title: request.title || `${request.brand} ${request.model} Repair`,
        description: request.problemDescription,
        category: request.category || 'repair',
        deviceType: request.deviceType || 'laptop',
        deviceBrand: request.brand,
        deviceModel: request.model,
        problemType: request.problemType || 'hardware',
        knowsProblem: request.knowsProblem || false,
        status: request.status.toLowerCase(),
        priority: request.priority || 'medium',
        // Use vendor's actual service charge instead of hardcoded budget
        budget:
          request.vendorServiceCharge ||
          request.budget ||
          vendor.operationalDetails?.minimumCharges ||
          500,
        vendorServiceCharge: request.vendorServiceCharge,
        vendorPriceBreakdown: request.vendorPriceBreakdown,
        location: {
          address: request.address,
          lat: request.customerLocation?.latitude || 0,
          lng: request.customerLocation?.longitude || 0,
        },
        preferredDate: request.preferredDate || new Date().toISOString().split('T')[0],
        preferredTime: request.preferredTime || '10:00',
        isUrgent: request.isUrgent || false,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        assignedVendor: request.assignedVendor,
        completedAt: request.completedAt,
        userDetails:
          request.customerId && typeof request.customerId === 'object'
            ? {
                username: request.customerId.username || 'Unknown',
                email: request.customerId.email || 'Unknown',
                phone: request.customerId.phone || 'Unknown',
              }
            : null,
        customerId:
          request.customerId && typeof request.customerId === 'object'
            ? {
                username: request.customerId.username || 'Unknown',
                email: request.customerId.email || 'Unknown',
                phone: request.customerId.phone || 'Unknown',
              }
            : null,
        brand: request.brand,
        model: request.model,
        problemDescription: request.problemDescription,
        address: request.address,
        city: request.city,
        // Include enhanced phone fields
        userPhone: request.userPhone,
        requestType: request.requestType,
        serviceType: request.serviceType,
        beneficiaryName: request.beneficiaryName,
        beneficiaryPhone: request.beneficiaryPhone,
        // Include issue images
        issueImages: request.issueImages || [],
        // Include scheduling fields
        scheduleStatus: request.scheduleStatus,
        scheduledDate: request.scheduledDate,
        scheduledTime: request.scheduledTime,
        scheduleNotes: request.scheduleNotes,
        userResponse: request.userResponse,
        userSelectedDate: request.userSelectedDate,
        userSelectedTimeSlot: request.userSelectedTimeSlot,
      };
    });

    return res.status(200).json({
      success: true,
      data: formattedRequests,
    });
  } catch (error) {
    console.error('Get vendor assigned requests error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update service request status by vendor
export const updateRequestStatusByVendor = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { requestId } = req.params;
    const action = req.path.includes('accept') ? 'accept' : 'complete';

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(200).json({
        success: false,
        message: 'Vendor profile not found',
        requiresOnboarding: true,
      });
    }

    // Find the service request
    let request = await ServiceRequest.findOne({ request_id: requestId });
    if (!request && Types.ObjectId.isValid(requestId)) {
      request = await ServiceRequest.findById(requestId);
    }

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Update status based on action
    if (action === 'accept') {
      request.status = 'In Progress';
      request.assignedVendor = vendor._id;
      request.assignedAt = new Date();
    } else if (action === 'complete') {
      request.status = 'Completed';
      request.completedAt = new Date();
    }

    await request.save();

    // Send notification email to customer
    try {
      const customer = await userModel.findById(request.customerId).select('email username');
      if (customer?.email) {
        const emailContent =
          action === 'accept'
            ? `Your service request has been accepted by ${vendor.pocInfo.fullName}. Work will begin shortly.`
            : `Your service request has been completed by ${vendor.pocInfo.fullName}. Thank you for using our services.`;

        await mailSender(
          customer.email,
          `Service Request ${action === 'accept' ? 'Accepted' : 'Completed'}`,
          `<p>Hi ${customer.username || 'Customer'},</p><p>${emailContent}</p>`
        );
      }
    } catch (emailError) {
      console.error('Email sending error:', emailError);
    }

    return res.status(200).json({
      success: true,
      message: `Service request ${action}ed successfully`,
      data: request,
    });
  } catch (error) {
    console.error('Update request status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Vendor accepts a service request
export const acceptServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const vendorUserId = req.user?.userId;
    const { requestId } = req.params;

    if (!vendorUserId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': vendorUserId });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Check if vendor is approved
    if (vendor.onboardingStatus !== 'Approved') {
      return res.status(403).json({
        success: false,
        message: 'Vendor must be approved to accept service requests',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId }).populate(
      'customerId',
      'username email phone'
    );
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId).populate(
        'customerId',
        'username email phone'
      );
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check technician level eligibility (L1 < L2 < L3 < L4)
    const levelHierarchy: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };
    const requestLevel = (serviceRequest as any).level as string | undefined;
    const technicianLevel = vendor.Level as string | null;

    if (requestLevel && levelHierarchy[requestLevel] !== undefined) {
      const requestLevelValue = levelHierarchy[requestLevel];
      const technicianLevelValue = technicianLevel ? (levelHierarchy[technicianLevel] ?? 0) : 0;

      if (requestLevelValue > technicianLevelValue) {
        return res.status(403).json({
          success: false,
          message: `You are not eligible to accept this request. Request requires level ${requestLevel} or above, but your level is ${technicianLevel || 'unassigned'}.`,
        });
      }
    }

    // Check if request is still pending and timer is active
    if (serviceRequest.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: 'Service request is no longer available',
      });
    }

    // Check if timer has expired
    if (!serviceRequest.isTimerActive || new Date() > serviceRequest.timerExpiresAt) {
      // Update status to expired
      serviceRequest.status = 'Expired';
      serviceRequest.isTimerActive = false;
      await serviceRequest.save();

      return res.status(400).json({
        success: false,
        message: 'Service request has expired',
      });
    }

    // Update service request with vendor acceptance
    serviceRequest.status = 'Assigned';
    serviceRequest.assignedTechnician = vendor._id;
    serviceRequest.assignedVendor = vendor._id; // Set both fields for compatibility
    serviceRequest.acceptedBy = vendor._id;
    serviceRequest.acceptedAt = new Date();
    serviceRequest.isTimerActive = false;
    serviceRequest.updatedAt = new Date();

    // Set vendor-specific pricing automatically (non-editable)
    const vendorMinimumCharges = vendor.operationalDetails?.minimumCharges || 500;
    const vendorServiceCharge = Math.max(vendorMinimumCharges, serviceRequest.budget || 0);

    serviceRequest.vendorServiceCharge = vendorServiceCharge;
    serviceRequest.vendorPriceBreakdown = {
      baseServiceCharge: vendorMinimumCharges,
      partsCost: 0, // Will be updated when vendor provides quote
      travelCost: 0, // Will be updated based on distance
      emergencyFee: serviceRequest.isUrgent ? 200 : 0, // Emergency fee if urgent
      totalAmount: vendorServiceCharge,
    };

    // Log the assignment for debugging
    console.log('Vendor assignment:', {
      vendorId: vendor._id,
      vendorName: vendor.pocInfo?.fullName,
      serviceRequestId: serviceRequest._id,
      status: serviceRequest.status,
      vendorServiceCharge: serviceRequest.vendorServiceCharge,
      priceBreakdown: serviceRequest.vendorPriceBreakdown,
    });

    await serviceRequest.save();

    // Real-time: notify customer that a vendor has been assigned
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Assigned');

    // Real-time: notify vendor dashboard to refresh My Jobs tab
    const io = req.app.get('socketio') || (global as any).io;
    if (io && vendorUserId) {
      io.to(`user-${vendorUserId}`).emit('vendor_refresh', {
        type: 'request_accepted',
        serviceRequestId: (serviceRequest as any)._id?.toString(),
        timestamp: new Date().toISOString(),
      });
    }

    io.emit('notification', () => {
      console.log('Emitting notification to all clients about request acceptance');
    });

    // Update vendor stats - increment total requests
    await Vendor.findByIdAndUpdate(vendor._id, {
      $inc: {
        totalRequests: 1,
        pendingRequests: 1,
      },
    });

    // Send response immediately
    res.status(200).json({
      success: true,
      message: 'Service request accepted successfully',
      data: {
        serviceRequest,
        vendor: {
          name: vendor.pocInfo.fullName,
          phone: vendor.pocInfo.phone,
          email: vendor.pocInfo.email,
        },
      },
    });

    // Send notification to customer asynchronously (non-blocking)
    const customer = serviceRequest.customerId as any;
    if (customer?.email) {
      sendEmailAsync(
        customer.email,
        'Technician Assigned',
        `<p>Hi ${customer.username || 'Customer'},</p>
        <p>Great news! A technician has been assigned to your service request.</p>
        <p><strong>Technician:</strong> ${vendor.pocInfo.fullName}</p>
        <p><strong>Contact:</strong> ${vendor.pocInfo.phone}</p>
        <p>The technician will contact you shortly to schedule the service.</p>`
      );
    }

    // Create notification for the customer
    if (customer?._id) {
      await createNotification(
        customer._id.toString(),
        'Technician Assigned',
        `Great news! ${vendor.pocInfo.fullName} has accepted your service request. They will contact you shortly to schedule the service.`,
        'vendor_assignment',
        (serviceRequest as any)._id?.toString() || ''
      );
    }

    // Create notification for the vendor
    if (vendor.pocInfo?.userId) {
      await createNotification(
        vendor.pocInfo.userId.toString(),
        'New Service Request Accepted',
        `You have accepted a new service request from ${customer?.username || 'Customer'}.`,
        'vendor_assignment',
        (serviceRequest as any)._id?.toString() || ''
      );
    }
  } catch (error: any) {
    console.error('Accept service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept service request',
      error: error.message,
    });
  }
};

// Get pending service requests for vendors (within timer window)
export const getPendingRequestsForVendors = async (req: AuthRequest, res: Response) => {
  try {
    const currentTime = new Date();
    const vendorUserId = (req.user as any)?.userId;

    // Fetch the vendor's Level so we can filter requests by matching level
    let vendorLevel: string | null = null;
    if (vendorUserId) {
      const vendorDoc = await Vendor.findOne({ 'pocInfo.userId': vendorUserId }).select('Level');
      vendorLevel = vendorDoc?.Level || null;
    }

    // Level filter (L1 < L2 < L3 < L4):
    //   - Requests WITH a level → visible to vendors whose level is >= request level
    //     e.g. an L3 technician sees L1, L2, and L3 requests
    //   - Requests WITHOUT a level (unknown problem / legacy record) → visible to ALL vendors
    const levelHierarchy: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };
    const vendorLevelValue = vendorLevel ? (levelHierarchy[vendorLevel] ?? 0) : 0;
    const eligibleLevels = Object.keys(levelHierarchy).filter(
      lvl => levelHierarchy[lvl] <= vendorLevelValue
    );

    const levelFilter = vendorLevel
      ? {
          $or: [
            { level: { $in: eligibleLevels } },
            { level: null },
            { level: { $exists: false } },
            { level: '' },
          ],
        }
      : {};

    console.log(
      `[Level Filter] Vendor: ${vendorUserId}, Level: ${vendorLevel}, Eligible levels: ${eligibleLevels.join(', ')}`
    );

    // Find pending requests matching vendor's level
    const pendingRequests = await ServiceRequest.find({
      status: 'Pending',
      isTimerActive: true,
      timerExpiresAt: { $gt: currentTime },
      ...levelFilter,
    })
      .populate('customerId', 'username email phone')
      .sort({ createdAt: -1 });

    console.log('Raw pending requests found:', pendingRequests.length);

    // Debug: Log the first request to see what's in the database
    if (pendingRequests.length > 0) {
      const firstRequest = pendingRequests[0];
      const requestObj = firstRequest.toObject();
      console.log('=== PENDING REQUESTS DEBUG ===');
      console.log('First request debug info:', {
        _id: firstRequest._id,
        userPhone: firstRequest.userPhone,
        customerId: firstRequest.customerId,
        requestType: firstRequest.requestType,
        serviceType: firstRequest.serviceType,
        beneficiaryName: firstRequest.beneficiaryName,
        beneficiaryPhone: firstRequest.beneficiaryPhone,
        issueImages: requestObj.issueImages,
        hasIssueImages: !!requestObj.issueImages,
        issueImagesLength: requestObj.issueImages ? requestObj.issueImages.length : 0,
        issueImagesType: Array.isArray(requestObj.issueImages)
          ? 'array'
          : typeof requestObj.issueImages,
        issueImagesRaw: JSON.stringify(requestObj.issueImages),
      });
      console.log(
        'All pending requests image counts:',
        pendingRequests.map((r: any) => ({
          id: r._id,
          imageCount: r.issueImages?.length || 0,
          hasImages: !!r.issueImages,
        }))
      );
      console.log('================================');
    }

    // Calculate remaining time for each request and include all enhanced details
    const requestsWithTimer = pendingRequests.map(request => {
      const requestObj = request.toObject();

      // Debug: Log each request's phone data
      console.log(`Request ${requestObj._id} phone data:`, {
        userPhone: requestObj.userPhone,
        customerPhone: requestObj.customerId?.phone,
        requestType: requestObj.requestType,
        serviceType: requestObj.serviceType,
      });

      // Ensure issueImages is always an array
      const issueImagesArray = Array.isArray(requestObj.issueImages)
        ? requestObj.issueImages
        : requestObj.issueImages
          ? [requestObj.issueImages]
          : [];

      return {
        ...requestObj,
        timeRemaining: Math.max(0, request.timerExpiresAt.getTime() - currentTime.getTime()),
        // Ensure all enhanced service request details are included
        userPhone: requestObj.userPhone,
        requestType: requestObj.requestType,
        serviceType: requestObj.serviceType,
        beneficiaryName: requestObj.beneficiaryName,
        beneficiaryPhone: requestObj.beneficiaryPhone,
        // Include location details if available
        location: requestObj.location,
        // Include other important fields - ensure issueImages is always an array
        issueImages: issueImagesArray,
        preferredDate: requestObj.preferredDate,
        preferredTime: requestObj.preferredTime,
        budget: requestObj.budget,
        priority: requestObj.priority,
        isUrgent: requestObj.isUrgent,
        knowsProblem: requestObj.knowsProblem || false,
        // Structured problem fields (v2)
        mainProblem: requestObj.mainProblem,
        subProblem: requestObj.subProblem,
        relationalBehaviors: requestObj.relationalBehaviors,
        level: requestObj.level,
        minPrice: requestObj.minPrice,
        maxPrice: requestObj.maxPrice,
      };
    });

    console.log('Processed requests with timer:', requestsWithTimer.length);

    res.status(200).json({
      success: true,
      data: requestsWithTimer,
      vendorLevel, // include vendor's level in response for frontend reference
    });
  } catch (error: any) {
    console.error('Get pending requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending requests',
      error: error.message,
    });
  }
};

// Expire old service requests (to be called by a cron job)
export const expireOldServiceRequests = async () => {
  try {
    const currentTime = new Date();

    // Find requests that are about to expire - with timeout protection
    let expiringRequests;
    try {
      expiringRequests = (await Promise.race([
        ServiceRequest.find({
          status: 'Pending',
          isTimerActive: true,
          timerExpiresAt: { $lt: currentTime },
        }).populate('customerId', 'username email'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database query timeout')), 8000)
        ),
      ])) as any[];
    } catch (dbError: any) {
      console.error('❌ Database timeout during service request expiry lookup:', dbError.message);
      return 0;
    }

    // Update expired requests - with timeout protection
    let expiredRequests;
    try {
      expiredRequests = (await Promise.race([
        ServiceRequest.updateMany(
          {
            status: 'Pending',
            isTimerActive: true,
            timerExpiresAt: { $lt: currentTime },
          },
          {
            $set: {
              status: 'Expired',
              isTimerActive: false,
              updatedAt: currentTime,
            },
          }
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database update timeout')), 8000)
        ),
      ])) as any;
    } catch (updateError: any) {
      console.error(
        '❌ Database timeout during service request expiry update:',
        updateError.message
      );
      return 0;
    }

    // Create notifications for expired requests
    const { createNotification } = require('./notification.controller');
    for (const request of expiringRequests) {
      const customer = request.customerId as any;
      if (customer?._id) {
        await createNotification(
          customer._id.toString(),
          'Service Request Expired',
          `Your service request for ${request.brand} ${request.model} has expired. No vendors accepted it within the time limit. You can create a new request if needed.`,
          'timer_expiry',
          (request as any)._id?.toString() || ''
        );
      }
    }

    console.log(`Expired ${expiredRequests.modifiedCount} service requests`);
    return expiredRequests.modifiedCount;
  } catch (error: any) {
    console.error('Expire service requests error:', error);
    return 0;
  }
};

// Update payment status for cash payments
export const updateCashPaymentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { paymentAmount, paymentMethod = 'cash' } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId }).populate(
      'customerId',
      'username email phone'
    );
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId).populate(
        'customerId',
        'username email phone'
      );
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Debug logging for authorization check
    console.log('Cash payment authorization check:', {
      userId: userId,
      userIdType: typeof userId,
      customerId: serviceRequest.customerId.toString(),
      customerIdType: typeof serviceRequest.customerId.toString(),
      assignedVendor: serviceRequest.assignedVendor?.toString(),
      assignedTechnician: serviceRequest.assignedTechnician?.toString(),
    });

    // Enhanced customer ID comparison with multiple fallbacks
    let isCustomer = false;
    let isVendor = false;

    // Try direct string comparison first
    isCustomer = serviceRequest.customerId.toString() === userId.toString();

    // Check if user is the assigned vendor
    isVendor =
      serviceRequest.assignedVendor?.toString() === userId.toString() ||
      serviceRequest.assignedTechnician?.toString() === userId.toString();

    // If direct comparison fails, try additional checks
    if (!isCustomer && !isVendor) {
      try {
        const userModel = require('../models/user.model').default;
        const user = await userModel.findById(userId);

        if (user) {
          // Try multiple comparison methods
          const customerIdStr = serviceRequest.customerId.toString();
          const userIdStr = user._id.toString();

          // Method 1: Direct string comparison
          if (customerIdStr === userIdStr) {
            isCustomer = true;
            console.log('Customer authorization confirmed via direct string comparison');
          }
          // Method 2: Check if customerId contains the user ID (for object strings)
          else if (customerIdStr.includes(userIdStr)) {
            isCustomer = true;
            console.log('Customer authorization confirmed via substring match');
          }
          // Method 3: Try parsing customerId if it's a JSON string
          else {
            try {
              const parsedCustomerId = JSON.parse(customerIdStr);
              if (parsedCustomerId._id === userIdStr) {
                isCustomer = true;
                console.log('Customer authorization confirmed via JSON parsing');
              }
            } catch (parseError) {
              // Ignore parse errors, continue with other methods
            }
          }
        }
      } catch (error) {
        console.error('Error in user model lookup:', error);
      }
    }

    // Final authorization check
    const isAuthorized = isCustomer || isVendor;

    console.log('Authorization result:', {
      isCustomer,
      isVendor,
      isAuthorized,
    });

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message:
          'You are not authorized to update this service request. Only the customer or assigned vendor can record payments.',
        debug: {
          userId,
          customerId: serviceRequest.customerId.toString(),
          assignedVendor: serviceRequest.assignedVendor?.toString(),
          assignedTechnician: serviceRequest.assignedTechnician?.toString(),
          isCustomer,
          isVendor,
        },
      });
    }

    // Update payment status
    serviceRequest.paymentStatus = 'completed';
    serviceRequest.paymentTransactionId = `CASH_${Date.now()}_${requestId}`;
    serviceRequest.updatedAt = new Date();

    // If vendor is updating, also update service status to completed
    if (isVendor && serviceRequest.status === 'In Progress') {
      serviceRequest.status = 'Completed';
      serviceRequest.completedAt = new Date();
    }

    await serviceRequest.save();

    // Create payment transaction record
    let paymentTransaction = null;
    try {
      const PaymentTransaction = require('../models/PaymentTransaction.model').default;
      paymentTransaction = new PaymentTransaction({
        serviceRequestId: serviceRequest._id,
        customerId: serviceRequest.customerId,
        vendorId: serviceRequest.assignedVendor || serviceRequest.assignedTechnician,
        amount: paymentAmount || serviceRequest.estimatedCost || 0,
        paymentMethod: paymentMethod,
        status: 'Completed',
        gatewayProvider: 'Manual',
        paymentCompletedAt: new Date(),
        customerNotes: `Cash payment received by ${isVendor ? 'vendor' : 'customer'}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });
      await paymentTransaction.save();
      console.log('✅ Cash payment transaction created:', paymentTransaction._id);
      console.log('Transaction details:', {
        serviceRequestId: requestId,
        customerId: serviceRequest.customerId,
        vendorId: serviceRequest.assignedVendor || serviceRequest.assignedTechnician,
        amount: paymentAmount || serviceRequest.estimatedCost || 0,
        status: 'Completed',
      });
    } catch (paymentError) {
      console.error('Error creating payment transaction:', paymentError);
      // Continue without payment transaction if it fails
    }

    // Send notification to customer
    const customer = serviceRequest.customerId as any;
    if (customer?.email) {
      sendEmailAsync(
        customer.email,
        'Payment Received - Service Request',
        `<p>Hi ${customer.username || 'Customer'},</p>
        <p>Payment has been received for your service request.</p>
        <p><strong>Amount:</strong> ₹${paymentAmount || serviceRequest.estimatedCost}</p>
        <p><strong>Payment Method:</strong> Cash</p>
        <p><strong>Transaction ID:</strong> ${serviceRequest.paymentTransactionId}</p>
        <p>Thank you for using our services!</p>`
      );
    }

    // Create notification for the customer
    if (customer?._id) {
      try {
        const { createNotification } = require('./notification.controller');
        await createNotification(
          customer._id.toString(),
          'Payment Received',
          `Cash payment of ₹${paymentAmount || serviceRequest.estimatedCost} has been received for your service request. Transaction ID: ${serviceRequest.paymentTransactionId}`,
          'payment_update',
          requestId
        );
      } catch (notificationError) {
        console.error('Error creating customer notification:', notificationError);
        // Continue without notification if it fails
      }
    }

    // Create notification for the vendor
    const vendorId = serviceRequest.assignedVendor || serviceRequest.assignedTechnician;
    if (vendorId) {
      try {
        const vendor = await Vendor.findById(vendorId);
        if (vendor?.pocInfo?.userId) {
          const { createNotification } = require('./notification.controller');
          await createNotification(
            vendor.pocInfo.userId.toString(),
            'Payment Received',
            `Cash payment of ₹${paymentAmount || serviceRequest.estimatedCost} has been received for service request. Transaction ID: ${serviceRequest.paymentTransactionId}`,
            'payment_update',
            requestId
          );
        }
      } catch (vendorNotificationError) {
        console.error('Error creating vendor notification:', vendorNotificationError);
        // Continue without notification if it fails
      }
    }

    res.status(200).json({
      success: true,
      message: 'Payment status updated successfully',
      data: {
        serviceRequest,
        paymentTransaction,
        paymentStatus: 'completed',
        transactionId: serviceRequest.paymentTransactionId,
      },
    });
  } catch (error: any) {
    console.error('Error updating cash payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment status',
      error: error.message,
    });
  }
};

// Debug endpoint to check user authorization for cash payment
// User-specific status update for schedule acceptance
export const updateUserServiceRequestStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.userId;
    const { status, scheduleStatus } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId })
      .populate('customerId', 'username email phone')
      .populate('assignedVendor', 'pocInfo.fullName pocInfo.email');
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId)
        .populate('customerId', 'username email phone')
        .populate('assignedVendor', 'pocInfo.fullName pocInfo.email');
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Verify that the user is the owner of this service request
    if (serviceRequest.customerId._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request',
      });
    }

    // Only allow status update if it's for schedule acceptance or confirm technician arrival
    const isScheduleAcceptance =
      status === 'In Progress' &&
      serviceRequest.status === 'Assigned' &&
      (serviceRequest.scheduleStatus === 'proposed' ||
        serviceRequest.scheduleStatus === 'accepted' ||
        serviceRequest.scheduleStatus === 'scheduled');

    if (!isScheduleAcceptance) {
      return res.status(400).json({
        success: false,
        message: 'Only schedule acceptance or technician arrival confirmations are allowed',
      });
    }

    // Update the service request status
    const updateData: any = {
      status: status,
      scheduleStatus: 'accepted',
      'userResponse.status': 'accepted',
      'userResponse.respondedAt': new Date(),
      updatedAt: new Date(),
    };

    const updatedRequest = await ServiceRequest.findByIdAndUpdate(serviceRequest._id, updateData, {
      new: true,
    });

    // Create notification for vendor about status update
    await createNotification(
      serviceRequest.assignedVendor._id.toString(),
      'Schedule Accepted & Status Updated',
      `Customer has accepted the schedule and confirmed arrival for service request #${requestId.slice(-6)}.`,
      'status_update',
      requestId
    );

    // Send email notification to vendor
    try {
      const emailContent = getVendorScheduleAcceptedEmail(
        serviceRequest.assignedVendor.pocInfo.fullName,
        serviceRequest.customerId.username,
        serviceRequest
      );
      await mailSender(
        serviceRequest.assignedVendor.pocInfo.email,
        emailContent.subject,
        emailContent.html
      );
    } catch (emailError) {
      console.error('Failed to send status update email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(200).json({
      success: true,
      message: 'Service request status updated successfully',
      data: updatedRequest,
    });
  } catch (error: any) {
    console.error('Error updating service request status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service request status',
      error: error.message,
    });
  }
};

export const debugCashPaymentAuth = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId }).populate(
      'customerId',
      'username email phone'
    );
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId).populate(
        'customerId',
        'username email phone'
      );
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Enhanced customer ID comparison with multiple fallbacks
    let isCustomer = false;
    let isVendor = false;

    // Try direct string comparison first
    isCustomer = serviceRequest.customerId.toString() === userId.toString();

    // Check if user is the assigned vendor
    isVendor =
      serviceRequest.assignedVendor?.toString() === userId.toString() ||
      serviceRequest.assignedTechnician?.toString() === userId.toString();

    // Additional check with user model
    let userDetails = null;
    if (!isCustomer && !isVendor) {
      try {
        const userModel = require('../models/user.model').default;
        const user = await userModel.findById(userId);

        if (user) {
          userDetails = {
            _id: user._id.toString(),
            username: user.username,
            email: user.email,
            role: user.role,
          };

          // Try multiple comparison methods
          const customerIdStr = serviceRequest.customerId.toString();
          const userIdStr = user._id.toString();

          // Method 1: Direct string comparison
          if (customerIdStr === userIdStr) {
            isCustomer = true;
          }
          // Method 2: Check if customerId contains the user ID (for object strings)
          else if (customerIdStr.includes(userIdStr)) {
            isCustomer = true;
          }
          // Method 3: Try parsing customerId if it's a JSON string
          else {
            try {
              const parsedCustomerId = JSON.parse(customerIdStr);
              if (parsedCustomerId._id === userIdStr) {
                isCustomer = true;
              }
            } catch (parseError) {
              // Ignore parse errors, continue with other methods
            }
          }

          // Method 4: Try converting customerId to ObjectId and compare
          if (!isCustomer) {
            try {
              const mongoose = require('mongoose');
              const customerObjectId = new mongoose.Types.ObjectId(customerIdStr);
              const userObjectId = new mongoose.Types.ObjectId(userIdStr);
              if (customerObjectId.equals(userObjectId)) {
                isCustomer = true;
                console.log('Customer authorization confirmed via ObjectId comparison');
              }
            } catch (objectIdError) {
              // Ignore ObjectId conversion errors
            }
          }
        }
      } catch (error) {
        console.error('Error in user model lookup:', error);
      }
    }

    const isAuthorized = isCustomer || isVendor;

    res.status(200).json({
      success: true,
      data: {
        userId,
        userIdType: typeof userId,
        customerId: serviceRequest.customerId.toString(),
        customerIdType: typeof serviceRequest.customerId.toString(),
        assignedVendor: serviceRequest.assignedVendor?.toString(),
        assignedTechnician: serviceRequest.assignedTechnician?.toString(),
        isCustomer,
        isVendor,
        isAuthorized,
        userDetails,
        serviceRequest: {
          id: serviceRequest._id?.toString() || '',
          status: serviceRequest.status,
          customerId: serviceRequest.customerId.toString(),
          assignedVendor: serviceRequest.assignedVendor?.toString(),
          assignedTechnician: serviceRequest.assignedTechnician?.toString(),
        },
      },
    });
  } catch (error: any) {
    console.error('Debug cash payment auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to debug authorization',
      error: error.message,
    });
  }
};

// Vendor initiates payment after service completion
export const initiatePayment = async (req: AuthRequest, res: Response) => {
  try {
    const vendorUserId = req.user?.userId;
    const { requestId } = req.params;
    const { finalAmount, notes } = req.body;

    if (!vendorUserId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': vendorUserId });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this service request',
      });
    }

    // Check if service is completed
    if (serviceRequest.status !== 'Completed') {
      return res.status(400).json({
        success: false,
        message: 'Service must be completed before initiating payment',
      });
    }

    // Check if payment is already initiated
    if (serviceRequest.paymentStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Payment has already been initiated for this service',
      });
    }

    // Update service request with payment initiation
    serviceRequest.paymentStatus = 'vendor_initiated';
    serviceRequest.paymentInitiatedAt = new Date();
    serviceRequest.paymentInitiatedBy = vendor._id;
    serviceRequest.paymentNotes = notes || '';

    // Update final amount if different from initial estimate
    if (finalAmount && finalAmount !== serviceRequest.vendorServiceCharge) {
      serviceRequest.vendorServiceCharge = finalAmount;
      serviceRequest.vendorPriceBreakdown.totalAmount = finalAmount;
    }

    await serviceRequest.save();

    // Notify customer about payment
    if (serviceRequest.customerId) {
      await createNotification(
        serviceRequest.customerId.toString(),
        'Payment Required',
        `Payment of ₹${serviceRequest.vendorServiceCharge} is required for your completed service. Please make the payment to proceed.`,
        'payment_required',
        (serviceRequest as any)._id?.toString() || ''
      );
    }

    res.status(200).json({
      success: true,
      message: 'Payment initiated successfully',
      data: {
        serviceRequestId: serviceRequest._id,
        amount: serviceRequest.vendorServiceCharge,
        paymentStatus: serviceRequest.paymentStatus,
        initiatedAt: serviceRequest.paymentInitiatedAt,
      },
    });
  } catch (error: any) {
    console.error('Initiate payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment',
      error: error.message,
    });
  }
};

// Vendor approves payment after user has paid
export const approvePayment = async (req: AuthRequest, res: Response) => {
  try {
    const vendorUserId = req.user?.userId;
    const { requestId } = req.params;
    const { receiptUrl } = req.body;

    if (!vendorUserId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': vendorUserId });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this service request',
      });
    }

    // Check if payment is in correct status
    if (serviceRequest.paymentStatus !== 'user_paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment must be made by user before approval',
      });
    }

    // Update service request with payment approval
    serviceRequest.paymentStatus = 'vendor_approved';
    serviceRequest.vendorApprovedAt = new Date();
    serviceRequest.paymentReceipt = receiptUrl || '';

    await serviceRequest.save();

    // Notify customer about payment approval
    if (serviceRequest.customerId) {
      await createNotification(
        serviceRequest.customerId.toString(),
        'Payment Approved',
        `Your payment has been approved. You can now download your receipt.`,
        'payment_approved',
        (serviceRequest as any)._id?.toString() || ''
      );
    }

    res.status(200).json({
      success: true,
      message: 'Payment approved successfully',
      data: {
        serviceRequestId: serviceRequest._id,
        paymentStatus: serviceRequest.paymentStatus,
        approvedAt: serviceRequest.vendorApprovedAt,
        receiptUrl: serviceRequest.paymentReceipt,
      },
    });
  } catch (error: any) {
    console.error('Approve payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve payment',
      error: error.message,
    });
  }
};

// Debug endpoint to check raw service request data
export const debugServiceRequestData = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Request ID is required',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId }).populate(
      'customerId',
      'username email phone'
    );
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId).populate(
        'customerId',
        'username email phone'
      );
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    const requestObj = serviceRequest.toObject();

    console.log('Debug: Raw service request data:', {
      _id: requestObj._id,
      userPhone: requestObj.userPhone,
      customerId: requestObj.customerId,
      requestType: requestObj.requestType,
      serviceType: requestObj.serviceType,
      beneficiaryName: requestObj.beneficiaryName,
      beneficiaryPhone: requestObj.beneficiaryPhone,
      createdAt: requestObj.createdAt,
      updatedAt: requestObj.updatedAt,
    });

    res.status(200).json({
      success: true,
      data: {
        _id: requestObj._id,
        userPhone: requestObj.userPhone,
        customerId: requestObj.customerId,
        requestType: requestObj.requestType,
        serviceType: requestObj.serviceType,
        beneficiaryName: requestObj.beneficiaryName,
        beneficiaryPhone: requestObj.beneficiaryPhone,
        createdAt: requestObj.createdAt,
        updatedAt: requestObj.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Debug service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to debug service request',
      error: error.message,
    });
  }
};

// Debug endpoint to list all service requests and their phone data
export const debugAllServiceRequests = async (req: AuthRequest, res: Response) => {
  try {
    // Only allow admin access
    if ((req.user as any)?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    const serviceRequests = await ServiceRequest.find({})
      .populate('customerId', 'username email phone')
      .select('_id userPhone customerId requestType serviceType createdAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(20); // Limit to last 20 for debugging

    const debugData = serviceRequests.map(request => {
      const requestObj = request.toObject();
      return {
        _id: requestObj._id,
        userPhone: requestObj.userPhone,
        customerId: requestObj.customerId,
        requestType: requestObj.requestType,
        serviceType: requestObj.serviceType,
        createdAt: requestObj.createdAt,
        updatedAt: requestObj.updatedAt,
        hasValidPhone:
          requestObj.userPhone &&
          requestObj.userPhone.length > 0 &&
          !requestObj.userPhone.includes('oauth_') &&
          !requestObj.userPhone.includes('google_') &&
          !requestObj.userPhone.includes('_'),
      };
    });

    console.log('Debug: All service requests phone data:', debugData);

    res.status(200).json({
      success: true,
      data: debugData,
      summary: {
        total: debugData.length,
        withValidPhone: debugData.filter(req => req.hasValidPhone).length,
        withInvalidPhone: debugData.filter(req => !req.hasValidPhone).length,
        withOAuthPhone: debugData.filter(req => req.userPhone && req.userPhone.includes('oauth_'))
          .length,
      },
    });
  } catch (error: any) {
    console.error('Debug all service requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to debug service requests',
      error: error.message,
    });
  }
};

// Data migration function to fix service requests with invalid phone data
export const migrateServiceRequestPhoneData = async (req: AuthRequest, res: Response) => {
  try {
    // Only allow admin access
    if ((req.user as any)?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    console.log('Starting service request phone data migration...');

    // Find all service requests with invalid phone data
    const invalidPhoneRequests = await ServiceRequest.find({
      $or: [
        { userPhone: { $exists: false } },
        { userPhone: null },
        { userPhone: '' },
        { userPhone: { $regex: /oauth_/ } },
        { userPhone: { $regex: /google_/ } },
        { userPhone: { $regex: /^[a-zA-Z_]+$/ } }, // Only letters and underscores
      ],
    }).populate('customerId', 'username email phone');

    console.log(`Found ${invalidPhoneRequests.length} service requests with invalid phone data`);

    let fixedCount = 0;
    let skippedCount = 0;

    for (const request of invalidPhoneRequests) {
      const requestObj = request.toObject();
      const customerPhone = requestObj.customerId?.phone;

      if (
        customerPhone &&
        customerPhone.length > 0 &&
        !customerPhone.includes('oauth_') &&
        !customerPhone.includes('google_') &&
        /^\d+$/.test(customerPhone.replace(/[+\-\s()]/g, ''))
      ) {
        // Valid phone number

        // Update the service request with the customer's phone
        await ServiceRequest.findByIdAndUpdate(requestObj._id, {
          userPhone: customerPhone,
          updatedAt: new Date(),
        });

        console.log(
          `Fixed service request ${requestObj._id}: ${requestObj.userPhone} -> ${customerPhone}`
        );
        fixedCount++;
      } else {
        console.log(`Skipped service request ${requestObj._id}: No valid customer phone available`);
        skippedCount++;
      }
    }

    console.log(`Migration completed. Fixed: ${fixedCount}, Skipped: ${skippedCount}`);

    res.status(200).json({
      success: true,
      message: 'Service request phone data migration completed',
      data: {
        totalInvalid: invalidPhoneRequests.length,
        fixed: fixedCount,
        skipped: skippedCount,
      },
    });
  } catch (error: any) {
    console.error('Service request phone data migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to migrate service request phone data',
      error: error.message,
    });
  }
};

// Create verification request for unknown problems
export const createVerificationRequest = async (req: AuthRequest, res: Response) => {
  let issueImages: string[] | undefined;
  try {
    console.log('Verification request body:', req.body);
    console.log('Verification request files:', req.files);

    const customerId = (req.user as any)?.userId;

    if (!customerId) {
      return res.status(401).json({
        message: 'Unauthorized: Customer ID not found from authentication.',
      });
    }

    const {
      address,
      city,
      brand,
      model,
      problemDescription,
      userName,
      userPhone,
      requestType,
      serviceType,
      beneficiaryName,
      beneficiaryPhone,
      deviceSymptoms,
      attemptedSolutions,
      urgency,
      preferredContactTime,
      verificationRequired,
    } = req.body;

    // Enhanced validation for verification requests
    if (
      !address ||
      !city ||
      !brand ||
      !model ||
      !requestType ||
      !serviceType ||
      !problemDescription
    ) {
      return res.status(400).json({
        message: 'Missing required verification request details.',
      });
    }

    // Validate fields based on request type
    if (requestType === 'self' && (!userName || !userPhone)) {
      return res.status(400).json({
        message: 'Name and phone are required when request is for yourself.',
      });
    }

    // Validate request type and beneficiary details
    if (requestType === 'other' && (!beneficiaryName || !beneficiaryPhone)) {
      return res.status(400).json({
        message: 'Beneficiary name and phone are required when request is for someone else.',
      });
    }

    // Get username for S3 folder organization
    const customer = await userModel.findById(customerId).select('email username');
    const username = customer?.email || customer?.username || customerId.toString();

    // Handle image uploads
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      try {
        const uploadPromises = (req.files as Express.Multer.File[]).map(async file => {
          const result = await uploadToS3(file.path, 'user/service-request', username);
          return result?.url;
        });

        const uploadedUrls = await Promise.all(uploadPromises);
        issueImages = uploadedUrls.filter(url => url !== undefined) as string[];
        console.log('Images uploaded successfully to S3:', issueImages);
      } catch (uploadError: any) {
        console.error('Image upload error:', uploadError);
        // Continue without images if upload fails
        issueImages = [];
      }
    }

    // Create verification request with special status - build object conditionally based on requestType
    const verificationRequestData: any = {
      customerId,
      requestType,
      serviceType,
      address,
      city,
      customerLocation: {
        latitude: 0, // Will be updated when location is provided
        longitude: 0,
      },
      brand,
      model,
      problemDescription,
      issueImages,
      status: 'Pending Verification', // Special status for verification requests
      verificationData: {
        deviceSymptoms,
        attemptedSolutions,
        urgency,
        preferredContactTime,
        submittedAt: new Date(),
        adminReviewStatus: 'pending',
        estimatedPricing: null,
        adminNotes: null,
      },
      // Set timer for admin review (24 hours)
      timerStartedAt: new Date(),
      timerExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      isTimerActive: true,
      // AI Prediction fields
      aiPredictions: req.body.aiPredictions ? JSON.parse(req.body.aiPredictions) : [],
      selectedProblem: req.body.selectedProblem ? JSON.parse(req.body.selectedProblem) : null,
      aiPredicted: req.body.aiPredicted === 'true',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Conditionally add fields based on requestType
    if (requestType === 'self') {
      verificationRequestData.userName = userName;
      verificationRequestData.userPhone = userPhone;
    } else if (requestType === 'other') {
      verificationRequestData.beneficiaryName = beneficiaryName;
      verificationRequestData.beneficiaryPhone = beneficiaryPhone;
    }

    const verificationRequest = new ServiceRequest(verificationRequestData);

    await verificationRequest.save();

    // Create notification for admin
    await createNotification(
      'admin', // This will need to be updated with actual admin user ID
      'New Verification Request',
      `New verification request from ${req.body.userPhone} for ${brand} ${model}. Problem: ${problemDescription}`,
      'verification_required',
      verificationRequest._id?.toString() || ''
    );

    // Send email notification to admin (you'll need to implement this)
    // sendEmailAsync(adminEmail, 'New Verification Request', emailContent);

    console.log(
      'Verification request created successfully:',
      verificationRequest._id?.toString() || 'unknown'
    );

    res.status(201).json({
      success: true,
      message:
        'Verification request submitted successfully. Admin will review and contact you within 2-4 hours.',
      data: {
        requestId: verificationRequest._id?.toString() || '',
        status: 'Pending Verification',
        estimatedReviewTime: '2-4 hours',
      },
    });
  } catch (error: any) {
    console.error('Create verification request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create verification request',
      error: error.message,
    });
  }
};

// Get verification requests for vendors
export const getVerificationRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check if user is a vendor
    const Vendor = require('../models/vendor.model').default;
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Vendor role required.',
      });
    }

    // Get verification requests (ServiceRequests with Pending Verification status)
    const verificationRequests = await ServiceRequest.find({
      status: 'Pending Verification',
      'verificationData.adminReviewStatus': 'pending',
    })
      .populate('customerId', 'username email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: verificationRequests,
    });
  } catch (error: any) {
    console.error('Get verification requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch verification requests',
      error: error.message,
    });
  }
};

// Verify a request (vendor action)
export const verifyRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = (req.user as any)?.userId;
    const { verifiedProblemType, verifiedDescription, estimatedPrice, vendorNotes } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check if user is a vendor
    const Vendor = require('../models/vendor.model').default;
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Vendor role required.',
      });
    }

    if (!verifiedProblemType || !estimatedPrice) {
      return res.status(400).json({
        success: false,
        message: 'Verified problem type and estimated price are required',
      });
    }

    // Update verification request (ServiceRequest with Pending Verification status)
    let verificationRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!verificationRequest && Types.ObjectId.isValid(requestId)) {
      verificationRequest = await ServiceRequest.findById(requestId);
    }

    if (!verificationRequest) {
      return res.status(404).json({
        success: false,
        message: 'Verification request not found',
      });
    }

    if (verificationRequest.status !== 'Pending Verification') {
      return res.status(400).json({
        success: false,
        message: 'This request is not pending verification',
      });
    }

    // Update the verification data
    verificationRequest.verificationData = {
      ...verificationRequest.verificationData,
      adminReviewStatus: 'reviewed',
      estimatedPricing: parseFloat(estimatedPrice),
      adminNotes: vendorNotes,
      reviewedBy: vendor._id,
      reviewedAt: new Date(),
      verifiedProblemType,
      verifiedDescription,
      vendorName: vendor.pocInfo.fullName,
    };

    // Update status to pending so user can proceed
    verificationRequest.status = 'Pending';
    verificationRequest.updatedAt = new Date();

    await verificationRequest.save();

    // Create notification for customer
    const { createNotification } = require('./notification.controller');
    await createNotification(
      verificationRequest.customerId.toString(),
      'Problem Verification Complete',
      `Your problem has been verified by our vendor team. Please review the details and proceed with your service request.`,
      'verification_complete',
      verificationRequest._id?.toString() || ''
    );

    res.status(200).json({
      success: true,
      message: 'Verification submitted successfully',
      data: verificationRequest,
    });
  } catch (error: any) {
    console.error('Verify request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify request',
      error: error.message,
    });
  }
};

// Accept verification (user action)
export const acceptVerification = async (req: AuthRequest, res: Response) => {
  try {
    const { verificationId } = req.params;
    const userId = (req.user as any)?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get verification request (ServiceRequest)
    let verificationRequest = await ServiceRequest.findOne({ request_id: verificationId });
    if (!verificationRequest && Types.ObjectId.isValid(verificationId)) {
      verificationRequest = await ServiceRequest.findById(verificationId);
    }

    if (!verificationRequest) {
      return res.status(404).json({
        success: false,
        message: 'Verification request not found',
      });
    }

    // Check if user owns this verification request
    if (verificationRequest.customerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only accept your own verification requests.',
      });
    }

    if (verificationRequest.verificationData?.adminReviewStatus !== 'reviewed') {
      return res.status(400).json({
        success: false,
        message: 'Verification request is not verified yet',
      });
    }

    // Update verification status to accepted
    verificationRequest.verificationData = {
      ...verificationRequest.verificationData,
      adminReviewStatus: 'approved',
    };
    verificationRequest.updatedAt = new Date();
    await verificationRequest.save();

    res.status(200).json({
      success: true,
      message: 'Verification accepted successfully',
      verification: verificationRequest,
    });
  } catch (error: any) {
    console.error('Accept verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept verification',
      error: error.message,
    });
  }
};

// Reject verification (user action)
export const rejectVerification = async (req: AuthRequest, res: Response) => {
  try {
    const { verificationId } = req.params;
    const userId = (req.user as any)?.userId;
    const { reason } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get verification request (ServiceRequest)
    let verificationRequest = await ServiceRequest.findOne({ request_id: verificationId });
    if (!verificationRequest && Types.ObjectId.isValid(verificationId)) {
      verificationRequest = await ServiceRequest.findById(verificationId);
    }

    if (!verificationRequest) {
      return res.status(404).json({
        success: false,
        message: 'Verification request not found',
      });
    }

    // Check if user is a vendor (vendors can reject verification requests)
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only vendors can reject verification requests.',
      });
    }

    console.log('Vendor found:', vendor._id);
    console.log('Verification request found:', verificationRequest._id);

    // Update verification status to rejected
    try {
      verificationRequest.verificationData = {
        ...verificationRequest.verificationData,
        adminReviewStatus: 'rejected',
        rejectionReason: reason || 'User rejected verification',
      };
      verificationRequest.status = 'Cancelled';
      verificationRequest.updatedAt = new Date();

      console.log('Updating verification request with data:', {
        verificationData: verificationRequest.verificationData,
        status: verificationRequest.status,
      });

      await verificationRequest.save();
      console.log('Verification request updated successfully');
    } catch (updateError: any) {
      console.error('Error updating verification request:', updateError);
      throw updateError;
    }

    res.status(200).json({
      success: true,
      message: 'Verification rejected successfully',
    });
  } catch (error: any) {
    console.error('Reject verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject verification',
      error: error.message,
    });
  }
};

// Update service request status with email notifications (vendor workflow)
export const updateVendorServiceRequestStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const vendorId = (req.user as any)?.userId;
    const { status, problemIdentified, problemDescription, repairNotes } = req.body;

    console.log('Vendor status update request:', {
      requestId,
      vendorId,
      status,
      problemIdentified,
      problemDescription,
      repairNotes,
    });

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Find the service request - try request_id first, fall back to _id for older documents
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId })
      .populate('customerId', 'username email phone')
      .populate('assignedVendor', 'pocInfo.fullName pocInfo.email');

    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId)
        .populate('customerId', 'username email phone')
        .populate('assignedVendor', 'pocInfo.fullName pocInfo.email');
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    console.log('Found service request:', {
      id: serviceRequest._id,
      status: serviceRequest.status,
      scheduleStatus: serviceRequest.scheduleStatus,
      assignedVendor: serviceRequest.assignedVendor,
      assignedTechnician: serviceRequest.assignedTechnician,
    });

    // Check if vendor is assigned to this request
    const vendor = await require('../models/vendor.model').default.findOne({
      'pocInfo.userId': vendorId,
    });

    if (!vendor) {
      console.log('Vendor not found for userId:', vendorId);
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    console.log('Found vendor:', {
      id: vendor._id,
      userId: vendor.pocInfo.userId,
      fullName: vendor.pocInfo.fullName,
    });

    const isAssigned =
      serviceRequest.assignedVendor?.toString() === vendor._id.toString() ||
      serviceRequest.assignedTechnician?.toString() === vendor._id.toString();

    console.log('Assignment check:', {
      assignedVendor: serviceRequest.assignedVendor?.toString(),
      assignedTechnician: serviceRequest.assignedTechnician?.toString(),
      vendorId: vendor._id.toString(),
      isAssigned,
    });

    if (!isAssigned) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request',
      });
    }

    // Prepare update data
    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    // Handle specific status updates
    if (status === 'Pickup Initiated') {
      updateData['pickupDetails.actualPickupTime'] = new Date();
    } else if (status === 'Problem Verification') {
      if (problemIdentified !== undefined) {
        updateData['repairDetails.problemIdentified'] = problemIdentified;
      }
      if (problemDescription) {
        updateData['repairDetails.problemDescription'] = problemDescription;
      }
    } else if (status === 'Repair' || status === 'Repair Started') {
      // Handle both 'Repair' (from frontend) and 'Repair Started' (canonical)
      updateData['repairDetails.repairStarted'] = true;
      updateData.status = 'Repair Started'; // Normalize to canonical status
    } else if (status === 'Repair Done') {
      // Note: Image uploads are now handled by captain only, not vendor
      updateData['repairDetails.repairCompleted'] = true;
      if (repairNotes) {
        updateData['repairDetails.repairNotes'] = repairNotes;
      }
    } else if (status === 'Arrived at Shop') {
      // For visit-shop: vendor marks that the customer/device has arrived at the shop
      if (serviceRequest.serviceType !== 'visit-shop') {
        return res.status(400).json({
          success: false,
          message: '"Arrived at Shop" status is only valid for Visit-Shop service type.',
        });
      }
      if (!['Assigned', 'In Progress'].includes(serviceRequest.status)) {
        return res.status(400).json({
          success: false,
          message: 'Can only mark arrived at shop when the request is Assigned or In Progress.',
        });
      }
      updateData.status = 'Arrived at Shop';
    } else if (status === 'Device Received') {
      if (serviceRequest.serviceType === 'pickup-drop') {
        // For pickup-drop: Complete the first drop phase when vendor marks device received
        if (
          serviceRequest.captainPickupRequest &&
          serviceRequest.captainPickupRequest.status === 'handover_to_vendor'
        ) {
          // Note: Image uploads are now handled by captain only, not vendor
          updateData['captainPickupRequest.status'] = 'completed';
          updateData.status = 'Device Received';
          console.log('Device Received - Completing first drop phase');
        }
      } else if (serviceRequest.serviceType === 'visit-shop') {
        // For visit-shop: vendor marks device received from customer (after they arrived)
        if (serviceRequest.status !== 'Arrived at Shop') {
          return res.status(400).json({
            success: false,
            message:
              'Device can only be marked received after the customer has arrived at the shop.',
          });
        }
        updateData.status = 'Device Received';
        console.log('Visit-Shop Device Received - Customer handed over device');
      }
    } else if (status === 'Delivered') {
      updateData['dropDetails.actualDropTime'] = new Date();
      updateData['dropDetails.dropConfirmed'] = true;
      updateData.status = 'Completed'; // Mark as completed when delivered
      updateData.completedAt = new Date(); // Set completion timestamp

      // Add schedule status update to explicitly mark the service as completed
      updateData.scheduleStatus = 'drop_completed';

      // Add entry to status history for tracking
      updateData.$push = {
        statusHistory: {
          status: 'Completed',
          timestamp: new Date(),
          notes: 'Service completed - device delivered',
          updatedBy: 'vendor',
        },
      };

      console.log('Delivered -> Completed update with data:', JSON.stringify(updateData, null, 2));
    }

    console.log('Update data:', updateData);

    // Update the service request
    let updatedRequest;
    try {
      updatedRequest = await ServiceRequest.findByIdAndUpdate(serviceRequest._id, updateData, {
        new: true,
      });
      console.log('Service request updated successfully:', updatedRequest?.status);
    } catch (updateError) {
      console.error('Error updating service request:', updateError);
      throw updateError;
    }

    // Send email notification to customer
    try {
      console.log('Sending email notification to:', serviceRequest.customerId.email);

      const statusMessages = {
        'Pickup Initiated': 'Your device pickup has been initiated by the technician.',
        'Pickup Done': 'Your device has been successfully picked up.',
        'Problem Verification': 'The technician is verifying the problem with your device.',
        'Repair Started': 'Repair work has started on your device.',
        'Repair Done': 'The repair work on your device has been completed.',
        'Drop Initiated': 'Your device delivery has been initiated.',
        Delivered: 'Your device has been successfully delivered.',
      };

      const message =
        statusMessages[status as keyof typeof statusMessages] ||
        `Your service request status has been updated to ${status}.`;

      const emailContent = getCustomerVendorStatusUpdateEmail(
        serviceRequest.customerId.username,
        status,
        message,
        serviceRequest,
        vendor.pocInfo.fullName
      );

      await mailSender(serviceRequest.customerId.email, emailContent.subject, emailContent.html);
      console.log('Email sent successfully');
    } catch (emailError) {
      console.error('Failed to send status update email:', emailError);
      // Don't fail the request if email fails
    }

    // Create notification for customer
    try {
      await createNotification(
        serviceRequest.customerId._id.toString(),
        `Status Update: ${status}`,
        `Your service request status has been updated to ${status}.`,
        'status_update',
        requestId
      );
      console.log('Notification created successfully');
    } catch (notificationError) {
      console.error('Failed to create notification:', notificationError);
      // Don't fail the request if notification fails
    }

    // Send real-time WebSocket notification — emits to both service-{request_id} and service-{_id} rooms
    try {
      emitStatusUpdate(req.app.get('socketio'), serviceRequest, status);
      captainupdates(serviceRequest?.vendorId, status);
    } catch (socketError) {
      console.error('Failed to send WebSocket notification:', socketError);
      // Don't fail the request if WebSocket fails
    }

    res.status(200).json({
      success: true,
      message: 'Status updated successfully',
      data: {
        status: updatedRequest?.status,
        updatedAt: updatedRequest?.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Update service request status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message,
    });
  }
};

// Start identification timer when pickup is done for unknown problems
export const startIdentificationTimer = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = (req.user as any)?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check if user is a vendor
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Vendor role required.',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request (check both assignedVendor and assignedTechnician)
    const isAssignedVendor = serviceRequest.assignedVendor?.toString() === vendor._id.toString();
    const isAssignedTechnician =
      serviceRequest.assignedTechnician?.toString() === vendor._id.toString();

    if (!isAssignedVendor && !isAssignedTechnician) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this service request',
      });
    }

    // Check if this is an unknown problem that needs identification
    // For pickup-drop: Only allow "Device Received" status (after captain hands over device to vendor)
    // For visit-shop: Only allow "Device Received" status (after customer hands device to vendor)
    // For other service types: Allow "Pickup Done" status
    // CRITICAL: Vendor can only start identification after device is physically in hand
    const validStatuses =
      serviceRequest.serviceType === 'pickup-drop' || serviceRequest.serviceType === 'visit-shop'
        ? ['Device Received'] // Device must be physically at the shop
        : ['Pickup Done'];

    // Normalize status for case-insensitive comparison
    const normalizedStatus = (serviceRequest.status || '').trim();
    const isValidStatus = validStatuses.some(
      valid => normalizedStatus.toLowerCase() === valid.toLowerCase()
    );

    // Check if this is an unknown problem that needs identification
    // Identification timer is only for unknown problems (not AI predicted OR vendor doesn't know the problem)
    const isUnknownProblem =
      serviceRequest.aiPredicted === false || serviceRequest.knowsProblem === false;

    if (!isValidStatus || !isUnknownProblem) {
      return res.status(400).json({
        success: false,
        message:
          serviceRequest.serviceType === 'pickup-drop' ||
          serviceRequest.serviceType === 'visit-shop'
            ? !isValidStatus
              ? 'Identification timer can only be started after the device is received at the shop.'
              : 'Identification timer is only for unknown problems. This request has a known problem.'
            : !isValidStatus
              ? 'This request does not require identification timer'
              : 'Identification timer is only for unknown problems. This request has a known problem.',
      });
    }

    // Start identification timer (3 hours)
    serviceRequest.identificationTimerStartedAt = new Date();
    serviceRequest.identificationTimerExpiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours
    serviceRequest.isIdentificationTimerActive = true;
    serviceRequest.updatedAt = new Date();

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Identification timer started. You have 3 hours to identify the problem.',
      timerExpiresAt: serviceRequest.identificationTimerExpiresAt,
    });
  } catch (error: any) {
    console.error('Start identification timer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start identification timer',
      error: error.message,
    });
  }
};

// Manual identification timer start (new admin-mediated flow)
export const startIdentificationTimerManual = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = (req.user as any)?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check if user is a vendor
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Vendor role required.',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    const isAssignedVendor = serviceRequest.assignedVendor?.toString() === vendor._id.toString();
    const isAssignedTechnician =
      serviceRequest.assignedTechnician?.toString() === vendor._id.toString();

    if (!isAssignedVendor && !isAssignedTechnician) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this service request',
      });
    }

    // Check if device is received
    if (serviceRequest.status !== 'Device Received') {
      return res.status(400).json({
        success: false,
        message:
          'Can only start identification after device is received. Current status: ' +
          serviceRequest.status,
      });
    }

    // Check if this is an unknown problem
    if (serviceRequest.knowsProblem !== false) {
      return res.status(400).json({
        success: false,
        message: 'Identification timer is only for unknown problems',
      });
    }

    // Check if already active
    if (serviceRequest.isIdentificationTimerActive) {
      return res.status(400).json({
        success: false,
        message: 'Identification timer is already active',
      });
    }

    // Start 3-hour timer
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);

    serviceRequest.identificationTimerStartedAt = new Date();
    serviceRequest.identificationTimerExpiresAt = expiresAt;
    serviceRequest.isIdentificationTimerActive = true;
    serviceRequest.status = 'Problem Identification';
    serviceRequest.updatedAt = new Date();

    // Add to status history
    serviceRequest.statusHistory.push({
      status: 'Problem Identification',
      timestamp: new Date(),
      notes: 'Vendor started problem identification timer',
      updatedBy: 'vendor',
    });

    await serviceRequest.save();

    // Notify customer
    const { createNotification } = require('./notification.controller');
    await createNotification(
      serviceRequest.customerId.toString(),
      'Problem Identification Started',
      `Vendor is now identifying the problem with your ${serviceRequest.brand} ${serviceRequest.model}. Estimated time: 3 hours.`,
      'service_update',
      requestId
    );

    res.status(200).json({
      success: true,
      message: 'Identification timer started. You have 3 hours.',
      data: {
        expiresAt,
        status: 'Problem Identification',
      },
    });
  } catch (error: any) {
    console.error('Start identification timer manual error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start identification timer',
      error: error.message,
    });
  }
};

// Mark identification as done
export const markIdentificationDone = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = (req.user as any)?.userId;
    const { identifiedProblem, identifiedDescription, estimatedPrice, vendorNotes } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check if user is a vendor
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Vendor role required.',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if vendor is assigned to this request
    if (serviceRequest.assignedVendor?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this service request',
      });
    }

    // Check if identification timer is active
    if (!serviceRequest.isIdentificationTimerActive) {
      return res.status(400).json({
        success: false,
        message: 'Identification timer is not active for this request',
      });
    }

    // Update service request with identified problem
    serviceRequest.status = 'Identification Done';
    serviceRequest.isIdentificationTimerActive = false;
    serviceRequest.budget = estimatedPrice || serviceRequest.budget;
    serviceRequest.technicianNotes = vendorNotes;
    serviceRequest.updatedAt = new Date();

    // Store identification data in the correct subdocument
    serviceRequest.set('problemIdentification.identifiedProblem', identifiedProblem);
    serviceRequest.set('problemIdentification.identificationNotes', identifiedDescription);
    serviceRequest.set('problemIdentification.estimatedCost', estimatedPrice);
    serviceRequest.set('problemIdentification.identifiedBy', vendor._id);
    serviceRequest.set('problemIdentification.identifiedAt', new Date());
    serviceRequest.set('problemIdentification.customerApproval.status', 'pending');

    await serviceRequest.save();

    // Notify customer about identified problem
    if (serviceRequest.customerId) {
      await createNotification(
        serviceRequest.customerId.toString(),
        'Problem Identified',
        `Your device problem has been identified: ${identifiedProblem}. Estimated cost: ₹${estimatedPrice}`,
        'problem_identified',
        serviceRequest._id?.toString() || ''
      );
    }

    res.status(200).json({
      success: true,
      message: 'Problem identification completed successfully',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Mark identification done error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark identification as done',
      error: error.message,
    });
  }
};

// User confirms identified problem and proceeds with service
export const confirmIdentifiedProblem = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = (req.user as any)?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if user owns this request
    if (serviceRequest.customerId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to confirm this identification',
      });
    }

    // Check if status is 'Identification Done'
    if (serviceRequest.status !== 'Identification Done') {
      return res.status(400).json({
        success: false,
        message: 'This request is not in identification done status',
      });
    }

    // Update status to proceed with regular flow
    serviceRequest.status = 'In Progress';
    serviceRequest.updatedAt = new Date();

    // Add status history entry
    serviceRequest.statusHistory = serviceRequest.statusHistory || [];
    serviceRequest.statusHistory.push({
      status: 'In Progress',
      timestamp: new Date(),
      notes: 'User confirmed identified problem, proceeding with service',
      updatedBy: 'customer',
    });

    await serviceRequest.save();

    // Notify vendor about confirmation
    if (serviceRequest.assignedVendor) {
      await createNotification(
        serviceRequest.assignedVendor.toString(),
        'Problem Confirmed',
        'Customer has confirmed the identified problem. You can proceed with the repair.',
        'problem_confirmed',
        serviceRequest._id?.toString() || ''
      );
    }

    res.status(200).json({
      success: true,
      message: 'Problem confirmed successfully. Service will proceed as planned.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Confirm identified problem error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm identified problem',
      error: error.message,
    });
  }
};

// User rejects identified problem and pays only service type fee
export const rejectIdentifiedProblem = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = (req.user as any)?.userId;
    const { rejectionReason } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Find the service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId });
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if user owns this request
    if (serviceRequest.customerId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reject this identification',
      });
    }

    // Check if status is 'Identification Done'
    if (serviceRequest.status !== 'Identification Done') {
      return res.status(400).json({
        success: false,
        message: 'This request is not in identification done status',
      });
    }

    // Calculate service type fee only
    let serviceTypeFee = 0;
    if (serviceRequest.serviceType === 'pickup-drop') {
      serviceTypeFee = 249; // ₹249 for pickup-drop
    } else if (serviceRequest.serviceType === 'onsite') {
      serviceTypeFee = 149; // ₹149 for onsite
    }
    // visit-shop has no additional fee

    // Update status to rejected
    serviceRequest.status = 'Rejected';
    serviceRequest.rejectionReason = rejectionReason || 'User rejected the identified problem';
    serviceRequest.finalAmount = serviceTypeFee; // Only service type fee
    serviceRequest.updatedAt = new Date();

    // Add status history entry
    serviceRequest.statusHistory = serviceRequest.statusHistory || [];
    serviceRequest.statusHistory.push({
      status: 'Rejected',
      timestamp: new Date(),
      notes: `User rejected identified problem. Reason: ${rejectionReason || 'Not specified'}. Service type fee: ₹${serviceTypeFee}`,
      updatedBy: 'customer',
    });

    await serviceRequest.save();

    // Notify vendor about rejection
    if (serviceRequest.assignedVendor) {
      await createNotification(
        serviceRequest.assignedVendor.toString(),
        'Problem Rejected',
        `Customer rejected the identified problem. Reason: ${rejectionReason || 'Not specified'}. Only service type fee (₹${serviceTypeFee}) will be charged.`,
        'problem_rejected',
        serviceRequest._id?.toString() || ''
      );
    }

    res.status(200).json({
      success: true,
      message: 'Problem rejected successfully. You will only be charged the service type fee.',
      serviceRequest: {
        ...serviceRequest.toObject(),
        finalAmount: serviceTypeFee,
        serviceTypeFee,
      },
    });
  } catch (error: any) {
    console.error('Reject identified problem error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject identified problem',
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PICKUP CONSENT FLOW
// ─────────────────────────────────────────────────────────────────────────────

// Vendor asks customer: "Should I send the captain now?"
export const requestPickupConsent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const technicianId = req.user?.userId;

    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    if (!vendor)
      return res.status(403).json({ success: false, message: 'Vendor profile not found.' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    const vendorId = vendor._id.toString();
    const assignedId =
      serviceRequest.assignedTechnician?.toString() || serviceRequest.assignedVendor?.toString();
    if (assignedId !== vendorId)
      return res.status(403).json({ success: false, message: 'Not authorized for this request.' });

    if (serviceRequest.serviceType !== 'pickup-drop')
      return res
        .status(400)
        .json({ success: false, message: 'Pickup consent only applies to pickup-drop requests.' });

    const consentStatus = (serviceRequest as any).pickupConsent?.status || 'none';
    if (consentStatus !== 'none' && consentStatus !== 'slot_rejected_reselect')
      return res
        .status(400)
        .json({ success: false, message: `Pickup consent already in state: ${consentStatus}` });

    (serviceRequest as any).pickupConsent = {
      status: 'vendor_requested',
      vendorRequestedAt: new Date(),
      customerResponse: null,
    };
    await serviceRequest.save();

    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'vendor_requested');
    // Real-time: notify customer that vendor wants to send a pickup captain
    const _pickupIo = (global as any).io;
    const _pickupCustomerId = serviceRequest?.customerId?.toString();
    const _pickupSrId =
      (serviceRequest as any).request_id || (serviceRequest as any)._id?.toString();
    if (_pickupIo && _pickupCustomerId) {
      _pickupIo.to(`user-${_pickupCustomerId}`).emit('notification', {
        type: 'pickup_consent_requested',
        message: 'Your technician wants to send a captain to pick up your device. Please respond.',
        serviceRequestId: _pickupSrId,
        timestamp: new Date().toISOString(),
      });
    }
    sendServiceRequestNotification(_pickupSrId, 'pickup_consent_requested', {
      serviceRequestId: _pickupSrId,
    });
    if ((serviceRequest as any)._id) {
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        'pickup_consent_requested',
        { serviceRequestId: _pickupSrId }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Customer notified. Awaiting their response.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('requestPickupConsent error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to request pickup consent.', error: error.message });
  }
};

// Customer responds to pickup consent: "now" or "slot"
export const respondPickupConsent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { response, slot } = req.body; // response: 'now' | 'slot'; slot: { date, timeSlot }
    const userId = req.user?.userId;

    if (!['now', 'slot'].includes(response))
      return res.status(400).json({ success: false, message: 'Response must be "now" or "slot".' });
    if (response === 'slot' && (!slot?.date || !slot?.timeSlot))
      return res.status(400).json({
        success: false,
        message: 'Slot date and timeSlot are required when choosing a slot.',
      });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    if (serviceRequest.customerId?.toString() !== userId)
      return res
        .status(403)
        .json({ success: false, message: 'Only the customer can respond to pickup consent.' });

    const consentStatus = (serviceRequest as any).pickupConsent?.status;
    if (consentStatus !== 'vendor_requested')
      return res
        .status(400)
        .json({ success: false, message: 'No pending pickup consent request from vendor.' });

    if (response === 'now') {
      (serviceRequest as any).pickupConsent.status = 'customer_confirmed_now';
      (serviceRequest as any).pickupConsent.customerResponse = 'now';
      (serviceRequest as any).pickupConsent.customerRespondedAt = new Date();
    } else {
      (serviceRequest as any).pickupConsent.status = 'slot_pending_admin';
      (serviceRequest as any).pickupConsent.customerResponse = 'slot';
      (serviceRequest as any).pickupConsent.customerRespondedAt = new Date();
      (serviceRequest as any).pickupConsent.selectedSlot = {
        date: slot.date,
        timeSlot: slot.timeSlot,
      };
      (serviceRequest as any).pickupConsent.slotSubmittedAt = new Date();
    }
    await serviceRequest.save();

    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'customer_confirmed_now');

    // Real-time: notify vendor of customer's consent response; notify admin if slot pending
    sendServiceRequestNotification((serviceRequest as any).request_id, 'pickup_consent_updated', {
      consentStatus: (serviceRequest as any).pickupConsent.status,
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification(
      (serviceRequest as any)._id.toString(),
      'pickup_consent_updated',
      {
        consentStatus: (serviceRequest as any).pickupConsent.status,
        serviceRequestId: (serviceRequest as any).request_id,
      }
    );
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'pickup_consent_updated',
      (serviceRequest as any)._id?.toString()
    );
    if (response === 'slot')
      emitAdminNotification('pickup_slot_pending_review', {
        serviceRequestId: (serviceRequest as any)._id?.toString(),
        requestId: serviceRequest.request_id,
      });

    return res.status(200).json({
      success: true,
      message:
        response === 'now'
          ? 'Vendor notified you are available now.'
          : 'Slot submitted for admin approval.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('respondPickupConsent error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to respond to pickup consent.',
      error: error.message,
    });
  }
};

// Customer resubmits a new pickup slot (after admin rejects)
export const submitPickupSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { slot } = req.body; // { date, timeSlot }
    const userId = req.user?.userId;

    if (!slot?.date || !slot?.timeSlot)
      return res
        .status(400)
        .json({ success: false, message: 'Slot date and timeSlot are required.' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    if (serviceRequest.customerId?.toString() !== userId)
      return res
        .status(403)
        .json({ success: false, message: 'Only the customer can submit a pickup slot.' });

    const consentStatus = (serviceRequest as any).pickupConsent?.status;
    if (consentStatus !== 'slot_rejected_reselect')
      return res.status(400).json({ success: false, message: 'No reselect request pending.' });

    (serviceRequest as any).pickupConsent.status = 'slot_pending_admin';
    (serviceRequest as any).pickupConsent.selectedSlot = {
      date: slot.date,
      timeSlot: slot.timeSlot,
    };
    (serviceRequest as any).pickupConsent.slotSubmittedAt = new Date();
    await serviceRequest.save();

    return res
      .status(200)
      .json({ success: true, message: 'New slot submitted for admin approval.', serviceRequest });
  } catch (error: any) {
    console.error('submitPickupSlot error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to submit pickup slot.', error: error.message });
  }
};

// Admin approves or rejects the customer's pickup slot
export const adminReviewPickupSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { action, adminNotes } = req.body; // action: 'approve' | 'reject_reselect'
    const adminUserId = req.user?.userId;

    if (!['approve', 'reject_reselect'].includes(action))
      return res
        .status(400)
        .json({ success: false, message: 'Action must be "approve" or "reject_reselect".' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    const consentStatus = (serviceRequest as any).pickupConsent?.status;
    if (consentStatus !== 'slot_pending_admin')
      return res
        .status(400)
        .json({ success: false, message: 'No pickup slot pending admin review.' });

    (serviceRequest as any).pickupConsent.adminReviewedBy = adminUserId;
    (serviceRequest as any).pickupConsent.adminReviewedAt = new Date();
    (serviceRequest as any).pickupConsent.adminNotes = adminNotes || '';

    if (action === 'approve') {
      (serviceRequest as any).pickupConsent.status = 'slot_approved';
      (serviceRequest as any).pickupConsent.approvedSlot = {
        date: (serviceRequest as any).pickupConsent.selectedSlot.date,
        timeSlot: (serviceRequest as any).pickupConsent.selectedSlot.timeSlot,
      };
    } else {
      (serviceRequest as any).pickupConsent.status = 'slot_rejected_reselect';
    }
    await serviceRequest.save();

    // Real-time: notify customer and vendor of slot decision
    sendServiceRequestNotification((serviceRequest as any).request_id, 'pickup_slot_reviewed', {
      action,
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification((serviceRequest as any)._id.toString(), 'pickup_slot_reviewed', {
      action,
      serviceRequestId: (serviceRequest as any).request_id,
    });
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'pickup_slot_reviewed',
      (serviceRequest as any)._id?.toString()
    );
    sendServiceRequestNotification((serviceRequest as any).request_id, 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification((serviceRequest as any)._id.toString(), 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    notifyCaptainRefresh(
      serviceRequest.assignedCaptain,
      'admin_action',
      (serviceRequest as any).request_id
    );

    return res.status(200).json({
      success: true,
      message: action === 'approve' ? 'Pickup slot approved.' : 'Customer asked to reselect slot.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('adminReviewPickupSlot error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to review pickup slot.', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DROP CONSENT FLOW
// ─────────────────────────────────────────────────────────────────────────────

// Vendor asks customer: "Should I send the captain now?" (for return drop)
export const requestDropConsent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const technicianId = req.user?.userId;

    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    if (!vendor)
      return res.status(403).json({ success: false, message: 'Vendor profile not found.' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    const vendorId = vendor._id.toString();
    const assignedId =
      serviceRequest.assignedTechnician?.toString() || serviceRequest.assignedVendor?.toString();
    if (assignedId !== vendorId)
      return res.status(403).json({ success: false, message: 'Not authorized for this request.' });

    // pickup-drop: always allowed | visit-shop: only when customer has chosen captain-delivery
    if (serviceRequest.serviceType === 'onsite')
      return res
        .status(400)
        .json({ success: false, message: 'Drop consent is not applicable for onsite requests.' });

    if (
      serviceRequest.serviceType === 'visit-shop' &&
      serviceRequest.postRepairDeliveryPreference !== 'captain-delivery'
    )
      return res.status(400).json({
        success: false,
        message:
          'Drop consent for visit-shop is only allowed after customer has chosen captain delivery.',
      });

    if (serviceRequest.status !== 'Repair Done')
      return res.status(400).json({
        success: false,
        message: 'Drop consent can only be requested after repair is done.',
      });

    const consentStatus = (serviceRequest as any).dropConsent?.status || 'none';
    if (consentStatus !== 'none' && consentStatus !== 'slot_rejected_reselect')
      return res
        .status(400)
        .json({ success: false, message: `Drop consent already in state: ${consentStatus}` });

    (serviceRequest as any).dropConsent = {
      status: 'vendor_requested',
      vendorRequestedAt: new Date(),
      customerResponse: null,
    };
    await serviceRequest.save();
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'vendor_requested');

    // Real-time: notify customer that vendor wants to send a captain for return drop
    const _dropIo = (global as any).io;
    const _dropCustomerId = serviceRequest.customerId?.toString();
    const _dropSrId = (serviceRequest as any).request_id || (serviceRequest as any)._id?.toString();
    if (_dropIo && _dropCustomerId) {
      _dropIo.to(`user-${_dropCustomerId}`).emit('notification', {
        type: 'drop_consent_requested',
        message:
          'Your device is repaired! Your technician wants to send a captain to deliver it. Please respond.',
        serviceRequestId: _dropSrId,
        timestamp: new Date().toISOString(),
      });
    }
    sendServiceRequestNotification(_dropSrId, 'drop_consent_requested', {
      serviceRequestId: _dropSrId,
    });
    if ((serviceRequest as any)._id) {
      sendServiceRequestNotification(
        (serviceRequest as any)._id.toString(),
        'drop_consent_requested',
        { serviceRequestId: _dropSrId }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Customer notified for drop consent. Awaiting their response.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('requestDropConsent error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to request drop consent.', error: error.message });
  }
};

// Customer responds to drop consent: "now" or "slot"
export const respondDropConsent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { response, slot } = req.body;
    const userId = req.user?.userId;

    if (!['now', 'slot'].includes(response))
      return res.status(400).json({ success: false, message: 'Response must be "now" or "slot".' });
    if (response === 'slot' && (!slot?.date || !slot?.timeSlot))
      return res.status(400).json({
        success: false,
        message: 'Slot date and timeSlot are required when choosing a slot.',
      });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    if (serviceRequest.customerId?.toString() !== userId)
      return res
        .status(403)
        .json({ success: false, message: 'Only the customer can respond to drop consent.' });

    const consentStatus = (serviceRequest as any).dropConsent?.status;
    if (consentStatus !== 'vendor_requested')
      return res
        .status(400)
        .json({ success: false, message: 'No pending drop consent request from vendor.' });

    if (response === 'now') {
      (serviceRequest as any).dropConsent.status = 'customer_confirmed_now';
      (serviceRequest as any).dropConsent.customerResponse = 'now';
      (serviceRequest as any).dropConsent.customerRespondedAt = new Date();
    } else {
      (serviceRequest as any).dropConsent.status = 'slot_pending_admin';
      (serviceRequest as any).dropConsent.customerResponse = 'slot';
      (serviceRequest as any).dropConsent.customerRespondedAt = new Date();
      (serviceRequest as any).dropConsent.selectedSlot = {
        date: slot.date,
        timeSlot: slot.timeSlot,
      };
      (serviceRequest as any).dropConsent.slotSubmittedAt = new Date();
    }
    await serviceRequest.save();
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'customer_confirmed_now');

    // Real-time: notify vendor + admin
    sendServiceRequestNotification((serviceRequest as any).request_id, 'drop_consent_updated', {
      consentStatus: (serviceRequest as any).dropConsent.status,
    });
    sendServiceRequestNotification((serviceRequest as any)._id.toString(), 'drop_consent_updated', {
      consentStatus: (serviceRequest as any).dropConsent.status,
    });
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'drop_consent_updated',
      (serviceRequest as any)._id?.toString()
    );
    if (response === 'slot')
      emitAdminNotification('drop_slot_pending_review', {
        serviceRequestId: (serviceRequest as any)._id?.toString(),
        requestId: serviceRequest.request_id,
      });

    return res.status(200).json({
      success: true,
      message:
        response === 'now'
          ? 'Vendor notified you are available for drop now.'
          : 'Drop slot submitted for admin approval.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('respondDropConsent error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to respond to drop consent.',
      error: error.message,
    });
  }
};

// Customer resubmits a new drop slot (after admin rejects)
export const submitDropSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { slot } = req.body;
    const userId = req.user?.userId;

    if (!slot?.date || !slot?.timeSlot)
      return res
        .status(400)
        .json({ success: false, message: 'Slot date and timeSlot are required.' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    if (serviceRequest.customerId?.toString() !== userId)
      return res
        .status(403)
        .json({ success: false, message: 'Only the customer can submit a drop slot.' });

    const consentStatus = (serviceRequest as any).dropConsent?.status;
    if (consentStatus !== 'slot_rejected_reselect')
      return res
        .status(400)
        .json({ success: false, message: 'No reselect request pending for drop.' });

    (serviceRequest as any).dropConsent.status = 'slot_pending_admin';
    (serviceRequest as any).dropConsent.selectedSlot = { date: slot.date, timeSlot: slot.timeSlot };
    (serviceRequest as any).dropConsent.slotSubmittedAt = new Date();
    await serviceRequest.save();

    return res.status(200).json({
      success: true,
      message: 'New drop slot submitted for admin approval.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('submitDropSlot error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to submit drop slot.', error: error.message });
  }
};

// Admin approves or rejects the customer's drop slot
export const adminReviewDropSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { action, adminNotes } = req.body;
    const adminUserId = req.user?.userId;

    if (!['approve', 'reject_reselect'].includes(action))
      return res
        .status(400)
        .json({ success: false, message: 'Action must be "approve" or "reject_reselect".' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    const consentStatus = (serviceRequest as any).dropConsent?.status;
    if (consentStatus !== 'slot_pending_admin')
      return res
        .status(400)
        .json({ success: false, message: 'No drop slot pending admin review.' });

    (serviceRequest as any).dropConsent.adminReviewedBy = adminUserId;
    (serviceRequest as any).dropConsent.adminReviewedAt = new Date();
    (serviceRequest as any).dropConsent.adminNotes = adminNotes || '';

    if (action === 'approve') {
      (serviceRequest as any).dropConsent.status = 'slot_approved';
      (serviceRequest as any).dropConsent.approvedSlot = {
        date: (serviceRequest as any).dropConsent.selectedSlot.date,
        timeSlot: (serviceRequest as any).dropConsent.selectedSlot.timeSlot,
      };
    } else {
      (serviceRequest as any).dropConsent.status = 'slot_rejected_reselect';
    }
    await serviceRequest.save();

    sendServiceRequestNotification((serviceRequest as any).request_id, 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification((serviceRequest as any)._id.toString(), 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'admin_action',
      (serviceRequest as any).request_id
    );
    notifyCaptainRefresh(
      serviceRequest.assignedCaptain,
      'admin_action',
      (serviceRequest as any).request_id
    );

    return res.status(200).json({
      success: true,
      message:
        action === 'approve' ? 'Drop slot approved.' : 'Customer asked to reselect drop slot.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('adminReviewDropSlot error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to review drop slot.', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ONSITE CONSENT FLOW
// Vendor asks customer "Should I come now?" before marking Arrived at Location
// ─────────────────────────────────────────────────────────────────────────────

export const requestOnsiteConsent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const technicianId = req.user?.userId;

    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    if (!vendor)
      return res.status(403).json({ success: false, message: 'Vendor profile not found.' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    const vendorId = vendor._id.toString();
    const assignedId =
      serviceRequest.assignedTechnician?.toString() || serviceRequest.assignedVendor?.toString();
    if (assignedId !== vendorId)
      return res.status(403).json({ success: false, message: 'Not authorized for this request.' });

    if (serviceRequest.serviceType !== 'onsite')
      return res
        .status(400)
        .json({ success: false, message: 'Onsite consent only applies to onsite requests.' });

    if (!['Assigned', 'In Progress'].includes(serviceRequest.status))
      return res.status(400).json({
        success: false,
        message: 'Consent can only be requested when the service is Assigned or In Progress.',
      });

    const consentStatus = (serviceRequest as any).onsiteConsent?.status || 'none';
    if (consentStatus !== 'none' && consentStatus !== 'slot_rejected_reselect')
      return res
        .status(400)
        .json({ success: false, message: `Onsite consent already in state: ${consentStatus}` });

    (serviceRequest as any).onsiteConsent = {
      status: 'vendor_requested',
      vendorRequestedAt: new Date(),
      customerResponse: null,
    };
    await serviceRequest.save();

    // Notify customer so their page auto-refreshes
    sendServiceRequestNotification((serviceRequest as any).request_id, 'onsite_consent_requested', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification(
      (serviceRequest as any)._id.toString(),
      'onsite_consent_requested',
      { serviceRequestId: (serviceRequest as any).request_id }
    );

    return res.status(200).json({
      success: true,
      message: 'Customer notified. Awaiting their response.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('requestOnsiteConsent error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to request onsite consent.', error: error.message });
  }
};

export const respondOnsiteConsent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { response, slot } = req.body; // response: 'now' | 'slot'; slot: { date, timeSlot }
    const userId = req.user?.userId;

    if (!['now', 'slot'].includes(response))
      return res.status(400).json({ success: false, message: 'Response must be "now" or "slot".' });
    if (response === 'slot' && (!slot?.date || !slot?.timeSlot))
      return res.status(400).json({
        success: false,
        message: 'Slot date and timeSlot are required when choosing a slot.',
      });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    if (serviceRequest.customerId?.toString() !== userId)
      return res
        .status(403)
        .json({ success: false, message: 'Only the customer can respond to onsite consent.' });

    const consentStatus = (serviceRequest as any).onsiteConsent?.status;
    if (consentStatus !== 'vendor_requested')
      return res
        .status(400)
        .json({ success: false, message: 'No pending onsite consent request from vendor.' });

    if (response === 'now') {
      (serviceRequest as any).onsiteConsent.status = 'customer_confirmed_now';
      (serviceRequest as any).onsiteConsent.customerResponse = 'now';
      (serviceRequest as any).onsiteConsent.customerRespondedAt = new Date();
    } else {
      (serviceRequest as any).onsiteConsent.status = 'slot_pending_admin';
      (serviceRequest as any).onsiteConsent.customerResponse = 'slot';
      (serviceRequest as any).onsiteConsent.customerRespondedAt = new Date();
      (serviceRequest as any).onsiteConsent.selectedSlot = {
        date: slot.date,
        timeSlot: slot.timeSlot,
      };
      (serviceRequest as any).onsiteConsent.slotSubmittedAt = new Date();
    }
    await serviceRequest.save();

    // Notify vendor so their page auto-refreshes
    sendServiceRequestNotification((serviceRequest as any).request_id, 'onsite_consent_updated', {
      consentStatus: (serviceRequest as any).onsiteConsent.status,
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification(
      (serviceRequest as any)._id.toString(),
      'onsite_consent_updated',
      {
        consentStatus: (serviceRequest as any).onsiteConsent.status,
        serviceRequestId: (serviceRequest as any).request_id,
      }
    );

    return res.status(200).json({
      success: true,
      message:
        response === 'now'
          ? 'Vendor notified you are available now.'
          : 'Slot submitted for admin approval.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('respondOnsiteConsent error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to respond to onsite consent.',
      error: error.message,
    });
  }
};

export const submitOnsiteSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { slot } = req.body;
    const userId = req.user?.userId;

    if (!slot?.date || !slot?.timeSlot)
      return res
        .status(400)
        .json({ success: false, message: 'Slot date and timeSlot are required.' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    if (serviceRequest.customerId?.toString() !== userId)
      return res
        .status(403)
        .json({ success: false, message: 'Only the customer can submit an onsite slot.' });

    const consentStatus = (serviceRequest as any).onsiteConsent?.status;
    if (consentStatus !== 'slot_rejected_reselect')
      return res.status(400).json({ success: false, message: 'No reselect request pending.' });

    (serviceRequest as any).onsiteConsent.status = 'slot_pending_admin';
    (serviceRequest as any).onsiteConsent.selectedSlot = {
      date: slot.date,
      timeSlot: slot.timeSlot,
    };
    (serviceRequest as any).onsiteConsent.slotSubmittedAt = new Date();
    await serviceRequest.save();

    return res
      .status(200)
      .json({ success: true, message: 'New slot submitted for admin approval.', serviceRequest });
  } catch (error: any) {
    console.error('submitOnsiteSlot error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to submit onsite slot.', error: error.message });
  }
};

export const adminReviewOnsiteSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { action, adminNotes } = req.body; // action: 'approve' | 'reject_reselect'
    const adminUserId = req.user?.userId;

    if (!['approve', 'reject_reselect'].includes(action))
      return res
        .status(400)
        .json({ success: false, message: 'Action must be "approve" or "reject_reselect".' });

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id))
      serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest)
      return res.status(404).json({ success: false, message: 'Service request not found.' });

    const consentStatus = (serviceRequest as any).onsiteConsent?.status;
    if (consentStatus !== 'slot_pending_admin')
      return res
        .status(400)
        .json({ success: false, message: 'No onsite slot pending admin review.' });

    (serviceRequest as any).onsiteConsent.adminReviewedBy = adminUserId;
    (serviceRequest as any).onsiteConsent.adminReviewedAt = new Date();
    (serviceRequest as any).onsiteConsent.adminNotes = adminNotes || '';

    if (action === 'approve') {
      (serviceRequest as any).onsiteConsent.status = 'slot_approved';
      (serviceRequest as any).onsiteConsent.approvedSlot = {
        date: (serviceRequest as any).onsiteConsent.selectedSlot.date,
        timeSlot: (serviceRequest as any).onsiteConsent.selectedSlot.timeSlot,
      };
    } else {
      (serviceRequest as any).onsiteConsent.status = 'slot_rejected_reselect';
    }
    await serviceRequest.save();

    sendServiceRequestNotification((serviceRequest as any).request_id, 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification((serviceRequest as any)._id.toString(), 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'admin_action',
      (serviceRequest as any).request_id
    );

    return res.status(200).json({
      success: true,
      message:
        action === 'approve' ? 'Onsite visit slot approved.' : 'Customer asked to reselect slot.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('adminReviewOnsiteSlot error:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to review onsite slot.', error: error.message });
  }
};

// Request captain pickup
export const requestCaptainPickup = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { pickupAddress, pickupNotes, estimatedPickupTime } = req.body;
    const technicianId = req.user?.userId;

    console.log('Debug - Request received:', {
      id,
      technicianId,
      user: req.user,
      body: req.body,
    });

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!technicianId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the vendor profile for this user
    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    console.log('Debug - Vendor lookup:', {
      technicianId,
      vendorFound: !!vendor,
      vendorId: vendor?._id,
    });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id }).populate(
      'assignedTechnician'
    );
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id).populate('assignedTechnician');
    }
    console.log('Debug - Service request lookup:', {
      serviceRequestId: id,
      serviceRequestFound: !!serviceRequest,
      assignedTechnician: serviceRequest?.assignedTechnician,
      assignedTechnicianId: serviceRequest?.assignedTechnician?._id,
      vendorId: vendor._id,
      status: serviceRequest?.status,
    });

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // CRITICAL: Ensure vendor has been assigned to this request
    if (!serviceRequest.assignedTechnician && !serviceRequest.assignedVendor) {
      return res.status(400).json({
        success: false,
        message:
          'No vendor has been assigned to this service request. Please accept the request first.',
      });
    }

    // Verify that the user is the assigned technician (compare vendor IDs)
    const assignedTechnicianId =
      serviceRequest.assignedTechnician?._id?.toString() ||
      (serviceRequest.assignedTechnician as any)?.toString();
    const assignedVendorId =
      serviceRequest.assignedVendor?._id?.toString() ||
      (serviceRequest.assignedVendor as any)?.toString();
    const vendorIdString = vendor._id.toString();

    console.log('Debug - ID Comparison:', {
      assignedTechnicianId,
      assignedVendorId,
      vendorIdString,
      matchTechnician: assignedTechnicianId === vendorIdString,
      matchVendor: assignedVendorId === vendorIdString,
    });

    // Check if vendor matches either assignedTechnician or assignedVendor
    const isAuthorized =
      assignedTechnicianId === vendorIdString || assignedVendorId === vendorIdString;

    if (!isAuthorized) {
      console.log('Debug - Authorization failed:', {
        assignedTechnicianId,
        assignedVendorId,
        vendorIdString,
        matchTechnician: assignedTechnicianId === vendorIdString,
        matchVendor: assignedVendorId === vendorIdString,
      });
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to request pickup for this service request.',
      });
    }

    // Validate status based on service type
    // For pickup-drop: Allow Assigned, Scheduled, or In Progress (vendor accepts -> Assigned, then can request pickup)
    // For other types: Only allow Scheduled or In Progress (to maintain existing behavior)
    const statusLower = serviceRequest.status?.toLowerCase() || '';

    if (serviceRequest.serviceType === 'pickup-drop') {
      // For pickup-drop, allow Assigned, Scheduled, or In Progress (case-insensitive)
      const validStatuses = ['assigned', 'scheduled', 'in progress', 'inprogress'];
      const normalizedStatus = statusLower.replace(/\s+/g, ' ').trim();
      const isValidStatus = validStatuses.some(
        valid => normalizedStatus === valid || normalizedStatus === valid.replace(/\s+/g, '')
      );

      if (!isValidStatus) {
        return res.status(400).json({
          success: false,
          message:
            'Pickup can only be requested for assigned, scheduled, or in-progress service requests.',
        });
      }

      // Additional check: Ensure user has accepted the schedule
      const scheduleAccepted =
        serviceRequest.scheduleStatus === 'accepted' ||
        serviceRequest.scheduleStatus === 'scheduled' ||
        (serviceRequest.scheduleStatus === 'proposed' &&
          serviceRequest.userResponse &&
          serviceRequest.userResponse.status === 'accepted');

      if (!scheduleAccepted) {
        return res.status(400).json({
          success: false,
          message: 'Pickup can only be requested after the customer has accepted the schedule.',
        });
      }
    } else {
      // For other service types (onsite, visit-shop), maintain existing validation
      // Only allow Scheduled or In Progress (case-insensitive)
      const normalizedStatus = statusLower.replace(/\s+/g, ' ').trim();
      if (
        normalizedStatus !== 'scheduled' &&
        normalizedStatus !== 'in progress' &&
        normalizedStatus !== 'inprogress'
      ) {
        return res.status(400).json({
          success: false,
          message: 'Pickup can only be requested for scheduled or in-progress service requests.',
        });
      }
    }

    // CONSENT GUARD: Vendor must have obtained customer consent before requesting captain
    const pickupConsentStatus = (serviceRequest as any).pickupConsent?.status || 'none';
    if (
      pickupConsentStatus !== 'customer_confirmed_now' &&
      pickupConsentStatus !== 'slot_approved'
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Customer consent is required before dispatching a captain. Use "Should I send captain now?" first.',
      });
    }

    // If pickup was previously rejected, reset the pickup request
    if (serviceRequest.captainPickupRequest?.status === 'rejected') {
      serviceRequest.captainPickupRequest = undefined;
    }

    // Update service request with pickup request
    serviceRequest.status = 'Pickup Requested';
    serviceRequest.captainPickupRequest = {
      requestedAt: new Date(),
      requestedBy: vendor._id, // Use vendor ID instead of user ID
      pickupAddress: pickupAddress || serviceRequest.address,
      pickupCoordinates: {
        latitude: serviceRequest.customerLocation.latitude,
        longitude: serviceRequest.customerLocation.longitude,
      },
      pickupNotes: pickupNotes || '',
      estimatedPickupTime: estimatedPickupTime
        ? new Date(estimatedPickupTime)
        : new Date(Date.now() + 2 * 60 * 60 * 1000), // Default 2 hours from now
      status: 'pending',
    };

    await serviceRequest.save();

    // Real-time: notify customer that captain pickup has been requested
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Pickup Requested');

    // Real-time: notify all available captains of new pickup request
    const pickupIo = req.app.get('socketio') || (global as any).io;
    if (pickupIo) {
      pickupIo.to('captain-new-requests').emit('new_captain_request', {
        type: 'pickup',
        serviceRequestId: (serviceRequest as any)._id?.toString(),
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({
      success: true,
      message: 'Captain pickup requested successfully.',
      serviceRequest: serviceRequest,
    });
  } catch (error: any) {
    console.error('Request captain pickup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to request captain pickup.',
      error: error.message,
    });
  }
};

// Captain accepts pickup request
export const acceptPickupRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Prevent accepting pickup on Visit-Shop requests (they only have drop requests)
    if (serviceRequest.serviceType === 'visit-shop') {
      return res.status(400).json({
        success: false,
        message:
          'Visit-Shop requests do not have pickup requests. Only drop requests are available after repair completion.',
      });
    }

    if (
      !serviceRequest.captainPickupRequest ||
      serviceRequest.captainPickupRequest.status !== 'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'No pending pickup request found for this service request.',
      });
    }

    // Assign captain and update status
    serviceRequest.assignedCaptain = captain._id;
    serviceRequest.captainPickupRequest.captainId = captain._id; // track for payment
    serviceRequest.captainPickupRequest.status = 'assigned';
    serviceRequest.status = 'Pickup Initiated';

    // Mark captain as on trip so they cannot go offline until order completes
    captain.availability = 'On Trip';

    await Promise.all([serviceRequest.save(), captain.save()]);

    // Real-time: notify customer that captain is on the way for pickup
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Pickup Initiated');
    // Also notify vendor dashboard so they see pickup is in progress
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'pickup_initiated',
      (serviceRequest as any)._id?.toString()
    );

    res.status(200).json({
      success: true,
      message: 'Pickup request accepted successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error accepting pickup request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept pickup request.',
      error: error.message,
    });
  }
};

// Captain rejects pickup request
export const rejectPickupRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (
      !serviceRequest.captainPickupRequest ||
      serviceRequest.captainPickupRequest.status !== 'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'No pending pickup request found for this service request.',
      });
    }

    // Update pickup request status to rejected
    serviceRequest.captainPickupRequest.status = 'rejected';
    serviceRequest.captainPickupRequest.rejectionReason = rejectionReason || 'No reason provided';
    serviceRequest.captainPickupRequest.rejectedBy = captain._id;
    serviceRequest.captainPickupRequest.rejectedAt = new Date();

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Pickup request rejected successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error rejecting pickup request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject pickup request.',
      error: error.message,
    });
  }
};

// Assign captain to pickup request
export const assignCaptainToPickup = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { captainId } = req.body;
    const adminId = req.user?.userId;

    if (!id || !captainId) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID and captain ID are required.',
      });
    }

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (
      !serviceRequest.captainPickupRequest ||
      serviceRequest.captainPickupRequest.status !== 'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'No pending pickup request found for this service request.',
      });
    }

    // Assign captain and update status
    serviceRequest.assignedCaptain = captainId;
    serviceRequest.captainPickupRequest.status = 'assigned';
    serviceRequest.status = 'Pickup Initiated';

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Captain assigned to pickup successfully.',
      serviceRequest: serviceRequest,
    });
  } catch (error: any) {
    console.error('Assign captain to pickup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign captain to pickup.',
      error: error.message,
    });
  }
};

// Captain marks reached customer (for pickup requests)
export const markReachedCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const captainId = req.user?.userId;

    console.log('markReachedCustomer called:', { id, captainId });

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    console.log('Service request found:', {
      id: serviceRequest._id,
      serviceType: serviceRequest.serviceType,
      assignedCaptain: serviceRequest.assignedCaptain?.toString(),
      captainId: captain._id.toString(),
      pickupRequestStatus: serviceRequest.captainPickupRequest?.status,
      hasPickupRequest: !!serviceRequest.captainPickupRequest,
    });

    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      console.log('Authorization failed:', {
        assignedCaptain: serviceRequest.assignedCaptain?.toString(),
        captainId: captain._id.toString(),
      });
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    if (!serviceRequest.captainPickupRequest) {
      console.log('No pickup request found');
      return res.status(400).json({
        success: false,
        message: 'No pickup request found for this service request.',
      });
    }

    if (serviceRequest.captainPickupRequest.status !== 'assigned') {
      console.log('Invalid pickup status:', serviceRequest.captainPickupRequest.status);
      return res.status(400).json({
        success: false,
        message: `Pickup request must be assigned before marking reached customer. Current status: ${serviceRequest.captainPickupRequest.status}`,
      });
    }

    serviceRequest.captainPickupRequest.status = 'reached_customer';
    serviceRequest.captainPickupRequest.reachedCustomerAt = new Date();
    serviceRequest.status = 'Captain Reached Customer';

    await serviceRequest.save();

    // Real-time: notify customer that captain has arrived
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Captain Reached Customer');

    console.log('Successfully marked reached customer');

    res.status(200).json({
      success: true,
      message: 'Reached customer marked successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking reached customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark reached customer.',
      error: error.message,
    });
  }
};

// Complete pickup
export const completePickup = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { captainNotes } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned captain (compare captain IDs)
    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to complete pickup for this service request.',
      });
    }

    if (
      !serviceRequest.captainPickupRequest ||
      (serviceRequest.captainPickupRequest.status !== 'reached_customer' &&
        serviceRequest.captainPickupRequest.status !== 'assigned')
    ) {
      return res.status(400).json({
        success: false,
        message: 'Pickup request must be in assigned or reached_customer status before completing.',
      });
    }

    // Check if customer pickup images are uploaded (mandatory)
    const customerPickupImages = (serviceRequest.deviceHandoverImages as any)?.customerPickup;
    if (!customerPickupImages || !customerPickupImages.isComplete) {
      return res.status(400).json({
        success: false,
        message:
          'Device handover images are mandatory before completing pickup. Please upload images first.',
        requiredCheckpoint: 'customerPickup',
      });
    }

    // Complete pickup
    serviceRequest.captainPickupRequest.status = 'completed';
    serviceRequest.captainPickupRequest.captainNotes = captainNotes || '';
    serviceRequest.status = 'Pickup Done';

    await serviceRequest.save();

    // Credit ₹150 to the pickup captain's wallet
    const pickupCaptainId = (serviceRequest.captainPickupRequest as any).captainId;
    if (pickupCaptainId) {
      const creditResult = await creditCaptainWallet(
        pickupCaptainId.toString(),
        (serviceRequest as any)._id.toString(),
        'pickup',
        serviceRequest.serviceType as 'pickup-drop' | 'visit-shop'
      );
      if (!creditResult.success) {
        console.error('Failed to credit pickup captain wallet:', creditResult.error);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Pickup completed successfully.',
      serviceRequest: serviceRequest,
    });
  } catch (error: any) {
    console.error('Complete pickup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete pickup.',
      error: error.message,
    });
  }
};

// Get pickup requests for captains
// Get captain's assigned pickup jobs
export const getCaptainAssignedJobs = async (req: AuthRequest, res: Response) => {
  try {
    const captainId = req.user?.userId;

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    // Find service requests assigned to this captain (both pickup and drop)
    const assignedJobs = await ServiceRequest.find({
      assignedCaptain: captain._id,
      $or: [
        {
          'captainPickupRequest.status': {
            $in: [
              'assigned',
              'reached_customer',
              'pickup_done',
              'reached_vendor',
              'handover_to_vendor',
              'in_progress',
              'completed',
            ],
          },
        },
        {
          'captainDropRequest.status': {
            $in: [
              'assigned',
              'reached_vendor',
              'handover_complete',
              'pickup_done',
              'in_progress',
              'completed',
            ],
          },
        },
      ],
    })
      .populate('assignedTechnician', 'pocInfo businessDetails')
      .populate('assignedVendor', 'pocInfo businessDetails')
      .populate('customerId', 'username email phone')
      .sort({
        'captainPickupRequest.requestedAt': -1,
        'captainDropRequest.requestedAt': -1,
      });

    res.status(200).json({
      success: true,
      data: assignedJobs,
    });
  } catch (error: any) {
    console.error('Get captain assigned jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned jobs.',
      error: error.message,
    });
  }
};

// Get pickup requests for captains
export const getPickupRequests = async (req: AuthRequest, res: Response) => {
  try {
    const captainId = req.user?.userId;

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Check captain availability — offline captains don't receive new requests
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (captain && captain.availability === 'Offline') {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'Go online to receive pickup requests.',
      });
    }

    // Find service requests with pending pickup requests
    // CRITICAL: Only return requests where vendor has accepted AND clicked "Request Captain"
    // This query ensures requests are NOT visible until vendor explicitly requests captain
    // Key requirements:
    // 1. captainPickupRequest must exist (created only when vendor clicks "Request Captain")
    // 2. captainPickupRequest.status must be 'pending' (not assigned yet)
    // 3. captainPickupRequest.requestedBy must exist (set when vendor requests captain)
    // 4. status must be EXACTLY 'Pickup Requested' (set ONLY when vendor requests captain, NOT when vendor accepts)
    // 5. assignedTechnician OR assignedVendor must exist (vendor has accepted)
    const allPickupRequests = await ServiceRequest.find({
      $and: [
        { captainPickupRequest: { $exists: true, $ne: null } }, // Ensure captainPickupRequest exists
        { 'captainPickupRequest.status': 'pending' }, // Must be pending status (not assigned to captain yet)
        { 'captainPickupRequest.requestedBy': { $exists: true, $ne: null } }, // Ensure vendor has requested (set in requestCaptainPickup)
        { serviceType: 'pickup-drop' }, // Only pickup-drop requests
        { status: 'Pickup Requested' }, // EXACTLY 'Pickup Requested' - set ONLY when vendor clicks "Request Captain" (NOT 'Assigned' or 'In Progress')
        {
          $or: [
            { assignedTechnician: { $exists: true, $ne: null } }, // Must have assignedTechnician
            { assignedVendor: { $exists: true, $ne: null } }, // Or assignedVendor
          ],
        }, // CRITICAL: Ensure vendor has accepted the request
      ],
    })
      .populate('assignedTechnician', 'pocInfo businessDetails')
      .populate('assignedVendor', 'pocInfo businessDetails')
      .populate('customerId', 'username email phone')
      .sort({ 'captainPickupRequest.requestedAt': -1 });

    // CRITICAL: Additional filter to ensure:
    // 1. Request has assigned vendor/technician
    // 2. captainPickupRequest.requestedBy matches assigned vendor (ensures vendor who accepted is the one who requested captain)
    const pickupRequests = allPickupRequests.filter((request: any) => {
      const hasAssignedVendor = request.assignedTechnician || request.assignedVendor;

      // Check if requestedBy matches assigned vendor
      const requestedByVendorId = request.captainPickupRequest?.requestedBy?.toString();
      const assignedTechnicianId =
        request.assignedTechnician?._id?.toString() ||
        (request.assignedTechnician as any)?.toString();
      const assignedVendorId =
        request.assignedVendor?._id?.toString() || (request.assignedVendor as any)?.toString();

      const requestedByMatchesVendor =
        requestedByVendorId &&
        (requestedByVendorId === assignedTechnicianId || requestedByVendorId === assignedVendorId);

      // Ensure status is exactly 'Pickup Requested' (double-check)
      const hasCorrectStatus = request.status === 'Pickup Requested';

      if (!hasAssignedVendor || !requestedByMatchesVendor || !hasCorrectStatus) {
        console.warn('Filtered out invalid pickup request:', {
          id: request._id,
          status: request.status,
          hasAssignedTechnician: !!request.assignedTechnician,
          hasAssignedVendor: !!request.assignedVendor,
          requestedByVendorId,
          assignedTechnicianId,
          assignedVendorId,
          requestedByMatchesVendor,
          hasCorrectStatus,
        });
        return false;
      }

      return true;
    });

    // Enhanced logging to debug any issues
    console.log('=== PICKUP REQUESTS QUERY RESULTS ===');
    console.log('Total pickup requests found (before filter):', allPickupRequests.length);
    console.log('Total pickup requests found (after filter):', pickupRequests.length);
    pickupRequests.forEach((r: any, index: number) => {
      console.log(`Request ${index + 1}:`, {
        id: r._id,
        status: r.status,
        serviceType: r.serviceType,
        pickupRequestStatus: r.captainPickupRequest?.status,
        hasAssignedTechnician: !!r.assignedTechnician,
        hasAssignedVendor: !!r.assignedVendor,
        assignedTechnicianId: r.assignedTechnician?._id || r.assignedTechnician,
        assignedVendorId: r.assignedVendor?._id || r.assignedVendor,
        requestedBy: r.captainPickupRequest?.requestedBy,
      });
    });
    console.log('=====================================');

    res.status(200).json({
      success: true,
      data: pickupRequests,
    });
  } catch (error: any) {
    console.error('Get pickup requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pickup requests.',
      error: error.message,
    });
  }
};

// Captain marks pickup as done
export const markPickupDone = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { captainNotes } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned captain (compare captain IDs)
    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    if (
      !serviceRequest.captainPickupRequest ||
      (serviceRequest.captainPickupRequest.status !== 'assigned' &&
        serviceRequest.captainPickupRequest.status !== 'reached_customer')
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Pickup request must be in assigned or reached_customer status before marking done.',
      });
    }

    // Update pickup status to pickup_done (not completed yet - still need to deliver to vendor)
    serviceRequest.captainPickupRequest.status = 'pickup_done';
    serviceRequest.captainPickupRequest.captainNotes = captainNotes || '';
    serviceRequest.status = 'Pickup Done';

    await serviceRequest.save();

    // Real-time: notify customer that device has been picked up
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Pickup Done');
    captainupdates(serviceRequest?.vendorId, 'mark-pickup-done');

    res.status(200).json({
      success: true,
      message: 'Pickup marked as done successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking pickup as done:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark pickup as done.',
      error: error.message,
    });
  }
};

// Captain marks device as delivered
export const markDeviceDelivered = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { deliveryNotes } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned captain (compare captain IDs)
    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    if (
      !serviceRequest.captainPickupRequest ||
      serviceRequest.captainPickupRequest.status !== 'in_progress'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Pickup must be marked as done before delivery.',
      });
    }

    // Check if customer delivery images are uploaded (mandatory)
    const customerDeliveryImages = (serviceRequest.deviceHandoverImages as any)?.customerDelivery;
    if (!customerDeliveryImages || !customerDeliveryImages.isComplete) {
      return res.status(400).json({
        success: false,
        message:
          'Device handover images are mandatory before marking delivery. Please upload images first.',
        requiredCheckpoint: 'customerDelivery',
      });
    }

    // Update pickup status to completed
    serviceRequest.captainPickupRequest.status = 'completed';
    serviceRequest.captainPickupRequest.deliveryNotes = deliveryNotes || '';
    serviceRequest.status = 'Device Delivered';

    // Trip done — captain is free to go offline or take new trips
    captain.availability = 'Available';

    await Promise.all([serviceRequest.save(), captain.save()]);

    // Real-time: notify customer and vendor
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Device Delivered');
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'device_delivered',
      (serviceRequest as any)._id?.toString()
    );

    res.status(200).json({
      success: true,
      message: 'Device marked as delivered successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking device as delivered:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark device as delivered.',
      error: error.message,
    });
  }
};
export const startProblemVerification = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const technicianId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!technicianId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the vendor profile for this user
    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned technician
    if (serviceRequest.assignedTechnician?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to verify problems for this service request.',
      });
    }

    // Determine valid statuses based on service type
    // CRITICAL: Vendor can only start verification after device is physically accessible
    let validStatuses: string[];
    let errorMessage: string;

    if (serviceRequest.serviceType === 'pickup-drop') {
      // Pickup-drop: Only allow after device is received at vendor shop
      validStatuses = ['Device Received'];
      errorMessage =
        'Problem verification can only be started after the device is received at the shop. Please wait for the captain to deliver the device.';
    } else if (serviceRequest.serviceType === 'visit-shop') {
      // Visit-shop: Customer brings device to shop, vendor can verify once device is at shop
      validStatuses = ['Assigned', 'In Progress', 'Device Received'];
      errorMessage =
        'Problem verification can only be started when the service request is assigned or in progress (device must be at the shop).';
    } else if (serviceRequest.serviceType === 'onsite') {
      // Onsite: Vendor goes to customer location, can verify once at customer location with device
      validStatuses = ['In Progress', 'Device Received', 'Arrived at Customer'];
      errorMessage =
        'Problem verification can only be started when the service is in progress (vendor must be at customer location with device).';
    } else {
      // Fallback for any other service types
      validStatuses = ['Pickup Done'];
      errorMessage = 'Problem verification can only be started after pickup is done.';
    }

    if (!validStatuses.includes(serviceRequest.status)) {
      return res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }

    // Start verification timer (1 hour for known problems)
    serviceRequest.status = 'Problem Verification';
    serviceRequest.verificationTimer = {
      startTime: new Date(),
      duration: 60, // 60 minutes
      isActive: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    };

    await serviceRequest.save();

    // Real-time: notify customer that vendor started problem verification
    emitStatusUpdate((global as any).io, serviceRequest, 'Problem Verification');

    // Reload the service request to ensure verificationTimer is properly populated
    const updatedRequest = await ServiceRequest.findById(serviceRequest._id);

    // Convert to plain object to ensure verificationTimer is properly serialized
    const serviceRequestData = updatedRequest?.toObject
      ? updatedRequest.toObject()
      : updatedRequest || serviceRequest;

    res.status(200).json({
      success: true,
      message: 'Problem verification started. You have 1 hour to verify the problem.',
      serviceRequest: serviceRequestData,
    });
  } catch (error: any) {
    console.error('Error starting problem verification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start problem verification.',
      error: error.message,
    });
  }
};

// Vendor completes problem verification
export const completeProblemVerification = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { verificationNotes, problemConfirmed } = req.body;
    const technicianId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!technicianId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the vendor profile for this user
    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned technician
    if (serviceRequest.assignedTechnician?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to verify problems for this service request.',
      });
    }

    if (serviceRequest.status !== 'Problem Verification') {
      return res.status(400).json({
        success: false,
        message: 'No active problem verification found for this service request.',
      });
    }

    // Complete verification
    serviceRequest.status = 'Repair Started';
    serviceRequest.verificationTimer.isActive = false;
    serviceRequest.verificationTimer.endTime = new Date();
    serviceRequest.verificationNotes = verificationNotes || '';
    serviceRequest.problemConfirmed = problemConfirmed || false;

    await serviceRequest.save();

    // Real-time: notify customer that repair has started
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Repair Started');

    res.status(200).json({
      success: true,
      message: 'Problem verification completed successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error completing problem verification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete problem verification.',
      error: error.message,
    });
  }
};

// Vendor requests captain drop
export const requestCaptainDrop = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { dropNotes, estimatedDropTime } = req.body;
    const technicianId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!technicianId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the vendor profile for this user
    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned technician
    if (serviceRequest.assignedTechnician?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to request drop for this service request.',
      });
    }

    // For Visit-Shop: only allowed when customer has explicitly chosen captain-delivery
    if (serviceRequest.serviceType === 'visit-shop') {
      if (serviceRequest.postRepairDeliveryPreference !== 'captain-delivery') {
        return res.status(400).json({
          success: false,
          message:
            'For Visit-Shop requests, drop can only be requested after the customer has chosen captain delivery.',
        });
      }
    }

    // For Onsite, no captain drop is needed since the technician is at the customer's location
    if (serviceRequest.serviceType === 'onsite') {
      return res.status(400).json({
        success: false,
        message:
          "For Onsite requests, captain drop is not applicable. The technician is already at the customer's location.",
      });
    }

    // For Pickup-Drop, allow vendor to request drop after repair is done
    if (serviceRequest.status !== 'Repair Done') {
      return res.status(400).json({
        success: false,
        message: 'Drop can only be requested after repair is done.',
      });
    }

    // CONSENT GUARD: Vendor must have obtained customer consent before dispatching captain for drop
    const dropConsentStatus = (serviceRequest as any).dropConsent?.status || 'none';
    if (dropConsentStatus !== 'customer_confirmed_now' && dropConsentStatus !== 'slot_approved') {
      return res.status(403).json({
        success: false,
        message:
          'Customer consent is required before dispatching a captain for drop. Use "Should I send captain now?" first.',
      });
    }

    // Update service request with drop request
    serviceRequest.status = 'Drop Requested';
    serviceRequest.captainDropRequest = {
      requestedAt: new Date(),
      requestedBy: vendor._id,
      vendorAddress: vendor.pocInfo.correspondenceAddress,
      vendorCoordinates: {
        latitude: vendor.currentLocation?.latitude || 0,
        longitude: vendor.currentLocation?.longitude || 0,
      },
      customerAddress: serviceRequest.address,
      customerCoordinates: {
        latitude: serviceRequest.customerLocation?.latitude || serviceRequest.latitude || 0,
        longitude: serviceRequest.customerLocation?.longitude || serviceRequest.longitude || 0,
      },
      dropNotes: dropNotes || '',
      estimatedDropTime: estimatedDropTime
        ? new Date(estimatedDropTime)
        : new Date(Date.now() + 2 * 60 * 60 * 1000), // Default 2 hours from now
      status: 'pending',
    };

    await serviceRequest.save();

    // Real-time: notify customer that drop captain has been requested
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Drop Requested');

    // Real-time: notify all available captains of new drop request
    const dropIo = req.app.get('socketio') || (global as any).io;
    if (dropIo) {
      dropIo.to('captain-new-requests').emit('new_captain_request', {
        type: 'drop',
        serviceRequestId: (serviceRequest as any)._id?.toString(),
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({
      success: true,
      message: 'Captain drop requested successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error requesting captain drop:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to request captain drop.',
      error: error.message,
    });
  }
};

// Captain accepts drop request
export const acceptDropRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (
      !serviceRequest.captainDropRequest ||
      serviceRequest.captainDropRequest.status !== 'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'No pending drop request found for this service request.',
      });
    }

    // Assign captain and update status
    serviceRequest.assignedCaptain = captain._id;
    serviceRequest.captainDropRequest.captainId = captain._id; // track for payment
    serviceRequest.captainDropRequest.status = 'assigned';

    // For Visit-Shop, status should remain 'Drop Requested' or go to 'Drop Initiated'
    // For Pickup-Drop, status should be 'Drop Initiated'
    if (serviceRequest.serviceType === 'visit-shop') {
      // Visit-Shop post-repair delivery: status should be 'Drop Initiated' (not regress)
      serviceRequest.status = 'Drop Initiated';
    } else {
      // Pickup-Drop: normal flow
      serviceRequest.status = 'Drop Initiated';
    }

    // Mark captain as on trip so they cannot go offline until order completes
    captain.availability = 'On Trip';

    await Promise.all([serviceRequest.save(), captain.save()]);

    // Real-time: notify customer AND vendor that drop captain is on the way
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Drop Initiated');
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'drop_initiated',
      (serviceRequest as any)._id?.toString()
    );

    res.status(200).json({
      success: true,
      message: 'Drop request accepted successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error accepting drop request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept drop request.',
      error: error.message,
    });
  }
};

// Captain rejects drop request
export const rejectDropRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (
      !serviceRequest.captainDropRequest ||
      serviceRequest.captainDropRequest.status !== 'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'No pending drop request found for this service request.',
      });
    }

    // Update drop request status to rejected
    serviceRequest.captainDropRequest.status = 'rejected';
    serviceRequest.captainDropRequest.rejectionReason = rejectionReason || 'No reason provided';
    serviceRequest.captainDropRequest.rejectedBy = captain._id;
    serviceRequest.captainDropRequest.rejectedAt = new Date();

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Drop request rejected successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error rejecting drop request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject drop request.',
      error: error.message,
    });
  }
};

// Captain marks reached vendor for first drop (after pickup from customer)
export const markReachedVendorForPickup = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    // This is for first drop phase (after pickup from customer)
    if (
      !serviceRequest.captainPickupRequest ||
      serviceRequest.captainPickupRequest.status !== 'pickup_done'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Pickup must be done before marking reached vendor for first drop.',
      });
    }

    serviceRequest.captainPickupRequest.status = 'reached_vendor';
    serviceRequest.captainPickupRequest.reachedVendorAt = new Date();
    serviceRequest.status = 'Captain Reached Vendor (Pickup)';

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Reached vendor marked successfully for first drop.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking reached vendor for pickup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark reached vendor.',
      error: error.message,
    });
  }
};

// Captain marks handover to vendor (for first drop - after pickup from customer)
export const markHandoverToVendor = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    // This is for first drop phase (after pickup from customer)
    if (
      !serviceRequest.captainPickupRequest ||
      serviceRequest.captainPickupRequest.status !== 'reached_vendor'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Captain must reach vendor before handover can be completed.',
      });
    }

    // Check if delivery to technician images are uploaded (mandatory)
    const deliveryToTechnicianImages = (serviceRequest.deviceHandoverImages as any)
      ?.deliveryToTechnician;
    if (!deliveryToTechnicianImages || !deliveryToTechnicianImages.isComplete) {
      return res.status(400).json({
        success: false,
        message:
          'Device handover images are mandatory before handing over to technician. Please upload images first.',
        requiredCheckpoint: 'deliveryToTechnician',
      });
    }

    // Pickup leg is complete — device is now with vendor
    serviceRequest.captainPickupRequest.status = 'completed';
    serviceRequest.captainPickupRequest.handoverToVendorAt = new Date();
    serviceRequest.status = 'Device Received';

    // Pickup trip done — captain is free to go offline or take new trips
    captain.availability = 'Available';

    await Promise.all([serviceRequest.save(), captain.save()]);

    // Real-time: notify customer AND vendor that device has been received
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Device Received');
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'device_received',
      (serviceRequest as any)._id?.toString()
    );

    // Credit the pickup captain's wallet immediately — this trip is independent of the drop
    const pickupCaptainId = (serviceRequest.captainPickupRequest as any).captainId;
    if (pickupCaptainId) {
      const creditResult = await creditCaptainWallet(
        pickupCaptainId.toString(),
        (serviceRequest as any)._id.toString(),
        'pickup',
        serviceRequest.serviceType as 'pickup-drop' | 'visit-shop'
      );
      if (!creditResult.success) {
        console.error('Failed to credit pickup captain wallet after handover:', creditResult.error);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Device handed over to vendor. Pickup trip completed and earnings credited.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking handover to vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark handover to vendor.',
      error: error.message,
    });
  }
};

// Captain marks reached vendor (for second drop - after repair)
export const markReachedVendor = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    if (
      !serviceRequest.captainDropRequest ||
      serviceRequest.captainDropRequest.status !== 'assigned'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Drop request must be assigned before marking reached vendor.',
      });
    }

    serviceRequest.captainDropRequest.status = 'reached_vendor';
    serviceRequest.captainDropRequest.reachedVendorAt = new Date();
    serviceRequest.status = 'Captain Reached Vendor';

    await serviceRequest.save();

    // Real-time: notify customer that captain has reached vendor for return pickup
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Captain Reached Vendor');

    res.status(200).json({
      success: true,
      message: 'Reached vendor marked successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking reached vendor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark reached vendor.',
      error: error.message,
    });
  }
};

// Vendor marks handover to captain
export const handoverToCaptain = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const technicianId = req.user?.userId;
    const io = (global as any).io;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!technicianId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': technicianId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (
      serviceRequest.assignedTechnician?.toString() !== vendor._id.toString() &&
      serviceRequest.assignedVendor?.toString() !== vendor._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to handover this service request.',
      });
    }

    if (
      !serviceRequest.captainDropRequest ||
      serviceRequest.captainDropRequest.status !== 'reached_vendor'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Captain must reach vendor before handover can be completed.',
      });
    }

    // Note: Image uploads are now handled by captain only, not vendor
    serviceRequest.captainDropRequest.status = 'handover_complete';
    serviceRequest.captainDropRequest.handoverCompletedAt = new Date();
    serviceRequest.status = 'Handover to Captain';

    await serviceRequest.save();

    // Real-time: notify customer that device has been handed to the return captain
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Handover to Captain');

    // Real-time: notify the assigned drop captain to refresh their dashboard
    const _dropCaptainObjectId = (serviceRequest.captainDropRequest as any).captainId;
    if (_dropCaptainObjectId) {
      const _dropCaptainDoc =
        await Captain.findById(_dropCaptainObjectId).select('personalInfo.userId');
      if (_dropCaptainDoc?.personalInfo?.userId) {
        const _captainIo = req.app.get('socketio') || (global as any).io;
        if (_captainIo) {
          _captainIo.to(`user-${_dropCaptainDoc.personalInfo.userId}`).emit('notification', {
            type: 'handover_to_captain',
            message: 'The vendor has handed over the device. You can now pick it up.',
            serviceRequestId: (serviceRequest as any).request_id || serviceRequest._id?.toString(),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    io.emit('handover_to_captain', () => {
      console.log('Emitted handover_to_captain event to all captains');
    });

    res.status(200).json({
      success: true,
      message:
        'Device handed over to captain successfully. Your role in this request is now complete.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error handing over to captain:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to handover to captain.',
      error: error.message,
    });
  }
};

// Captain marks pickup done from vendor
export const markCaptainPickupDone = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { captainNotes } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    if (
      !serviceRequest.captainDropRequest ||
      serviceRequest.captainDropRequest.status !== 'handover_complete'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Handover must be completed before marking pickup done.',
      });
    }

    // Check if return pickup from technician images are uploaded (mandatory)
    const returnPickupImages = (serviceRequest.deviceHandoverImages as any)
      ?.returnPickupFromTechnician;
    if (!returnPickupImages || !returnPickupImages.isComplete) {
      return res.status(400).json({
        success: false,
        message:
          'Device handover images are mandatory before marking pickup done. Please upload images first.',
        requiredCheckpoint: 'returnPickupFromTechnician',
      });
    }

    serviceRequest.captainDropRequest.status = 'pickup_done';
    serviceRequest.captainDropRequest.pickupDoneAt = new Date();
    serviceRequest.captainDropRequest.captainNotes = captainNotes || '';
    serviceRequest.status = 'Captain Pickup Done';

    await serviceRequest.save();

    // Real-time: notify customer that captain has picked up repaired device
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Captain Pickup Done');

    res.status(200).json({
      success: true,
      message: 'Pickup from vendor marked as done successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking captain pickup done:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark pickup done.',
      error: error.message,
    });
  }
};

// Captain starts delivery (updates status to in_progress)
export const startDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this service request.',
      });
    }

    if (
      !serviceRequest.captainDropRequest ||
      serviceRequest.captainDropRequest.status !== 'pickup_done'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Pickup from vendor must be completed before starting delivery.',
      });
    }

    serviceRequest.captainDropRequest.status = 'in_progress';
    // Status remains 'Captain Pickup Done' until delivery is completed

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Delivery started successfully. Navigate to customer location.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error starting delivery:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start delivery.',
      error: error.message,
    });
  }
};

// Captain marks drop as delivered
export const markDropDelivered = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { deliveryNotes } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the captain profile for this user
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned captain
    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to deliver this service request.',
      });
    }

    // Check if drop request is in a valid state for delivery
    const validStatuses = [
      'assigned',
      'reached_vendor',
      'handover_complete',
      'pickup_done',
      'in_progress',
    ];
    if (
      !serviceRequest.captainDropRequest ||
      !validStatuses.includes(serviceRequest.captainDropRequest.status)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Drop request must be in progress before it can be marked as delivered.',
      });
    }

    // Check if customer delivery images are uploaded (mandatory)
    const customerDeliveryImages = (serviceRequest.deviceHandoverImages as any)?.customerDelivery;
    if (!customerDeliveryImages || !customerDeliveryImages.isComplete) {
      return res.status(400).json({
        success: false,
        message:
          'Device handover images are mandatory before marking delivery. Please upload images first.',
        requiredCheckpoint: 'customerDelivery',
      });
    }

    // Update drop status to completed
    serviceRequest.captainDropRequest.status = 'completed';
    serviceRequest.captainDropRequest.deliveryNotes = deliveryNotes || '';
    serviceRequest.status = 'Device Delivered';

    // Auto-complete the service request
    serviceRequest.status = 'Completed';
    serviceRequest.completedAt = new Date();

    // Drop trip done — captain is free to go offline or take new trips
    captain.availability = 'Available';

    await Promise.all([serviceRequest.save(), captain.save()]);

    // Real-time: notify customer AND vendor that service is complete
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Completed');
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'completed',
      (serviceRequest as any)._id?.toString()
    );
    // Also notify admin dashboard
    emitAdminNotification('service_request_completed', {
      serviceRequestId: (serviceRequest as any)._id?.toString(),
      requestId: serviceRequest.request_id,
    });

    // Credit ₹150 to the drop captain's wallet
    const dropCaptainId = (serviceRequest.captainDropRequest as any).captainId;
    if (dropCaptainId) {
      const creditResult = await creditCaptainWallet(
        dropCaptainId.toString(),
        (serviceRequest as any)._id.toString(),
        'drop',
        serviceRequest.serviceType as 'pickup-drop' | 'visit-shop'
      );
      if (!creditResult.success) {
        console.error('Failed to credit drop captain wallet:', creditResult.error);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Device marked as delivered successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking drop as delivered:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark drop as delivered.',
      error: error.message,
    });
  }
};

// Get drop requests for captains
export const getDropRequests = async (req: AuthRequest, res: Response) => {
  try {
    const captainId = req.user?.userId;

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Check captain availability — offline captains don't receive new requests
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (captain && captain.availability === 'Offline') {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'Go online to receive drop requests.',
      });
    }

    // Find service requests with pending drop requests
    // CRITICAL: Only return requests where vendor has completed repair AND clicked "Request Captain"
    // This query ensures requests are NOT visible until vendor explicitly requests captain for drop
    // Key requirements:
    // 1. captainDropRequest must exist (created only when vendor clicks "Request Captain")
    // 2. captainDropRequest.status must be 'pending' (not assigned yet)
    // 3. captainDropRequest.requestedBy must exist (set when vendor requests captain)
    // 4. status must be EXACTLY 'Drop Requested' (set ONLY when vendor requests captain, NOT before repair is done)
    // 5. assignedTechnician OR assignedVendor must exist (vendor has accepted)
    const allDropRequests = await ServiceRequest.find({
      $and: [
        { captainDropRequest: { $exists: true, $ne: null } }, // Ensure captainDropRequest exists
        { 'captainDropRequest.status': 'pending' }, // Must be pending status (not assigned to captain yet)
        { 'captainDropRequest.requestedBy': { $exists: true, $ne: null } }, // Ensure vendor has requested (set in requestCaptainDrop)
        { status: 'Drop Requested' }, // EXACTLY 'Drop Requested' - set ONLY when vendor requests captain (NOT 'Repair Done' or other statuses)
        {
          $or: [
            { assignedTechnician: { $exists: true, $ne: null } }, // Must have assignedTechnician
            { assignedVendor: { $exists: true, $ne: null } }, // Or assignedVendor
          ],
        }, // CRITICAL: Ensure vendor has accepted the request
      ],
    })
      .populate('assignedTechnician', 'pocInfo businessDetails')
      .populate('assignedVendor', 'pocInfo businessDetails')
      .populate('customerId', 'username email phone')
      .sort({ 'captainDropRequest.requestedAt': -1 });

    // CRITICAL: Additional filter to ensure:
    // 1. Request has assigned vendor/technician
    // 2. captainDropRequest.requestedBy matches assigned vendor (ensures vendor who accepted is the one who requested captain)
    const dropRequests = allDropRequests.filter((request: any) => {
      const hasAssignedVendor = request.assignedTechnician || request.assignedVendor;

      // Check if requestedBy matches assigned vendor
      const requestedByVendorId = request.captainDropRequest?.requestedBy?.toString();
      const assignedTechnicianId =
        request.assignedTechnician?._id?.toString() ||
        (request.assignedTechnician as any)?.toString();
      const assignedVendorId =
        request.assignedVendor?._id?.toString() || (request.assignedVendor as any)?.toString();

      const requestedByMatchesVendor =
        requestedByVendorId &&
        (requestedByVendorId === assignedTechnicianId || requestedByVendorId === assignedVendorId);

      // Ensure status is exactly 'Drop Requested' (double-check)
      const hasCorrectStatus = request.status === 'Drop Requested';

      if (!hasAssignedVendor || !requestedByMatchesVendor || !hasCorrectStatus) {
        console.warn('Filtered out invalid drop request:', {
          id: request._id,
          status: request.status,
          hasAssignedTechnician: !!request.assignedTechnician,
          hasAssignedVendor: !!request.assignedVendor,
          requestedByVendorId,
          assignedTechnicianId,
          assignedVendorId,
          requestedByMatchesVendor,
          hasCorrectStatus,
        });
        return false;
      }

      return true;
    });

    console.log('Drop requests found:', {
      countBeforeFilter: allDropRequests.length,
      countAfterFilter: dropRequests.length,
      requests: dropRequests.map(r => ({
        id: r._id,
        serviceType: r.serviceType,
        status: r.status,
        dropRequestStatus: r.captainDropRequest?.status,
        hasAssignedTechnician: !!r.assignedTechnician,
        hasAssignedVendor: !!r.assignedVendor,
      })),
    });

    res.status(200).json({
      success: true,
      data: dropRequests,
    });
  } catch (error: any) {
    console.error('Get drop requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch drop requests.',
      error: error.message,
    });
  }
};

// Vendor submits problem identification with pricing
export const submitProblemIdentification = async (req: AuthRequest, res: Response) => {
  console.log('=== FUNCTION CALLED ===');

  try {
    const { id } = req.params;
    const { identifiedProblem, identificationNotes, estimatedRepairTime, estimatedCost } = req.body;

    console.log('Request data:', { id, identifiedProblem, estimatedCost });

    // Simple validation
    if (!id || !identifiedProblem || !estimatedCost) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // Find service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Update problem identification with all required fields
    serviceRequest.problemIdentification = {
      identifiedProblem,
      identifiedAt: new Date(),
      identifiedBy: req.user?.userId, // Store who identified the problem
      identificationNotes,
      estimatedRepairTime,
      estimatedCost,
      customerApproval: {
        status: 'pending', // Will be handled by admin first
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        customerNotes: null,
      },
    };

    // NEW: Initialize admin review section (admin-mediated flow)
    serviceRequest.adminReviewedIdentification = {
      reviewStatus: 'pending',
      vendorPrice: estimatedCost, // Store vendor's requested price
      reviewedBy: null,
      reviewedAt: null,
      adminNotes: null,
      customerPrice: null,
      adminAdjustments: null,
    };

    // Update status to Admin Review Pending (instead of directly to customer)
    serviceRequest.status = 'Admin Review Pending';

    // Stop the identification timer — vendor has finished their identification
    serviceRequest.isIdentificationTimerActive = false;

    // Add to status history for tracking
    serviceRequest.statusHistory = serviceRequest.statusHistory || [];
    serviceRequest.statusHistory.push({
      status: 'Admin Review Pending',
      timestamp: new Date(),
      notes: `Vendor identified problem: ${identifiedProblem}. Pending admin review.`,
      updatedBy: 'technician',
    });

    // Update the last updated timestamp
    serviceRequest.updatedAt = new Date();

    console.log('Saving to database:', {
      id: serviceRequest._id,
      status: serviceRequest.status,
      problemIdentification: serviceRequest.problemIdentification,
      adminReviewedIdentification: serviceRequest.adminReviewedIdentification,
    });

    await serviceRequest.save();

    console.log('Successfully saved to database');

    // NEW: Notify admins (NOT customer yet)
    try {
      const User = require('../models/user.model').default;
      const admins = await User.find({ role: 'admin' });
      const { createNotification } = require('./notification.controller');

      for (const admin of admins) {
        await createNotification(
          admin._id.toString(),
          'Vendor Identification Submitted',
          `Vendor identified problem for ${serviceRequest.brand} ${serviceRequest.model}: ${identifiedProblem}. Review required before customer notification.`,
          'admin_action_required',
          (serviceRequest as any)._id.toString()
        );
      }

      // Real-time: push to admin dashboard
      emitAdminNotification('vendor_identification_submitted', {
        serviceRequestId: (serviceRequest as any)._id.toString(),
        requestId: serviceRequest.request_id,
        brand: serviceRequest.brand,
        model: serviceRequest.model,
        identifiedProblem,
        estimatedCost,
      });

      // Send email to admin
      const adminEmail = process.env.ADMIN_EMAIL || 'karan@fix4ever.com';
      sendEmailAsync(
        adminEmail,
        'Vendor Identification Requires Review',
        `<h2>Vendor Identification Submitted</h2>
        <p>A vendor has identified a problem that needs your review before customer approval:</p>
        <ul>
          <li><strong>Device:</strong> ${serviceRequest.brand} ${serviceRequest.model}</li>
          <li><strong>Identified Problem:</strong> ${identifiedProblem}</li>
          <li><strong>Vendor's Estimated Cost:</strong> ₹${estimatedCost}</li>
          <li><strong>Estimated Repair Time:</strong> ${estimatedRepairTime || 'Not specified'}</li>
        </ul>
        <p>Please review and set customer pricing in the admin panel.</p>
        <p><a href="${process.env.FRONTEND_URL}/admin/service-requests/${serviceRequest.request_id}">Review Now</a></p>`
      );
    } catch (notificationError: any) {
      console.error('Failed to send admin notifications:', notificationError);
      // Don't fail the request if notifications fail
    }

    res.status(200).json({
      success: true,
      message: 'Problem identification submitted for admin review',
    });
  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// NEW: Admin reviews vendor identification and sets customer price
export const reviewVendorIdentification = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { reviewStatus, customerPrice, adminNotes, adminAdjustments } = req.body;
    const userId = (req.user as any)?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Verify admin
    const User = require('../models/user.model').default;
    const admin = await User.findById(userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    // Validate inputs
    if (!reviewStatus || !['approved', 'rejected', 'needs_revision'].includes(reviewStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review status. Must be: approved, rejected, or needs_revision',
      });
    }

    if (reviewStatus === 'approved' && (!customerPrice || customerPrice <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Customer price is required and must be greater than 0 for approval',
      });
    }

    // Find service request
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId })
      .populate('customerId', 'email username')
      .populate('assignedVendor')
      .populate('assignedTechnician');
    if (!serviceRequest && Types.ObjectId.isValid(requestId)) {
      serviceRequest = await ServiceRequest.findById(requestId)
        .populate('customerId', 'email username')
        .populate('assignedVendor')
        .populate('assignedTechnician');
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    if (serviceRequest.status !== 'Admin Review Pending') {
      return res.status(400).json({
        success: false,
        message:
          'This request is not pending admin review. Current status: ' + serviceRequest.status,
      });
    }

    // Update admin review
    serviceRequest.adminReviewedIdentification.reviewedBy = userId;
    serviceRequest.adminReviewedIdentification.reviewedAt = new Date();
    serviceRequest.adminReviewedIdentification.reviewStatus = reviewStatus;
    serviceRequest.adminReviewedIdentification.adminNotes = adminNotes || '';

    if (reviewStatus === 'approved') {
      serviceRequest.adminReviewedIdentification.customerPrice = customerPrice;
      serviceRequest.adminReviewedIdentification.adminAdjustments = adminAdjustments || '';
      serviceRequest.status = 'Customer Approval Pending';

      // Add to status history
      serviceRequest.statusHistory.push({
        status: 'Customer Approval Pending',
        timestamp: new Date(),
        notes: `Admin approved vendor identification. Customer price set to ₹${customerPrice}`,
        updatedBy: 'admin',
      });

      // Notify customer with admin-approved price
      const customer = serviceRequest.customerId as any;
      const { createNotification } = require('./notification.controller');
      await createNotification(
        customer._id.toString(),
        'Repair Estimate Ready',
        `Your ${serviceRequest.brand} ${serviceRequest.model} has been diagnosed. Problem: ${serviceRequest.problemIdentification.identifiedProblem}. Estimated cost: ₹${customerPrice}. Please review and approve.`,
        'customer_action_required',
        requestId
      );

      // Email customer
      sendEmailAsync(
        customer.email,
        'Repair Estimate Ready for Approval',
        `<h2>Repair Estimate Ready</h2>
        <p>Hi ${customer.username},</p>
        <p>Your device has been diagnosed:</p>
        <ul>
          <li><strong>Device:</strong> ${serviceRequest.brand} ${serviceRequest.model}</li>
          <li><strong>Problem:</strong> ${serviceRequest.problemIdentification.identifiedProblem}</li>
          <li><strong>Estimated Cost:</strong> ₹${customerPrice}</li>
          <li><strong>Estimated Repair Time:</strong> ${serviceRequest.problemIdentification.estimatedRepairTime || 'Not specified'}</li>
        </ul>
        ${adminAdjustments ? `<p><em>${adminAdjustments}</em></p>` : ''}
        <p>Please log in to approve or reject the repair estimate.</p>
        <p><a href="${process.env.FRONTEND_URL}/dashboard/service-requests/${serviceRequest.request_id}">Review Estimate</a></p>`
      );
    } else if (reviewStatus === 'rejected' || reviewStatus === 'needs_revision') {
      serviceRequest.status = 'Problem Identification'; // Send back to vendor

      // Add to status history
      serviceRequest.statusHistory.push({
        status: 'Problem Identification',
        timestamp: new Date(),
        notes: `Admin ${reviewStatus === 'rejected' ? 'rejected' : 'requested revision for'} vendor identification. Reason: ${adminNotes}`,
        updatedBy: 'admin',
      });

      // Notify vendor
      const vendor = (serviceRequest.assignedVendor || serviceRequest.assignedTechnician) as any;
      if (vendor) {
        const { createNotification } = require('./notification.controller');
        await createNotification(
          vendor.pocInfo.userId.toString(),
          'Identification Needs Revision',
          `Admin has ${reviewStatus === 'rejected' ? 'rejected' : 'requested revision for'} ${serviceRequest.brand} ${serviceRequest.model} identification. Notes: ${adminNotes}`,
          'vendor_action_required',
          requestId
        );

        // Email vendor
        sendEmailAsync(
          vendor.pocInfo.email,
          'Problem Identification Needs Revision',
          `<h2>Identification ${reviewStatus === 'rejected' ? 'Rejected' : 'Needs Revision'}</h2>
          <p>Hi ${vendor.pocInfo.fullName},</p>
          <p>The admin has reviewed your problem identification for ${serviceRequest.brand} ${serviceRequest.model}.</p>
          <p><strong>Admin Notes:</strong> ${adminNotes}</p>
          <p>Please review and ${reviewStatus === 'needs_revision' ? 'resubmit' : 'contact admin for more details'}.</p>
          <p><a href="${process.env.FRONTEND_URL}/vendor/service-requests/${serviceRequest._id}">View Request</a></p>`
        );
      }
    }

    serviceRequest.updatedAt = new Date();
    await serviceRequest.save();

    // Real-time: notify relevant parties based on review outcome
    if (reviewStatus === 'approved') {
      // Notify customer their approval is needed (Customer Approval Pending)
      emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Customer Approval Pending');
    } else {
      // Notify vendor their identification was sent back (Problem Identification)
      const vendorDoc = (serviceRequest.assignedVendor || serviceRequest.assignedTechnician) as any;
      const vendorUserId = vendorDoc?.pocInfo?.userId?.toString();
      emitStatusUpdate(
        req.app.get('socketio'),
        serviceRequest,
        'Problem Identification',
        vendorUserId ? [vendorUserId] : []
      );
    }
    // General admin action — triggers refresh on all role pages
    sendServiceRequestNotification((serviceRequest as any).request_id, 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification((serviceRequest as any)._id.toString(), 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'admin_action',
      (serviceRequest as any).request_id
    );

    res.status(200).json({
      success: true,
      message: `Identification ${reviewStatus}`,
      data: serviceRequest,
    });
  } catch (error: any) {
    console.error('Review vendor identification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review identification',
      error: error.message,
    });
  }
};

// Customer approves pricing
export const approvePricing = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { customerNotes } = req.body;
    const userId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the customer
    if (serviceRequest.customerId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to approve pricing for this service request.',
      });
    }

    // NEW: Check for admin-mediated flow
    // If status is 'Customer Approval Pending', this is the new admin-mediated flow
    if (serviceRequest.status === 'Customer Approval Pending') {
      // Verify admin has reviewed and approved
      if (
        !serviceRequest.adminReviewedIdentification ||
        serviceRequest.adminReviewedIdentification.reviewStatus !== 'approved'
      ) {
        return res.status(400).json({
          success: false,
          message: 'Admin review not completed or not approved.',
        });
      }

      // Update customer approval
      serviceRequest.problemIdentification.customerApproval.status = 'approved';
      serviceRequest.problemIdentification.customerApproval.approvedAt = new Date();
      serviceRequest.problemIdentification.customerApproval.customerNotes = customerNotes || '';

      // Calculate service type fee for unknown problem types (249 for pickup-drop, 149 for onsite)
      const serviceTypeFee =
        (serviceRequest as any).serviceType === 'pickup-drop'
          ? 249
          : (serviceRequest as any).serviceType === 'onsite'
            ? 149
            : 0;

      // Set final pricing from admin-approved price + service type fee
      const customerPrice = serviceRequest.adminReviewedIdentification.customerPrice;
      const finalPriceNum = customerPrice + serviceTypeFee;
      serviceRequest.adminFinalPrice = finalPriceNum;

      // Update calculatedPricing with correct service type fee so breakdown displays correctly
      if ((serviceRequest as any).calculatedPricing) {
        (serviceRequest as any).calculatedPricing.serviceTypeFee = serviceTypeFee;
      } else {
        (serviceRequest as any).calculatedPricing = { serviceTypeFee };
      }

      // Calculate and populate paymentBreakdown so pricing structure displays correctly immediately
      const calculatedPricing = (serviceRequest as any).calculatedPricing || {};
      const urgencyFee = calculatedPricing.urgencyFee || 0;
      const warrantyFee = calculatedPricing.warrantyFee || 0;
      const dataSafetyFee = calculatedPricing.dataSafetyFee || 0;
      const pickupCost = (serviceRequest as any).serviceType === 'pickup-drop' ? serviceTypeFee : 0;

      // Service cost = Final Price - Service Type Fee - Urgency Fee - Warranty Fee - Data Safety Fee
      const serviceCost = finalPriceNum - serviceTypeFee - urgencyFee - warrantyFee - dataSafetyFee;

      // Technician charges = Final Price - Emergency Charges - Warranty Charges - Data Safety Charges - Pickup & Drop Charges
      const technicianCharges =
        finalPriceNum - urgencyFee - warrantyFee - dataSafetyFee - pickupCost;

      // Technician earnings (80%) and company commission (20%)
      const technicianEarnings = Math.round(technicianCharges * 0.8);
      const companyCommission = Math.round(technicianCharges * 0.2);

      (serviceRequest as any).paymentBreakdown = {
        serviceCost,
        componentCost: 0,
        pickupCost,
        emergencyCharges: urgencyFee,
        warrantyCharges: warrantyFee,
        dataSafetyCharges: dataSafetyFee,
        totalCost: finalPriceNum,
        technicianCharges,
        technicianEarnings,
        companyCommission,
      };

      // Update status to repair started
      serviceRequest.status = 'Repair Started';

      // Add to status history
      serviceRequest.statusHistory.push({
        status: 'Repair Started',
        timestamp: new Date(),
        notes: `Customer approved repair at ₹${serviceRequest.adminReviewedIdentification.customerPrice} + service type fee ₹${serviceTypeFee} = ₹${serviceRequest.adminFinalPrice}`,
        updatedBy: 'customer',
      });

      await serviceRequest.save();

      // Notify vendor to proceed with repair
      try {
        const Vendor = require('../models/vendor.model').default;
        const vendor = await Vendor.findById(
          serviceRequest.assignedVendor || serviceRequest.assignedTechnician
        );

        if (vendor) {
          const { createNotification } = require('./notification.controller');
          await createNotification(
            vendor.pocInfo.userId.toString(),
            'Customer Approved Repair',
            `Customer approved repair for ${serviceRequest.brand} ${serviceRequest.model}. You can proceed with the work.`,
            'vendor_notification',
            id
          );

          // Email vendor
          sendEmailAsync(
            vendor.pocInfo.email,
            'Customer Approved Repair - Proceed with Work',
            `<h2>Customer Approved Repair</h2>
            <p>Hi ${vendor.pocInfo.fullName},</p>
            <p>Good news! The customer has approved the repair estimate for ${serviceRequest.brand} ${serviceRequest.model}.</p>
            <ul>
              <li><strong>Approved Cost:</strong> ₹${serviceRequest.adminReviewedIdentification.customerPrice}</li>
              <li><strong>Problem:</strong> ${serviceRequest.problemIdentification.identifiedProblem}</li>
            </ul>
            <p>You can now proceed with the repair work.</p>
            <p><a href="${process.env.FRONTEND_URL}/vendor/service-requests/${serviceRequest._id}">View Request</a></p>`
          );
        }
      } catch (notificationError: any) {
        console.error('Failed to notify vendor:', notificationError);
        // Don't fail the request if notification fails
      }

      // Real-time: notify customer + vendor that repair has started
      try {
        const Vendor2 = require('../models/vendor.model').default;
        const vendorDoc = await Vendor2.findById(
          serviceRequest.assignedVendor || serviceRequest.assignedTechnician
        ).select('pocInfo.userId');
        const vendorUserId = vendorDoc?.pocInfo?.userId?.toString();
        emitStatusUpdate(
          req.app.get('socketio'),
          serviceRequest,
          'Repair Started',
          vendorUserId ? [vendorUserId] : []
        );
      } catch (_) {}

      return res.status(200).json({
        success: true,
        message: 'Pricing approved successfully. Repair will begin.',
        serviceRequest,
      });
    }

    // OLD FLOW: For backward compatibility (direct vendor-to-customer flow)
    if (
      !serviceRequest.problemIdentification ||
      serviceRequest.problemIdentification.customerApproval.status !== 'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'No pending pricing approval found for this service request.',
      });
    }

    // Update customer approval
    serviceRequest.problemIdentification.customerApproval.status = 'approved';
    serviceRequest.problemIdentification.customerApproval.approvedAt = new Date();
    serviceRequest.problemIdentification.customerApproval.customerNotes = customerNotes || '';

    // Update status to repair started
    serviceRequest.status = 'Repair Started';

    await serviceRequest.save();

    // Real-time: notify all parties
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, 'Repair Started');

    res.status(200).json({
      success: true,
      message: 'Pricing approved successfully. Repair will begin.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error approving pricing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve pricing.',
      error: error.message,
    });
  }
};

// Customer rejects pricing
export const rejectPricing = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rejectionReason, customerNotes } = req.body;
    const userId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the customer
    if (serviceRequest.customerId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reject pricing for this service request.',
      });
    }

    if (
      !serviceRequest.problemIdentification ||
      serviceRequest.problemIdentification.customerApproval.status !== 'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'No pending pricing approval found for this service request.',
      });
    }

    // Update customer approval
    serviceRequest.problemIdentification.customerApproval.status = 'rejected';
    serviceRequest.problemIdentification.customerApproval.rejectedAt = new Date();
    serviceRequest.problemIdentification.customerApproval.rejectionReason =
      rejectionReason || 'No reason provided';
    serviceRequest.problemIdentification.customerApproval.customerNotes = customerNotes || '';

    // Set pricing to pickup + fixed charge only (no repair cost)
    serviceRequest.problemIdentification.pricingBreakdown.repairCost = 0;
    serviceRequest.problemIdentification.pricingBreakdown.totalCost =
      serviceRequest.problemIdentification.pricingBreakdown.pickupCharge +
      serviceRequest.problemIdentification.pricingBreakdown.fixedCharge;

    // For onsite service type, no captain drop is needed since the technician is already
    // at the customer's location. Complete the service directly.
    if (serviceRequest.serviceType === 'onsite') {
      serviceRequest.status = 'Completed';
      serviceRequest.completedAt = new Date();

      // Add status history entry
      if (!serviceRequest.statusHistory) {
        serviceRequest.statusHistory = [];
      }
      serviceRequest.statusHistory.push({
        status: 'Completed',
        timestamp: new Date(),
        notes:
          'Customer rejected pricing. Service completed without repair (onsite - no drop needed).',
        updatedBy: 'customer',
      });
    } else if (serviceRequest.serviceType === 'visit-shop') {
      // For visit-shop, let customer choose how to get their device back
      // (self-pickup or captain delivery) — same flow as post-repair delivery
      serviceRequest.status = 'Repair Done';

      if (!serviceRequest.statusHistory) {
        serviceRequest.statusHistory = [];
      }
      serviceRequest.statusHistory.push({
        status: 'Repair Done',
        timestamp: new Date(),
        notes:
          'Customer rejected pricing. Device ready — no repair performed. Customer to choose pickup or delivery.',
        updatedBy: 'customer',
      });
    } else {
      // For pickup-drop, device needs to be returned via captain drop
      serviceRequest.status = 'Drop Requested';

      // Create captainDropRequest so the captain can see and accept this request
      const vendorId = serviceRequest.assignedTechnician || serviceRequest.assignedVendor;
      let vendorAddress = serviceRequest.address || '';
      let vendorCoordinates = { latitude: 0, longitude: 0 };

      if (vendorId) {
        const vendor = await Vendor.findById(vendorId);
        if (vendor) {
          vendorAddress = vendor.pocInfo?.correspondenceAddress || vendorAddress;
          vendorCoordinates = {
            latitude: vendor.currentLocation?.latitude || 0,
            longitude: vendor.currentLocation?.longitude || 0,
          };
        }
      }

      serviceRequest.captainDropRequest = {
        requestedAt: new Date(),
        requestedBy: vendorId,
        vendorAddress,
        vendorCoordinates,
        customerAddress: serviceRequest.address || '',
        customerCoordinates: {
          latitude: serviceRequest.customerLocation?.latitude || serviceRequest.latitude || 0,
          longitude: serviceRequest.customerLocation?.longitude || serviceRequest.longitude || 0,
        },
        dropNotes: 'Customer rejected pricing. Device to be returned without repair.',
        estimatedDropTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: 'pending',
      };

      if (!serviceRequest.statusHistory) {
        serviceRequest.statusHistory = [];
      }
      serviceRequest.statusHistory.push({
        status: 'Drop Requested',
        timestamp: new Date(),
        notes: 'Customer rejected pricing. Device will be returned without repair.',
        updatedBy: 'customer',
      });
    }

    await serviceRequest.save();

    // Real-time: notify all parties of the resulting status
    emitStatusUpdate(req.app.get('socketio'), serviceRequest, serviceRequest.status);
    // Also alert captains if a drop request was auto-created
    if (serviceRequest.status === 'Drop Requested') {
      const dropIo = req.app.get('socketio') || (global as any).io;
      if (dropIo) {
        dropIo.to('captain-new-requests').emit('new_captain_request', {
          type: 'drop_requested',
          serviceRequestId: (serviceRequest as any)._id?.toString(),
          timestamp: new Date().toISOString(),
        });
      }
    }

    const responseMessage =
      serviceRequest.serviceType === 'onsite'
        ? 'Pricing rejected. Service completed without repair.'
        : serviceRequest.serviceType === 'visit-shop'
          ? 'Pricing rejected. Please choose how you would like your device returned (self-pickup or captain delivery).'
          : 'Pricing rejected. Service will proceed with pickup and drop only.';

    res.status(200).json({
      success: true,
      message: responseMessage,
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error rejecting pricing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject pricing.',
      error: error.message,
    });
  }
};

// Admin sets final price when repair is done
export const setAdminFinalPrice = async (req: AuthRequest, res: Response) => {
  const io = req.app.get('socketio') || (global as any).io;
  try {
    const { id } = req.params;
    const { finalPrice, componentCharges, componentNotes, pricingNotes } = req.body;
    const adminId = (req.user as any)?.userId;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Admin ID not found',
      });
    }

    // Check if user is admin
    const admin = await userModel.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Check if service is in "Repair Done" or "Completed" status
    if (serviceRequest.status !== 'Repair Done' && serviceRequest.status !== 'Completed') {
      return res.status(400).json({
        success: false,
        message: 'Final price can only be set when repair is completed',
      });
    }

    // Get pricing data from calculated pricing (may be null for legacy requests)
    const calculatedPricing = (serviceRequest as any).calculatedPricing || {};

    // Just ensure final price is positive - admin can set any price based on actual issue
    // (Customer's expected range might not match actual issue discovered during repair)
    if (Number(finalPrice) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Final price must be greater than 0',
      });
    }

    // Extract fees from calculated pricing (default to 0 for legacy requests)
    const serviceTypeFee = calculatedPricing.serviceTypeFee || 0;
    const urgencyFee = calculatedPricing.urgencyFee || 0;
    const warrantyFee = calculatedPricing.warrantyFee || 0;
    const dataSafetyFee = calculatedPricing.dataSafetyFee || 0;
    const componentCost = Number(componentCharges) || 0;
    const finalPriceNum = Number(finalPrice);

    // Determine pickup cost (only for pickup-drop service type)
    const pickupCost = (serviceRequest as any).serviceType === 'pickup-drop' ? serviceTypeFee : 0;

    // Determine if visit-shop captain delivery charge already applies
    // (customer may have chosen delivery before admin sets the final price)
    const deliveryCost =
      (serviceRequest as any).serviceType === 'visit-shop' &&
      (serviceRequest as any).postRepairDeliveryPreference === 'captain-delivery'
        ? 150
        : 0;

    // Calculate service cost (the base service charge from the final price range)
    // Service cost = Final Price - Component Charges - Service Type Fee - Urgency Fee - Warranty Fee - Data Safety Fee
    const serviceCost =
      finalPriceNum - componentCost - serviceTypeFee - urgencyFee - warrantyFee - dataSafetyFee;

    // Calculate technician charges
    // Technician charges = Final Price - Component Charges - Emergency Charges - Warranty Charges - Data Safety Charges - Pickup & Drop Charges
    // Note: deliveryCost (captain delivery) also excluded — it goes to captain, not technician
    const technicianCharges =
      finalPriceNum - componentCost - urgencyFee - warrantyFee - dataSafetyFee - pickupCost;

    // Calculate technician earnings (80% of technician charges)
    const technicianEarnings = Math.round(technicianCharges * 0.8);

    // Calculate company commission (20% of technician charges)
    const companyCommission = Math.round(technicianCharges * 0.2);

    // Update the service request with admin final price and breakdown
    // adminFinalPrice is always the repair-only price (delivery charge handled separately)
    (serviceRequest as any).adminFinalPrice = finalPriceNum;
    (serviceRequest as any).adminPricingNotes = pricingNotes || '';
    (serviceRequest as any).adminPricingSetAt = new Date();
    (serviceRequest as any).adminPricingSetBy = adminId;

    // Set component charges
    (serviceRequest as any).adminComponentCharges = componentCost;
    (serviceRequest as any).adminComponentNotes = componentNotes || '';

    // Sync visitShopDeliveryCharge if applicable
    if (deliveryCost > 0) {
      (serviceRequest as any).visitShopDeliveryCharge = deliveryCost;
    }

    // Set complete payment breakdown
    // totalCost = repair price + delivery charge (if captain delivery already chosen)
    (serviceRequest as any).paymentBreakdown = {
      serviceCost: serviceCost,
      componentCost: componentCost,
      pickupCost: pickupCost,
      deliveryCost: deliveryCost,
      emergencyCharges: urgencyFee,
      warrantyCharges: warrantyFee,
      dataSafetyCharges: dataSafetyFee,
      totalCost: finalPriceNum + deliveryCost,
      technicianCharges: technicianCharges,
      technicianEarnings: technicianEarnings,
      companyCommission: companyCommission,
    };

    await serviceRequest.save();

    sendServiceRequestNotification((serviceRequest as any).request_id, 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    sendServiceRequestNotification((serviceRequest as any)._id.toString(), 'admin_action', {
      serviceRequestId: (serviceRequest as any).request_id,
    });
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'admin_action',
      (serviceRequest as any).request_id
    );
    notifyCaptainRefresh(
      serviceRequest.assignedCaptain,
      'admin_action',
      (serviceRequest as any).request_id
    );

    res.status(200).json({
      success: true,
      message: 'Final price set successfully',
      data: {
        serviceRequestId: serviceRequest._id,
        adminFinalPrice: finalPriceNum,
        componentCharges: componentCost,
        pricingNotes: pricingNotes,
        setAt: (serviceRequest as any).adminPricingSetAt,
        paymentBreakdown: (serviceRequest as any).paymentBreakdown,
      },
    });
  } catch (error: any) {
    console.error('Error setting admin final price:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set final price',
      error: error.message,
    });
  }
};

// Vendor marks service as completed
// Debug function to update knowsProblem for existing service requests
export const updateKnowsProblem = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { knowsProblem } = req.body;

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    serviceRequest.knowsProblem = knowsProblem === 'true' || knowsProblem === true;
    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'knowsProblem updated successfully',
      knowsProblem: serviceRequest.knowsProblem,
    });
  } catch (error: any) {
    console.error('Error updating knowsProblem:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const markServiceCompleted = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const vendorId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Find the vendor profile for this user
    const vendor = await Vendor.findOne({ 'pocInfo.userId': vendorId });
    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the assigned vendor
    if (serviceRequest.assignedTechnician?.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to complete this service request.',
      });
    }

    if (serviceRequest.status !== 'Device Delivered') {
      return res.status(400).json({
        success: false,
        message: 'Service request must be in "Device Delivered" status to mark as completed.',
      });
    }

    // Update status to completed
    serviceRequest.status = 'Completed';
    serviceRequest.completedAt = new Date();

    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Service request marked as completed successfully.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error marking service as completed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark service as completed.',
      error: error.message,
    });
  }
};

// Customer chooses post-repair delivery method for Visit-Shop requests
export const choosePostRepairDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { deliveryMethod } = req.body; // 'self-pickup' or 'captain-delivery'
    const customerId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!deliveryMethod || !['self-pickup', 'captain-delivery'].includes(deliveryMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery method. Must be "self-pickup" or "captain-delivery".',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id })
      .populate('assignedTechnician')
      .populate('assignedVendor');
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id)
        .populate('assignedTechnician')
        .populate('assignedVendor');
    }

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify that the user is the customer
    if (serviceRequest.customerId?.toString() !== customerId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to choose delivery method for this service request.',
      });
    }

    // Only allow for Visit-Shop requests
    if (serviceRequest.serviceType !== 'visit-shop') {
      return res.status(400).json({
        success: false,
        message: 'Delivery method choice is only available for Visit-Shop requests.',
      });
    }

    // Only allow after repair is done
    if (serviceRequest.status !== 'Repair Done') {
      return res.status(400).json({
        success: false,
        message: 'Delivery method can only be chosen after repair is completed.',
      });
    }

    // Prevent changing if already chosen
    if (serviceRequest.postRepairDeliveryPreference) {
      return res.status(400).json({
        success: false,
        message: 'Delivery method has already been chosen and cannot be changed.',
      });
    }

    const VISIT_SHOP_DELIVERY_CHARGE = 150;

    // Update delivery preference
    serviceRequest.postRepairDeliveryPreference = deliveryMethod;
    serviceRequest.postRepairDeliveryChosenAt = new Date();

    // If customer chooses captain delivery, apply delivery charge only.
    // Do NOT create captainDropRequest here — vendor must obtain customer consent first
    // via POST /:id/request-drop-consent before dispatching a captain.
    if (deliveryMethod === 'captain-delivery') {
      // Apply ₹150 delivery charge
      (serviceRequest as any).visitShopDeliveryCharge = VISIT_SHOP_DELIVERY_CHARGE;

      // If admin has already set the payment breakdown, update it to include delivery charge
      if (
        (serviceRequest as any).paymentBreakdown &&
        (serviceRequest as any).paymentBreakdown.totalCost > 0
      ) {
        (serviceRequest as any).paymentBreakdown.deliveryCost = VISIT_SHOP_DELIVERY_CHARGE;
        (serviceRequest as any).paymentBreakdown.totalCost += VISIT_SHOP_DELIVERY_CHARGE;
      }
      // Status stays 'Repair Done' — vendor will ask consent and then request captain manually
    }
    // Self-pickup: status stays 'Repair Done', customer collects from shop — no action needed

    await serviceRequest.save();

    // Real-time: notify vendor that customer chose a delivery method
    sendServiceRequestNotification((serviceRequest as any).request_id, 'delivery_method_chosen', {
      deliveryMethod,
    });
    sendServiceRequestNotification(
      (serviceRequest as any)._id.toString(),
      'delivery_method_chosen',
      { deliveryMethod }
    );
    notifyVendorRefresh(
      serviceRequest.assignedTechnician || serviceRequest.assignedVendor,
      'delivery_method_chosen',
      (serviceRequest as any)._id?.toString()
    );

    res.status(200).json({
      success: true,
      message:
        deliveryMethod === 'captain-delivery'
          ? 'Captain delivery selected. The vendor will contact you shortly to arrange pickup.'
          : 'Self pickup confirmed. You can collect your device from the shop.',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error choosing post-repair delivery:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to choose delivery method.',
      error: error.message,
    });
  }
};

// ============================================
// DEVICE HANDOVER VERIFICATION IMAGE UPLOADS
// ============================================

/**
 * Upload handover verification images for Captain checkpoints
 *
 * For pick-and-drop requests:
 * - customerPickup: Pickup from customer
 * - deliveryToTechnician: Drop at technician
 * - returnPickupFromTechnician: Pickup from technician after repair
 * - customerDelivery: Drop at customer
 *
 * For visit-shop requests (when customer chooses delivery via captain):
 * - returnPickupFromTechnician: Pickup from technician
 * - customerDelivery: Drop to customer
 *
 * Note: Only captain uploads images. Vendor/technician image uploads have been removed.
 */
export const uploadCaptainHandoverImages = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { checkpoint, latitude, longitude } = req.body;
    const captainId = req.user?.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID is required.',
      });
    }

    if (!captainId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!checkpoint) {
      return res.status(400).json({
        success: false,
        message:
          'Checkpoint is required (customerPickup, deliveryToTechnician, returnPickupFromTechnician, customerDelivery).',
      });
    }

    const validCheckpoints = [
      'customerPickup',
      'deliveryToTechnician',
      'returnPickupFromTechnician',
      'customerDelivery',
    ];
    if (!validCheckpoints.includes(checkpoint)) {
      return res.status(400).json({
        success: false,
        message: `Invalid checkpoint. Must be one of: ${validCheckpoints.join(', ')}`,
      });
    }

    // Find captain profile
    const captain = await Captain.findOne({ 'personalInfo.userId': captainId });
    if (!captain) {
      return res.status(403).json({
        success: false,
        message: 'Captain profile not found for this user.',
      });
    }

    let serviceRequest = await ServiceRequest.findOne({ request_id: id });
    if (!serviceRequest && Types.ObjectId.isValid(id)) {
      serviceRequest = await ServiceRequest.findById(id);
    }
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found.',
      });
    }

    // Verify captain is assigned
    if (serviceRequest.assignedCaptain?.toString() !== captain._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to upload images for this service request.',
      });
    }

    // Check if images already uploaded (cannot replace)
    const checkpointData = (serviceRequest.deviceHandoverImages as any)?.[checkpoint];
    if (checkpointData?.isComplete) {
      return res.status(400).json({
        success: false,
        message: 'Images for this checkpoint have already been uploaded and cannot be replaced.',
      });
    }

    // Get files from request
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one image is required.',
      });
    }

    // Minimum 5 images required for standard checkpoints
    const minImages = checkpoint === 'customerDelivery' ? 3 : 5;
    if (files.length < minImages) {
      return res.status(400).json({
        success: false,
        message: `Minimum ${minImages} images are required for ${checkpoint}.`,
      });
    }

    // Upload images to S3
    const location =
      latitude && longitude
        ? { latitude: parseFloat(latitude), longitude: parseFloat(longitude) }
        : undefined;

    // Validate files before uploading
    console.log('Files received:', files.length);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`File ${i + 1}:`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype,
        pathExists: file.path ? fs.existsSync(file.path) : false,
      });

      if (!file.path) {
        console.error(`File ${i + 1} has no path property`);
        return res.status(500).json({
          success: false,
          message: `File ${i + 1} is missing path information.`,
        });
      }

      // Resolve path to absolute if it's relative
      const filePath = path.isAbsolute(file.path)
        ? file.path
        : path.resolve(process.cwd(), file.path);

      if (!fs.existsSync(filePath)) {
        console.error(`File ${i + 1} does not exist at path: ${filePath} (original: ${file.path})`);
        console.error('Current working directory:', process.cwd());
        return res.status(500).json({
          success: false,
          message: `File ${i + 1} not found on server.`,
        });
      }

      // Update file.path to absolute path for upload
      file.path = filePath;
    }

    const uploadPromises = files.map(async (file, index) => {
      try {
        const result = await uploadHandoverImage(
          file.path,
          id,
          checkpoint,
          'captain',
          captain._id.toString(),
          location
        );
        return result;
      } catch (error: any) {
        console.error(`Error uploading file ${index + 1}:`, error);
        return null;
      }
    });

    const uploadResults = await Promise.all(uploadPromises);
    const successfulUploads = uploadResults.filter(result => result !== null);

    if (successfulUploads.length === 0) {
      console.error('All uploads failed');
      return res.status(500).json({
        success: false,
        message: 'Failed to upload images. Please try again.',
      });
    }

    if (successfulUploads.length < files.length) {
      console.warn(
        `Only ${successfulUploads.length} out of ${files.length} images uploaded successfully`
      );
    }

    // Update service request with image URLs
    // Use updateOne to avoid full document validation (in case status or other fields have invalid values)
    const imageUrls = successfulUploads.map(result => result!.url);

    // Prepare location object - must match schema structure
    const locationData = location
      ? { latitude: location.latitude, longitude: location.longitude }
      : undefined;

    const updateData: any = {
      [`deviceHandoverImages.${checkpoint}`]: {
        images: imageUrls,
        uploadedAt: new Date(),
        uploadedBy: captain._id,
        location: locationData,
        isComplete: true,
      },
    };

    try {
      // Use findByIdAndUpdate to match existing code pattern (like updateVendorServiceRequestStatus)
      // This avoids full document validation which would fail if status has invalid values
      const updatedRequest = await ServiceRequest.findOneAndUpdate(
        { request_id: id },
        { $set: updateData },
        { new: true }
      );

      if (!updatedRequest) {
        throw new Error('Service request not found for update');
      }

      console.log('Service request updated successfully with handover images');
    } catch (updateError: any) {
      console.error('Error updating service request:', updateError);
      console.error('Update error details:', {
        message: updateError.message,
        name: updateError.name,
      });
      throw updateError;
    }

    res.status(200).json({
      success: true,
      message: `Images uploaded successfully for ${checkpoint}.`,
      data: {
        checkpoint,
        imagesCount: imageUrls.length,
        imageUrls,
        uploadedAt: new Date(),
        location,
      },
    });
  } catch (error: any) {
    console.error('Error uploading captain handover images:', error);
    console.error('Error stack:', error.stack);
    console.error('Request details:', {
      serviceRequestId: req.params.id,
      checkpoint: req.body.checkpoint,
      filesCount: req.files
        ? Array.isArray(req.files)
          ? req.files.length
          : 'not array'
        : 'no files',
      userId: req.user?.userId,
    });
    res.status(500).json({
      success: false,
      message: 'Failed to upload handover images.',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

/**
 * Upload handover verification images for Technician checkpoints
 *
 * DISABLED: Technician/Vendor image uploads have been removed.
 * Only captain uploads images now for all device handovers.
 *
 * This function is kept for backward compatibility but returns an error.
 */
export const uploadTechnicianHandoverImages = async (req: AuthRequest, res: Response) => {
  // Return error - technician uploads are no longer allowed
  return res.status(403).json({
    success: false,
    message:
      'Technician/Vendor image uploads have been disabled. Only captain can upload device handover images.',
  });
};

// DEV/TEST ONLY — simulates vendor marking repair done and setting payment amount
export const simulateReadyForPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const serviceRequest = await ServiceRequest.findById(id);
    if (!serviceRequest) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    // Pick amount: midpoint of relational behavior pricing, or fallback to 699
    let testAmount = 699;
    const rb = (serviceRequest as any).relationalBehaviors?.[0]?.pricing;
    if (rb?.min_price && rb?.max_price) {
      testAmount = Math.round((rb.min_price + rb.max_price) / 2);
    }

    (serviceRequest as any).status = 'Repair Done';
    (serviceRequest as any).adminFinalPrice = testAmount;
    (serviceRequest as any).paymentStatus = 'pending';

    // Assign current user as mock vendor so PaymentForm has a vendorId to send
    if (!(serviceRequest as any).assignedVendor && !(serviceRequest as any).assignedTechnician) {
      (serviceRequest as any).assignedVendor = userId;
    }

    await serviceRequest.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: `Status set to Repair Done with test amount ₹${testAmount}`,
      data: {
        status: serviceRequest.status,
        adminFinalPrice: testAmount,
        assignedVendor: (serviceRequest as any).assignedVendor,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
