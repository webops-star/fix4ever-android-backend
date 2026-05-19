import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import mongoose from 'mongoose';
import Captain from '../models/captain.model';
import User from '../models/user.model';
import ServiceRequest from '../models/serviceRequest.model';
import CaptainWalletTransaction from '../models/captainWalletTransaction.model';
import { uploadToS3 } from '../utils/s3';
import {
  uploadCaptainOnboardingDocument,
  getPresignedUrl,
  extractS3KeyFromUrl,
} from '../utils/s3Upload';
import fs from 'fs';
import { emitAdminNotification } from '../utils/realTimeNotifications';

export const createCaptainProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const { personalInfo, currentLocation } = req.body;

    if (!personalInfo) {
      return res.status(400).json({
        success: false,
        message: 'Personal information is required',
      });
    }

    const existingCaptain = await Captain.findOne({
      'personalInfo.userId': userId,
    });

    if (existingCaptain) {
      // Captain exists - update (allow editing). If was Approved, needs re-approval.
      const needsReApproval = existingCaptain.onboardingStatus === 'Approved';
      const pi = existingCaptain.personalInfo as any;
      existingCaptain.personalInfo = {
        userId: pi.userId,
        fullName: personalInfo.fullName ?? pi.fullName,
        email: personalInfo.email ?? pi.email,
        phone: personalInfo.phone ?? pi.phone,
        alternatePhone: personalInfo.alternatePhone ?? pi.alternatePhone,
        residentialAddress: personalInfo.residentialAddress ?? pi.residentialAddress,
        latitude: personalInfo.latitude ?? pi.latitude,
        longitude: personalInfo.longitude ?? pi.longitude,
      };
      existingCaptain.onboardingStatus = needsReApproval ? 'In Review' : 'In Progress';
      if (currentLocation) {
        existingCaptain.currentLocation = currentLocation as any;
      }
      await existingCaptain.save();
      return res.status(200).json({
        success: true,
        message: needsReApproval
          ? 'Profile updated. Changes require admin re-approval.'
          : 'Personal information updated successfully',
        captain: existingCaptain,
      });
    }

    const newCaptain = new Captain({
      personalInfo: {
        userId: userId,
        fullName: personalInfo.fullName || req.user?.username,
        email: personalInfo.email || req.user?.email,
        phone: personalInfo.phone || req.user?.phone,
        alternatePhone: personalInfo.alternatePhone,
        residentialAddress: personalInfo.residentialAddress,
        latitude: personalInfo.latitude || (currentLocation ? currentLocation.latitude : null),
        longitude: personalInfo.longitude || (currentLocation ? currentLocation.longitude : null),
      },
      currentLocation: currentLocation || {
        latitude: personalInfo.latitude,
        longitude: personalInfo.longitude,
      },
      onboardingStatus: 'In Progress',
    });

    await newCaptain.save();

    await User.findByIdAndUpdate(userId, {
      $set: { isVendor: false },
    });

    return res.status(201).json({
      success: true,
      message: 'Captain onboarding started successfully',
      captain: newCaptain,
    });
  } catch (error: any) {
    console.error('Error starting captain onboarding:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start captain onboarding',
      error: error.message,
    });
  }
};

export const updateVehicleDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    // Extract vehicle details from request
    const { vehicleDetails } = req.body;

    // Handle file uploads
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const vehiclePhotos: string[] = [];
    let registrationCertificateUrl = '';
    let insuranceDocumentUrl = '';

    // Get username from captain email for S3 folder organization
    const username =
      captain.personalInfo.email || captain.personalInfo.fullName || captain._id.toString();

    // Upload vehicle photos if provided
    if (files.vehiclePhotos && files.vehiclePhotos.length > 0) {
      for (let i = 0; i < files.vehiclePhotos.length; i++) {
        const file = files.vehiclePhotos[i];
        try {
          const result = await uploadCaptainOnboardingDocument(
            file.path,
            username,
            `vehicle_photo_${i + 1}`
          );
          if (result && result.url) {
            vehiclePhotos.push(result.url);
            console.log(`✅ Uploaded vehicle photo ${i + 1}: ${result.url}`);
          }
        } catch (uploadError) {
          console.error('Error uploading vehicle photo to S3:', uploadError);
        }
      }
    }

    // Upload registration certificate if provided
    if (files.registrationCertificate && files.registrationCertificate.length > 0) {
      try {
        const file = files.registrationCertificate[0];
        const result = await uploadCaptainOnboardingDocument(
          file.path,
          username,
          'vehicle_registration_certificate'
        );
        if (result && result.url) {
          registrationCertificateUrl = result.url;
          console.log('✅ Uploaded registration certificate:', result.url);
        }
      } catch (uploadError) {
        console.error('Error uploading registration certificate to S3:', uploadError);
      }
    }

    // Upload insurance document if provided
    if (files.insuranceDocument && files.insuranceDocument.length > 0) {
      try {
        const file = files.insuranceDocument[0];
        const result = await uploadCaptainOnboardingDocument(
          file.path,
          username,
          'vehicle_insurance_document'
        );
        if (result && result.url) {
          insuranceDocumentUrl = result.url;
          console.log('✅ Uploaded insurance document:', result.url);
        }
      } catch (uploadError) {
        console.error('Error uploading insurance document to S3:', uploadError);
      }
    }

    // Parse vehiclePhotos if it's a JSON string
    let existingVehiclePhotos = vehicleDetails.vehiclePhotos;
    if (typeof existingVehiclePhotos === 'string') {
      try {
        existingVehiclePhotos = JSON.parse(existingVehiclePhotos);
      } catch (error) {
        console.error('Error parsing vehiclePhotos JSON:', error);
        existingVehiclePhotos = [];
      }
    }

    // If documents are provided in the request body (as URLs), include them
    const updatedVehicleDetails = {
      ...vehicleDetails,
      vehiclePhotos: vehiclePhotos.length > 0 ? vehiclePhotos : existingVehiclePhotos,
      registrationCertificate: registrationCertificateUrl || vehicleDetails.registrationCertificate,
      insuranceDocument: insuranceDocumentUrl || vehicleDetails.insuranceDocument,
    };

    captain.vehicleDetails = updatedVehicleDetails;
    captain.onboardingStatus =
      captain.onboardingStatus === 'Approved' ? 'In Review' : 'In Progress';
    await captain.save();

    return res.status(200).json({
      success: true,
      message: 'Vehicle details updated successfully',
      captain: captain,
    });
  } catch (error: any) {
    console.error('Error updating vehicle details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update vehicle details',
      error: error.message,
    });
  }
};

export const updateDrivingLicense = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    const { drivingLicenseDetails } = req.body;

    // Get username from captain email for S3 folder organization
    const username =
      captain.personalInfo.email || captain.personalInfo.fullName || captain._id.toString();

    // Handle license photo upload if provided
    if (req.file) {
      try {
        const result = await uploadToS3(
          req.file.path,
          'captain/onboarding',
          username,
          'driving_license'
        );
        if (result && result.url) {
          drivingLicenseDetails.licensePhoto = result.url;
          console.log('✅ Uploaded driving license:', result.url);
        }
      } catch (uploadError) {
        console.error('Error uploading to S3:', uploadError);
      }
    }

    captain.drivingLicenseDetails = drivingLicenseDetails;
    captain.onboardingStatus =
      captain.onboardingStatus === 'Approved' ? 'In Review' : 'In Progress';
    await captain.save();

    return res.status(200).json({
      success: true,
      message: 'Driving license details updated successfully',
      captain: captain,
    });
  } catch (error: any) {
    console.error('Error updating driving license details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update driving license details',
      error: error.message,
    });
  }
};

export const updateIdentityVerification = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    const { identityVerification } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // Get username from captain email for S3 folder organization
    const username =
      captain.personalInfo.email || captain.personalInfo.fullName || captain._id.toString();

    // Handle identity document uploads
    if (files) {
      // Handle government ID upload
      if (files.governmentIdProof && files.governmentIdProof.length > 0) {
        try {
          const result = await uploadToS3(
            files.governmentIdProof[0].path,
            'captain/onboarding',
            username,
            'government_id_proof'
          );
          if (result && result.url) {
            identityVerification.governmentIdProof = result.url;
            console.log('✅ Uploaded government ID proof:', result.url);
          }
        } catch (error) {
          console.error('Error uploading government ID to S3:', error);
        }
      }

      // Handle selfie verification upload
      if (files.selfieVerification && files.selfieVerification.length > 0) {
        try {
          const result = await uploadToS3(
            files.selfieVerification[0].path,
            'captain/onboarding',
            username,
            'selfie_verification'
          );
          if (result && result.url) {
            identityVerification.selfieVerification = result.url;
            console.log('✅ Uploaded selfie verification:', result.url);
          }
        } catch (error) {
          console.error('Error uploading selfie to S3:', error);
        }
      }
    }

    // Set verification status
    identityVerification.verificationStatus = 'Pending';

    captain.identityVerification = {
      ...(captain.identityVerification as object),
      ...identityVerification,
    };
    captain.onboardingStatus =
      captain.onboardingStatus === 'Approved' ? 'In Review' : 'In Progress';
    await captain.save();

    return res.status(200).json({
      success: true,
      message: 'Identity verification details updated successfully',
      captain: captain,
    });
  } catch (error: any) {
    console.error('Error updating identity verification details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update identity verification details',
      error: error.message,
    });
  }
};

export const updateBankDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    const { bankDetails } = req.body;

    // Get username from captain email for S3 folder organization
    const username =
      captain.personalInfo.email || captain.personalInfo.fullName || captain._id.toString();

    // Handle cancelled cheque upload if provided
    if (req.file) {
      try {
        const result = await uploadToS3(
          req.file.path,
          'captain/onboarding',
          username,
          'cancelled_cheque'
        );
        if (result && result.url) {
          bankDetails.cancelledCheque = result.url;
          console.log('✅ Uploaded cancelled cheque:', result.url);
        }
      } catch (error) {
        console.error('Error uploading cancelled cheque to S3:', error);
      }
    }

    captain.bankDetails = bankDetails;
    captain.onboardingStatus =
      captain.onboardingStatus === 'Approved' ? 'In Review' : 'In Progress';
    await captain.save();

    return res.status(200).json({
      success: true,
      message: 'Bank details updated successfully',
      captain: captain,
    });
  } catch (error: any) {
    console.error('Error updating bank details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update bank details',
      error: error.message,
    });
  }
};

export const updateServicePreferences = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    const { servicePreferences } = req.body;

    captain.servicePreferences = servicePreferences;
    captain.onboardingStatus =
      captain.onboardingStatus === 'Approved' ? 'In Review' : 'In Progress';
    await captain.save();

    return res.status(200).json({
      success: true,
      message: 'Service preferences updated successfully',
      captain: captain,
    });
  } catch (error: any) {
    console.error('Error updating service preferences:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update service preferences',
      error: error.message,
    });
  }
};

export const submitOnboarding = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    const { acceptTerms } = req.body;
    if (!acceptTerms) {
      return res.status(400).json({
        success: false,
        message: 'You must accept the terms and conditions to continue',
      });
    }

    // Ensure all required onboarding sections are completed before submission.
    // Return a structured list so the frontend can show exactly what's missing.
    const missingFields: string[] = [];

    const pi: any = captain.personalInfo || {};
    if (!pi.fullName) missingFields.push('personalInfo.fullName');
    if (!pi.email) missingFields.push('personalInfo.email');
    if (!pi.phone) missingFields.push('personalInfo.phone');
    if (!pi.residentialAddress) missingFields.push('personalInfo.residentialAddress');
    if (pi.latitude === null || pi.latitude === undefined)
      missingFields.push('personalInfo.latitude');
    if (pi.longitude === null || pi.longitude === undefined)
      missingFields.push('personalInfo.longitude');

    const vd: any = captain.vehicleDetails || {};
    if (!vd.vehicleType) missingFields.push('vehicleDetails.vehicleType');
    if (!vd.vehicleBrand) missingFields.push('vehicleDetails.vehicleBrand');
    if (!vd.vehicleModel) missingFields.push('vehicleDetails.vehicleModel');
    if (!vd.vehicleYear) missingFields.push('vehicleDetails.vehicleYear');
    if (!vd.licensePlate) missingFields.push('vehicleDetails.licensePlate');
    if (!vd.vehicleColor) missingFields.push('vehicleDetails.vehicleColor');
    if (!vd.registrationCertificate) missingFields.push('vehicleDetails.registrationCertificate');
    if (!vd.insuranceDocument) missingFields.push('vehicleDetails.insuranceDocument');
    if (!Array.isArray(vd.vehiclePhotos) || vd.vehiclePhotos.length === 0) {
      missingFields.push('vehicleDetails.vehiclePhotos');
    }

    const dl: any = captain.drivingLicenseDetails || {};
    if (!dl.licenseNumber) missingFields.push('drivingLicenseDetails.licenseNumber');
    if (!dl.issueDate) missingFields.push('drivingLicenseDetails.issueDate');
    if (!dl.expiryDate) missingFields.push('drivingLicenseDetails.expiryDate');
    if (!dl.licenseClass) missingFields.push('drivingLicenseDetails.licenseClass');
    if (!dl.licensePhoto) missingFields.push('drivingLicenseDetails.licensePhoto');

    const iv: any = captain.identityVerification || {};
    if (!iv.governmentIdType) missingFields.push('identityVerification.governmentIdType');
    if (!iv.governmentIdNumber) missingFields.push('identityVerification.governmentIdNumber');
    if (!iv.governmentIdProof) missingFields.push('identityVerification.governmentIdProof');
    if (!iv.selfieVerification) missingFields.push('identityVerification.selfieVerification');

    const bd: any = captain.bankDetails || {};
    if (!bd.accountHolderName) missingFields.push('bankDetails.accountHolderName');
    if (!bd.accountNumber) missingFields.push('bankDetails.accountNumber');
    if (!bd.ifscCode) missingFields.push('bankDetails.ifscCode');
    if (!bd.bankName) missingFields.push('bankDetails.bankName');
    if (!bd.branchName) missingFields.push('bankDetails.branchName');
    if (!bd.accountType) missingFields.push('bankDetails.accountType');

    const sp: any = captain.servicePreferences || {};
    if (!sp.workingHours?.start) missingFields.push('servicePreferences.workingHours.start');
    if (!sp.workingHours?.end) missingFields.push('servicePreferences.workingHours.end');
    if (
      sp.workingHours?.start &&
      sp.workingHours?.end &&
      sp.workingHours.start >= sp.workingHours.end
    ) {
      missingFields.push('servicePreferences.workingHours');
    }
    if (!Array.isArray(sp.workingDays) || sp.workingDays.length === 0) {
      missingFields.push('servicePreferences.workingDays');
    }
    if (!Array.isArray(sp.serviceAreas) || sp.serviceAreas.length === 0) {
      missingFields.push('servicePreferences.serviceAreas');
    }
    if (!sp.maxTravelDistance || sp.maxTravelDistance <= 0) {
      missingFields.push('servicePreferences.maxTravelDistance');
    }
    if (!Array.isArray(sp.preferredPaymentMethods) || sp.preferredPaymentMethods.length === 0) {
      missingFields.push('servicePreferences.preferredPaymentMethods');
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required fields before submitting',
        missingFields,
      });
    }

    // Update captain's terms acceptance and submission status
    captain.termsAndConditionsAccepted = true;
    captain.onboardingStatus = 'In Review';
    captain.submittedAt = new Date();
    await captain.save();

    // Notify admins of new captain application
    emitAdminNotification('new_captain_application', {
      captainId: captain._id,
      name: captain.personalInfo?.fullName,
    });

    return res.status(200).json({
      success: true,
      message: 'Application submitted for review',
      captain: captain,
    });
  } catch (error: any) {
    console.error('Error submitting captain application:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit captain application',
      error: error.message,
    });
  }
};

export const getCaptainProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    // Convert document URLs to presigned URLs so captain can view private S3 objects (no CloudFront)
    const obj: any = captain.toObject();
    const ensurePresigned = async (url?: string | null) => {
      if (!url) return url;
      const key = extractS3KeyFromUrl(url);
      if (!key) return url;
      const presigned = await getPresignedUrl(key, 3600);
      return presigned || url;
    };

    if (obj.vehicleDetails) {
      if (obj.vehicleDetails.registrationCertificate) {
        obj.vehicleDetails.registrationCertificate = await ensurePresigned(
          obj.vehicleDetails.registrationCertificate
        );
      }
      if (obj.vehicleDetails.insuranceDocument) {
        obj.vehicleDetails.insuranceDocument = await ensurePresigned(
          obj.vehicleDetails.insuranceDocument
        );
      }
      if (Array.isArray(obj.vehicleDetails.vehiclePhotos)) {
        obj.vehicleDetails.vehiclePhotos = await Promise.all(
          obj.vehicleDetails.vehiclePhotos.map((url: string) => ensurePresigned(url))
        );
      }
    }
    if (obj.drivingLicenseDetails?.licensePhoto) {
      obj.drivingLicenseDetails.licensePhoto = await ensurePresigned(
        obj.drivingLicenseDetails.licensePhoto
      );
    }
    if (obj.identityVerification) {
      if (obj.identityVerification.governmentIdProof) {
        obj.identityVerification.governmentIdProof = await ensurePresigned(
          obj.identityVerification.governmentIdProof
        );
      }
      if (obj.identityVerification.selfieVerification) {
        obj.identityVerification.selfieVerification = await ensurePresigned(
          obj.identityVerification.selfieVerification
        );
      }
    }
    if (obj.bankDetails?.cancelledCheque) {
      obj.bankDetails.cancelledCheque = await ensurePresigned(obj.bankDetails.cancelledCheque);
    }

    return res.status(200).json({
      success: true,
      captain: obj,
    });
  } catch (error: any) {
    console.error('Error fetching captain profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch captain profile',
      error: error.message,
    });
  }
};

export const updateCaptainLocation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    // Update location
    captain.currentLocation = {
      latitude,
      longitude,
      lastUpdated: new Date(),
    };
    await captain.save();

    return res.status(200).json({
      success: true,
      message: 'Location updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating captain location:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update location',
      error: error.message,
    });
  }
};

export const updateAvailabilityStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const { status } = req.body;
    if (!status || !['Available', 'On Trip', 'Offline'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (Available, On Trip, Offline)',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    // Block going offline while on an active trip
    if (status === 'Offline' && captain.availability === 'On Trip') {
      return res.status(400).json({
        success: false,
        message: 'Cannot go offline while on an active order. Complete the order to go offline.',
      });
    }

    // Update availability status
    captain.availability = status;
    await captain.save();

    return res.status(200).json({
      success: true,
      message: 'Availability status updated successfully',
      status: status,
    });
  } catch (error: any) {
    console.error('Error updating captain availability status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update availability status',
      error: error.message,
    });
  }
};

// Captain job management
export const getActiveJobs = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    // For now, return empty array as pickup request system needs to be integrated
    const activeJobs: any[] = [];

    return res.status(200).json({
      success: true,
      jobs: activeJobs,
    });
  } catch (error: any) {
    console.error('Error fetching active jobs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active jobs',
      error: error.message,
    });
  }
};

export const getCompletedJobs = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({ success: false, message: 'Captain profile not found' });
    }

    // Broad query: match any request where this captain did pickup OR drop.
    // 'handover_to_vendor' arm catches trips from before the fix where the status
    // was never advanced to 'completed' after handover.
    const raw = await ServiceRequest.find({
      $or: [
        {
          'captainPickupRequest.captainId': captain._id,
          'captainPickupRequest.status': 'completed',
        },
        {
          'captainPickupRequest.captainId': captain._id,
          'captainPickupRequest.status': 'handover_to_vendor',
        },
        { 'captainDropRequest.captainId': captain._id, 'captainDropRequest.status': 'completed' },
        { assignedCaptain: captain._id, status: 'Completed' },
      ],
    })
      .populate('assignedTechnician', 'pocInfo businessDetails')
      .populate('assignedVendor', 'pocInfo businessDetails')
      .populate('customerId', 'username email phone')
      .sort({ completedAt: -1, updatedAt: -1 })
      .limit(100);

    // Deduplicate (a request may match multiple $or arms)
    const seen = new Set<string>();
    const completedServiceRequests = raw.filter(sr => {
      const id = (sr._id as any).toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Single wallet-transaction pass — key by "srId-tripType" so pickup and drop
    // earnings are tracked independently even when the same captain did both legs.
    const allTxns = await CaptainWalletTransaction.find({
      captainId: captain._id,
      type: 'credit',
      status: 'completed',
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const earningsByTrip: Record<string, number> = {};
    let totalEarnings = 0;
    let todayEarnings = 0;

    for (const txn of allTxns) {
      const srId = (txn as any).serviceRequestId?.toString();
      const txnTripType = (txn as any).metadata?.tripType || 'drop';
      if (srId) {
        const key = `${srId}-${txnTripType}`;
        earningsByTrip[key] = (earningsByTrip[key] || 0) + txn.netAmount;
      }
      totalEarnings += txn.netAmount;
      if (new Date(txn.createdAt) >= today) todayEarnings += txn.netAmount;
    }

    const totalTrips = allTxns.length;

    // Build the shared fields that are the same regardless of trip leg
    const sharedFields = (sr: any, vendor: any, customer: any) => ({
      jobNumber: sr.request_id || (sr._id as any).toString(),
      serviceType: sr.serviceType,
      deviceBrand: sr.brand,
      deviceModel: sr.model,
      requestType: sr.requestType,
      customerName: sr.userName || customer?.username || '',
      userPhone: sr.userPhone || customer?.phone || '',
      beneficiaryName: sr.beneficiaryName || '',
      beneficiaryPhone: sr.beneficiaryPhone || '',
      customerAddress: sr.address || '',
      vendorName: vendor?.pocInfo?.fullName || vendor?.businessDetails?.businessName || '',
      vendorPhone: vendor?.pocInfo?.phone || '',
      vendorAddress:
        vendor?.pocInfo?.correspondenceAddress ||
        vendor?.businessDetails?.registeredOfficeAddress ||
        '',
    });

    // Each pickup-drop request emits up to TWO independent job entries — one per leg.
    // Visit-shop always emits one (drop only).
    const jobs: any[] = [];

    for (const sr of completedServiceRequests) {
      const srId = (sr._id as any).toString();
      const vendor = ((sr as any).assignedTechnician || (sr as any).assignedVendor) as any;
      const customer = (sr as any).customerId as any;
      const shared = sharedFields(sr as any, vendor, customer);

      const captainIdStr = captain._id.toString();
      const didPickup =
        (sr as any).captainPickupRequest?.captainId?.toString() === captainIdStr ||
        (sr as any).captainPickupRequest?.status === 'handover_to_vendor'; // legacy fallback
      const didDrop = (sr as any).captainDropRequest?.captainId?.toString() === captainIdStr;

      // ── PICKUP LEG (customer → vendor) ──────────────────────────────────────
      if (didPickup && (sr as any).serviceType === 'pickup-drop') {
        jobs.push({
          ...shared,
          _id: `${srId}-pickup`,
          tripType: 'pickup',
          completedAt:
            (sr as any).captainPickupRequest?.handoverToVendorAt || (sr as any).updatedAt || null,
          createdAt: (sr as any).createdAt,
          pickupAddress:
            (sr as any).captainPickupRequest?.pickupAddress || (sr as any).address || '',
          dropAddress: shared.vendorAddress,
          // Only pickup-leg timestamps
          reachedCustomerAt: (sr as any).captainPickupRequest?.reachedCustomerAt || null,
          pickupHandedToVendorAt: (sr as any).captainPickupRequest?.handoverToVendorAt || null,
          reachedVendorForDropAt: null,
          dropDeliveredAt: null,
          earnings: earningsByTrip[`${srId}-pickup`] || 0,
        });
      }

      // ── DROP LEG (vendor → customer) ─────────────────────────────────────────
      // Covers both pickup-drop drop leg and visit-shop captain delivery
      if (didDrop) {
        const isVisitShop = (sr as any).serviceType === 'visit-shop';
        jobs.push({
          ...shared,
          _id: `${srId}-drop`,
          tripType: 'drop',
          completedAt:
            (sr as any).captainDropRequest?.handoverCompletedAt ||
            (sr as any).captainDropRequest?.pickupDoneAt ||
            (sr as any).completedAt ||
            null,
          createdAt: (sr as any).createdAt,
          pickupAddress:
            (sr as any).captainDropRequest?.vendorAddress || shared.vendorAddress || '',
          dropAddress: (sr as any).captainDropRequest?.customerAddress || (sr as any).address || '',
          // Only drop-leg timestamps
          reachedCustomerAt: null,
          pickupHandedToVendorAt: null,
          reachedVendorForDropAt: (sr as any).captainDropRequest?.reachedVendorAt || null,
          dropDeliveredAt:
            (sr as any).captainDropRequest?.handoverCompletedAt ||
            (sr as any).captainDropRequest?.pickupDoneAt ||
            (sr as any).completedAt ||
            null,
          earnings: earningsByTrip[`${srId}-drop`] || 0,
        });
      }

      // ── FALLBACK: matched only via assignedCaptain, no specific leg data ────
      if (!didPickup && !didDrop) {
        const fbEarnings =
          (earningsByTrip[`${srId}-pickup`] || 0) + (earningsByTrip[`${srId}-drop`] || 0);
        jobs.push({
          ...shared,
          _id: srId,
          tripType: 'drop',
          completedAt: (sr as any).completedAt,
          createdAt: (sr as any).createdAt,
          pickupAddress: shared.vendorAddress,
          dropAddress: shared.customerAddress,
          reachedCustomerAt: null,
          pickupHandedToVendorAt: null,
          reachedVendorForDropAt: null,
          dropDeliveredAt: (sr as any).completedAt || null,
          earnings: fbEarnings,
        });
      }
    }

    // Sort newest completed first
    jobs.sort((a, b) => {
      const aT = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bT = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bT - aT;
    });

    return res.status(200).json({
      success: true,
      jobs,
      totalTrips,
      totalEarnings,
      todayEarnings,
    });
  } catch (error: any) {
    console.error('Error fetching completed jobs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch completed jobs',
      error: error.message,
    });
  }
};

// Admin controllers for captain management
export const getAllCaptainApplications = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required',
      });
    }

    // Get all captain applications (all statuses for admin review)
    const captainApplications = await Captain.find({})
      .populate('personalInfo.userId', 'username email createdAt')
      .sort({ submittedAt: -1, createdAt: -1 });

    // Ensure document URLs are accessible (S3 objects may be private).
    const applicationsWithPresignedUrls = await Promise.all(
      captainApplications.map(async captain => {
        const obj: any = captain.toObject();

        const ensurePresigned = async (url?: string | null) => {
          if (!url) return url;
          const key = extractS3KeyFromUrl(url);
          if (!key) return url;
          const presigned = await getPresignedUrl(key, 3600);
          return presigned || url;
        };

        if (obj.identityVerification?.selfieVerification) {
          obj.identityVerification.selfieVerification = await ensurePresigned(
            obj.identityVerification.selfieVerification
          );
        }

        return obj;
      })
    );

    return res.status(200).json({
      success: true,
      data: applicationsWithPresignedUrls, // Frontend expects data property
    });
  } catch (error: any) {
    console.error('Error fetching captain applications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch captain applications',
      error: error.message,
    });
  }
};

export const getCaptainById = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required',
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid captain ID format',
      });
    }

    const captain = await Captain.findById(id).populate(
      'personalInfo.userId',
      'username email phone'
    );
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain not found',
      });
    }

    // Convert document URLs to presigned URLs so admin can view private S3 objects
    const obj: any = captain.toObject();

    const ensurePresigned = async (url?: string | null) => {
      if (!url) return url;
      const key = extractS3KeyFromUrl(url);
      if (!key) return url;
      const presigned = await getPresignedUrl(key, 3600);
      return presigned || url;
    };

    if (obj.vehicleDetails) {
      if (obj.vehicleDetails.registrationCertificate) {
        obj.vehicleDetails.registrationCertificate = await ensurePresigned(
          obj.vehicleDetails.registrationCertificate
        );
      }
      if (obj.vehicleDetails.insuranceDocument) {
        obj.vehicleDetails.insuranceDocument = await ensurePresigned(
          obj.vehicleDetails.insuranceDocument
        );
      }
      if (Array.isArray(obj.vehicleDetails.vehiclePhotos)) {
        obj.vehicleDetails.vehiclePhotos = await Promise.all(
          obj.vehicleDetails.vehiclePhotos.map((url: string) => ensurePresigned(url))
        );
      }
    }

    if (obj.drivingLicenseDetails?.licensePhoto) {
      obj.drivingLicenseDetails.licensePhoto = await ensurePresigned(
        obj.drivingLicenseDetails.licensePhoto
      );
    }

    if (obj.identityVerification) {
      if (obj.identityVerification.governmentIdProof) {
        obj.identityVerification.governmentIdProof = await ensurePresigned(
          obj.identityVerification.governmentIdProof
        );
      }
      if (obj.identityVerification.selfieVerification) {
        obj.identityVerification.selfieVerification = await ensurePresigned(
          obj.identityVerification.selfieVerification
        );
      }
    }

    if (obj.bankDetails?.cancelledCheque) {
      obj.bankDetails.cancelledCheque = await ensurePresigned(obj.bankDetails.cancelledCheque);
    }

    return res.status(200).json({
      success: true,
      captain: obj,
    });
  } catch (error: any) {
    console.error('Error fetching captain by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch captain details',
      error: error.message,
    });
  }
};

export const reviewCaptainApplication = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required',
      });
    }

    const { id } = req.params;
    const { action, comments } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid captain ID format',
      });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Valid action (approve or reject) is required',
      });
    }

    const captain = await Captain.findById(id);
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain not found',
      });
    }

    // Update captain application status
    captain.onboardingStatus = action === 'approve' ? 'Approved' : 'Rejected';
    captain.reviewComments = comments || '';
    captain.reviewedBy = req.user._id;
    captain.reviewedAt = new Date();
    await captain.save();

    // If approved, update user role to captain
    if (action === 'approve') {
      await User.findByIdAndUpdate(captain.personalInfo.userId, {
        role: 'captain',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Captain application ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      captain,
    });
  } catch (error: any) {
    console.error('Error reviewing captain application:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to review captain application',
      error: error.message,
    });
  }
};

export const getCaptainStats = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required',
      });
    }

    // Get captain stats
    const totalCaptains = await Captain.countDocuments();
    const activeCaptains = await Captain.countDocuments({
      onboardingStatus: 'Approved',
      availability: 'Available',
    });
    const pendingApplications = await Captain.countDocuments({ onboardingStatus: 'In Review' });
    const rejectedApplications = await Captain.countDocuments({ onboardingStatus: 'Rejected' });

    // Get status breakdown
    const statusBreakdown = await Captain.aggregate([
      {
        $group: {
          _id: '$onboardingStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    // Get availability breakdown for approved captains
    const availabilityBreakdown = await Captain.aggregate([
      {
        $match: { onboardingStatus: 'Approved' },
      },
      {
        $group: {
          _id: '$availability',
          count: { $sum: 1 },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalCaptains,
        activeCaptains,
        pendingApplications,
        rejectedApplications,
        statusBreakdown,
        availabilityBreakdown,
      },
    });
  } catch (error: any) {
    console.error('Error fetching captain stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch captain statistics',
      error: error.message,
    });
  }
};

// Check captain status endpoint
export const checkCaptainStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const captain = await Captain.findOne({ 'personalInfo.userId': userId });
    if (!captain) {
      return res.status(404).json({
        success: false,
        message: 'Captain profile not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        onboardingStatus: captain.onboardingStatus,
        reviewComments: captain.reviewComments,
        submittedAt: captain.submittedAt,
        reviewedAt: captain.reviewedAt,
      },
    });
  } catch (error: any) {
    console.error('Error checking captain status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check captain status',
      error: error.message,
    });
  }
};
