import { Request, Response } from 'express';
import Vendor from '../models/vendor.model';
import User from '../models/user.model';
import multer from 'multer';
import { uploadToS3, deleteFromCloudinary } from '../utils/s3';
import {
  uploadVendorOnboardingDocument,
  getPresignedUrl,
  extractS3KeyFromUrl,
} from '../utils/s3Upload';
import mailSender from '../utils/mailSender';
import ServiceRequest from '../models/serviceRequest.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { Types } from 'mongoose';
import { createNotification } from './notification.controller';

export const createVendor = async (req: Request, res: Response) => {
  try {
    const { fullName, email, phone, alternatePhone, correspondenceAddress, latitude, longitude } =
      req.body;

    if (!fullName || !email || !phone || !correspondenceAddress || !latitude || !longitude) {
      return res.status(400).json({
        message: 'Full name, email, phone, and correspondence address are required.',
      });
    }
    const newVendor = new Vendor({
      pocInfo: {
        fullName,
        email,
        phone,
        alternatePhone,
        correspondenceAddress,
      },
      currentLocation: {
        latitude,
        longitude,
      },
    });

    const savedVendor = await newVendor.save();
    res.status(201).json({
      message: 'Vendor onboarding initiated',
      vendorId: savedVendor._id,
      vendor: savedVendor,
    });
  } catch (error: any) {
    console.error('Error creating vendor:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        message: 'Email already exists. Please use a different email.',
        error: error.message,
      });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateBusinessDetails = async (req: Request, res: Response) => {
  let panCardUrl: string | undefined;
  let businessRegistrationProofUrl: string | undefined;
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    const {
      businessEntityType,
      businessName,
      entityNumber,
      registeredOfficeAddress,
      website,
      gstin,
    } = req.body;

    interface Files {
      panCard?: Express.Multer.File[];
      businessRegistrationProof?: Express.Multer.File[];
    }

    const files = req.files as Files;
    const panCardLocalPath = files.panCard?.[0]?.path;
    const businessRegistrationProofLocalPath = files.businessRegistrationProof?.[0]?.path;

    console.log('Received Request Body:', req.body);
    console.log('Received Request Files:', req.files);
    if (
      !businessEntityType ||
      !businessName ||
      !entityNumber ||
      !registeredOfficeAddress ||
      !panCardLocalPath ||
      !businessRegistrationProofLocalPath
    ) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    if (
      businessEntityType !== 'Sole Proprietorship' &&
      businessEntityType !== 'Partnership' &&
      businessEntityType !== 'Private Limited Company' &&
      businessEntityType !== 'Limited Liability Partnership (LLP)' &&
      businessEntityType !== 'One Person Company (OPC)'
    ) {
      return res.status(400).json({ message: 'Invalid business entity type.' });
    }
    // Check if the vendor exists
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Get username from vendor email for S3 folder organization
    const username = vendor.pocInfo.email || vendor.pocInfo.fullName || vendorId.toString();

    try {
      const uploadResponse = await uploadVendorOnboardingDocument(
        panCardLocalPath,
        username,
        'pan_card'
      );
      panCardUrl = uploadResponse ? uploadResponse.url : undefined;
      console.log('Pan Card uploaded to S3:', panCardUrl);
    } catch (error: any) {
      console.error('Error uploading Pan Card to S3:', error);
      return res.status(500).json({ message: 'Error uploading Pan Card', error: error.message });
    }

    try {
      const uploadResponse = await uploadVendorOnboardingDocument(
        businessRegistrationProofLocalPath,
        username,
        'business_registration_proof'
      );
      businessRegistrationProofUrl = uploadResponse ? uploadResponse.url : undefined;
      console.log('Business Registration Proof uploaded to S3:', businessRegistrationProofUrl);
    } catch (error: any) {
      console.error('Error uploading Business Registration Proof to S3:', error);
      return res.status(500).json({
        message: 'Error uploading Business Registration Proof',
        error: error.message,
      });
    }

    // Update vendor business details
    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendorId,
      {
        $set: {
          'businessDetails.businessEntityType': businessEntityType,
          'businessDetails.businessName': businessName,
          'businessDetails.entityNumber': entityNumber,
          'businessDetails.registeredOfficeAddress': registeredOfficeAddress,
          'businessDetails.panCard': panCardUrl,
          'businessDetails.businessRegistrationProof': businessRegistrationProofUrl,
          'businessDetails.website': website || '',
          'businessDetails.gstin': gstin || '',
          updatedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );
    return res.status(200).json({
      message: 'Business details updated successfully',
      vendor: updatedVendor,
    });
  } catch (error: any) {
    console.error('Error updating business details:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
    if (panCardUrl) {
      if (panCardUrl) {
        await deleteFromCloudinary(panCardUrl);
      }
    }
    if (businessRegistrationProofUrl) {
      await deleteFromCloudinary(businessRegistrationProofUrl);
    }
  }
};

export const updateIdVerification = async (req: Request, res: Response) => {
  let governmentIdProofUrl: string | undefined;
  let panCardProofUrl: string | undefined;
  let selfieVerificationUrl: string | undefined;
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    interface Files {
      governmentIdProof?: Express.Multer.File[];
      panCardProof?: Express.Multer.File[];
      selfieVerification?: Express.Multer.File[];
    }

    const files = req.files as Files;
    const governmentIdProofLocalPath = files.governmentIdProof?.[0]?.path;
    const panCardProofLocalPath = files.panCardProof?.[0]?.path;
    const selfieVerificationLocalPath = files.selfieVerification?.[0]?.path;

    if (!governmentIdProofLocalPath || !panCardProofLocalPath || !selfieVerificationLocalPath) {
      return res.status(400).json({ message: 'All ID verification files are required.' });
    }

    // Check if the vendor exists
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Get username from vendor email for S3 folder organization
    const username = vendor.pocInfo.email || vendor.pocInfo.fullName || vendorId.toString();

    // Upload files to S3 with structured folder: vendor/onboarding/username/filename
    try {
      const uploadResponse = await uploadToS3(
        governmentIdProofLocalPath,
        'vendor/onboarding',
        username,
        'government_id_proof'
      );
      governmentIdProofUrl = uploadResponse ? uploadResponse.url : undefined;
      console.log('Government ID Proof uploaded to S3:', governmentIdProofUrl);
    } catch (error: any) {
      console.error('Error uploading Government ID Proof to S3:', error);
      return res.status(500).json({
        message: 'Error uploading Government ID Proof',
        error: error.message,
      });
    }

    try {
      const uploadResponse = await uploadToS3(
        panCardProofLocalPath,
        'vendor/onboarding',
        username,
        'pan_card_proof'
      );
      panCardProofUrl = uploadResponse ? uploadResponse.url : undefined;
      console.log('Pan Card Proof uploaded to S3:', panCardProofUrl);
    } catch (error: any) {
      console.error('Error uploading Pan Card Proof to S3:', error);
      return res.status(500).json({
        message: 'Error uploading Pan Card Proof',
        error: error.message,
      });
    }

    try {
      const uploadResponse = await uploadToS3(
        selfieVerificationLocalPath,
        'vendor/onboarding',
        username,
        'selfie_verification'
      );
      selfieVerificationUrl = uploadResponse ? uploadResponse.url : undefined;
      console.log('Selfie Verification uploaded to S3:', selfieVerificationUrl);
    } catch (error: any) {
      console.error('Error uploading Selfie Verification to S3:', error);
      return res.status(500).json({
        message: 'Error uploading Selfie Verification',
        error: error.message,
      });
    }

    // Update vendor ID verification details
    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendorId,
      {
        $set: {
          'idVerification.governmentIdProof': governmentIdProofUrl,
          'idVerification.panCardProof': panCardProofUrl,
          'idVerification.selfieVerification': selfieVerificationUrl,
          updatedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      message: 'ID verification updated successfully',
      vendor: updatedVendor,
    });
  } catch (error: any) {
    console.error('Error updating ID verification:', error);

    if (governmentIdProofUrl) {
      await deleteFromCloudinary(governmentIdProofUrl);
    }

    if (panCardProofUrl) {
      await deleteFromCloudinary(panCardProofUrl);
    }

    if (selfieVerificationUrl) {
      await deleteFromCloudinary(selfieVerificationUrl);
    }

    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateServicesOffered = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    const {
      hardwareRepairServices,
      softwareServices,
      chipLevelRepairs,
      preventiveMaintenance,
      networkingSolutions,
      dataSecuritySolutions,
      customServices,
      specializedLaptopBrands,
      certifications,
      yearsOfExperience,
      servicePricing,
    } = req.body;

    if (Array.isArray(hardwareRepairServices) && hardwareRepairServices.length === 0) {
      return res.status(400).json({ message: 'Hardware repair services is required.' });
    }

    if (!yearsOfExperience || yearsOfExperience < 0) {
      return res.status(400).json({
        message: 'Years of experience is required and must be a positive number.',
      });
    }

    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendorId,
      {
        $set: {
          'servicesOffered.hardwareRepairServices': hardwareRepairServices,
          'servicesOffered.softwareServices': softwareServices || [],
          'servicesOffered.chipLevelRepairs': chipLevelRepairs || [],
          'servicesOffered.preventiveMaintenance': preventiveMaintenance || [],
          'servicesOffered.networkingSolutions': networkingSolutions || [],
          'servicesOffered.dataSecuritySolutions': dataSecuritySolutions || [],
          'servicesOffered.customServices': customServices || [],
          'servicesOffered.specializedLaptopBrands': specializedLaptopBrands || [],
          'servicesOffered.certifications': certifications || [],
          'servicesOffered.yearsOfExperience': yearsOfExperience,
          'servicesOffered.servicePricing': servicePricing || [],

          updatedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedVendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.status(200).json({
      message: 'Services offered updated successfully',
      vendor: updatedVendor,
    });
  } catch (error: any) {
    console.error('Error updating services offered:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateOperationalDetails = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    const { paymentMethods, servicesOfferedVia } = req.body;

    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendorId,
      {
        $set: {
          'operationalDetails.paymentMethods': paymentMethods || [],
          'operationalDetails.servicesOfferedVia': servicesOfferedVia || [],
          updatedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedVendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.status(200).json({
      message: 'Operational details updated successfully',
      vendor: updatedVendor,
    });
  } catch (error: any) {
    console.error('Error updating operational details:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateBankDetails = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    const {
      accountHolderName,
      bankName,
      branchName,
      accountNumber,
      ifscCode,
      preferredPaymentCycle,
    } = req.body;

    if (!accountHolderName) {
      return res.status(400).json({ message: 'Account holder name is required.' });
    }

    if (!bankName) {
      return res.status(400).json({ message: 'Bank name is required.' });
    }

    if (!branchName) {
      return res.status(400).json({ message: 'Branch name is required.' });
    }

    if (!accountNumber) {
      return res.status(400).json({ message: 'Account number is required.' });
    }

    if (!ifscCode) {
      return res.status(400).json({ message: 'IFSC code is required.' });
    }

    if (!['Immediate', 'Weekly', 'Monthly'].includes(preferredPaymentCycle)) {
      return res.status(400).json({ message: 'Invalid preferred payment cycle.' });
    }

    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendorId,
      {
        $set: {
          'bankDetails.accountHolderName': accountHolderName,
          'bankDetails.bankName': bankName,
          'bankDetails.branchName': branchName,
          'bankDetails.accountNumber': accountNumber,
          'bankDetails.ifscCode': ifscCode,
          'bankDetails.preferredPaymentFrequency': preferredPaymentCycle || '',
          updatedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedVendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.status(200).json({
      message: 'Bank details updated successfully',
      vendor: updatedVendor,
    });
  } catch (error: any) {
    console.error('Error updating bank details:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const acceptTermsAndConditions = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendorId,
      {
        $set: {
          termsAndConditionsAccepted: true,
          onboardingStatus: 'In Review',
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!updatedVendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.status(200).json({
      message: 'Terms and conditions accepted. Onboarding submitted for review.',
      vendor: updatedVendor,
    });
  } catch (error: any) {
    console.error('Error accepting terms and conditions:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getVendor = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.status(200).json({ success: true, vendor });
  } catch (error: any) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

export const updateOnboardingStatus = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { status } = req.body;

    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required.' });
    }

    if (!status) {
      return res.status(400).json({ message: 'Status is required.' });
    }

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status provided' });
    }

    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendorId,
      { $set: { onboardingStatus: status, updatedAt: new Date() } },
      { new: true }
    );

    if (!updatedVendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }
    await mailSender(
      updatedVendor.pocInfo.email,
      `Vendor Onboarding Status Update`,
      `<p>Dear ${updatedVendor.pocInfo.fullName},</p>
            <p>Your vendor onboarding status has been updated to <strong>${status}</strong>.</p
            <p>Thank you for your patience.</p>
            <p>Best regards,</p>
            <p>Fix4ever</p>`
    );

    res.status(200).json({
      message: `Vendor onboarding status updated to ${status}`,
      vendor: updatedVendor,
    });
  } catch (error: any) {
    console.error('Error updating onboarding status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getAllVendors = async (req: Request, res: Response) => {
  try {
    const vendors = await Vendor.find({ onboardingStatus: 'Approved' })
      .select(
        'pocInfo.fullName pocInfo.email pocInfo.phone pocInfo.correspondenceAddress businessDetails.businessName businessDetails.businessEntityType servicesOffered operationalDetails.paymentMethods onboardingStatus'
      )
      .sort({ 'pocInfo.fullName': 1 });
    res.status(200).json({ success: true, vendors });
  } catch (error: any) {
    console.error('Error fetching all vendors:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get assigned technicians for a user
export const getAssignedTechnicians = async (req: Request, res: Response) => {
  try {
    const { technicianIds } = req.query;

    if (!technicianIds) {
      return res.status(400).json({
        success: false,
        message: 'Technician IDs are required',
      });
    }

    const technicianIdArray = (technicianIds as string).split(',').filter(id => id);

    if (technicianIdArray.length === 0) {
      return res.status(200).json({
        success: true,
        vendors: [],
      });
    }

    const vendors = await Vendor.find({
      _id: { $in: technicianIdArray },
      onboardingStatus: 'Approved',
    })
      .select(
        'pocInfo.fullName pocInfo.email pocInfo.phone pocInfo.correspondenceAddress businessDetails.businessName businessDetails.businessEntityType servicesOffered operationalDetails.paymentMethods onboardingStatus'
      )
      .sort({ 'pocInfo.fullName': 1 });

    res.status(200).json({
      success: true,
      vendors,
    });
  } catch (error: any) {
    console.error('Error fetching assigned technicians:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const onboardVendor = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    // Check if vendor already exists for this user
    const existingVendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (existingVendor) {
      return res.status(400).json({
        success: false,
        message: 'Vendor profile already exists for this user',
      });
    }

    const {
      pocInfo,
      businessDetails,
      idVerification,
      servicesOffered,
      operationalDetails,
      bankDetails,
      termsAndConditionsAccepted,
      currentLocation,
    } = req.body;

    // Handle file uploads
    interface Files {
      businessRegistrationProof?: Express.Multer.File[];
      governmentIdProof?: Express.Multer.File[];
      panCardProof?: Express.Multer.File[];
      selfieVerification?: Express.Multer.File[];
    }

    const files = req.files as Files | undefined;

    // Get username from pocInfo for S3 folder organization
    const username = pocInfo?.email || pocInfo?.fullName || userId.toString();

    // Upload files to S3 with structured folder: vendor/onboarding/username/filename
    let uploadedFiles: Record<string, string> = {};

    // Map field names to document types for proper S3 naming
    const documentTypeMap: { [key: string]: string } = {
      panCard: 'pan_card',
      businessRegistrationProof: 'business_registration_proof',
      governmentIdProof: 'government_id_proof',
      aadharCard: 'aadhar_card',
      panCardProof: 'pan_card_proof',
      selfieVerification: 'selfie_verification',
      cancelledCheque: 'cancelled_cheque',
    };

    if (files) {
      for (const [key, fileArray] of Object.entries(files)) {
        if (fileArray && fileArray.length > 0) {
          const file = fileArray[0];
          try {
            const documentType =
              documentTypeMap[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            const result = await uploadToS3(file.path, 'vendor/onboarding', username, documentType);
            if (result && result.url) {
              uploadedFiles[key] = result.url;
            }
          } catch (error) {
            console.error(`Error uploading ${key} to S3:`, error);
          }
        }
      }
    }

    // Create vendor object with uploaded file URLs
    const vendorData = {
      pocInfo: {
        ...pocInfo,
        userId, // Associate with the authenticated user
      },
      businessDetails: {
        ...businessDetails,
        businessRegistrationProof:
          uploadedFiles.businessRegistrationProof || businessDetails?.businessRegistrationProof,
      },
      idVerification: {
        ...idVerification,
        governmentIdProof: uploadedFiles.governmentIdProof || idVerification?.governmentIdProof,
        selfieVerification: uploadedFiles.selfieVerification || idVerification?.selfieVerification,
      },
      servicesOffered,
      operationalDetails,
      bankDetails,
      termsAndConditionsAccepted: termsAndConditionsAccepted || false,
      currentLocation: currentLocation
        ? {
            latitude: currentLocation.latitude || 0,
            longitude: currentLocation.longitude || 0,
            lastUpdated: new Date(),
          }
        : undefined,
      onboardingStatus: 'Pending',
    };

    const newVendor = new Vendor(vendorData);
    await newVendor.save();

    res.status(201).json({
      success: true,
      message: 'Vendor onboarding application submitted successfully',
      vendorId: newVendor._id,
    });
  } catch (error: any) {
    console.error('Error in vendor onboarding:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    // Try to find vendor by userId first (new field)
    let vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      // Fallback: try to find by email if userId link doesn't exist
      try {
        const user = await User.findById(userId);
        if (user && user.email) {
          vendor = await Vendor.findOne({ 'pocInfo.email': user.email });
        }
      } catch (userError) {
        console.error('Error fetching user for vendor lookup:', userError);
      }
    }

    if (!vendor) {
      return res.status(200).json({
        success: false,
        message: 'Vendor profile not found. You may need to complete vendor onboarding first.',
        requiresOnboarding: true,
      });
    }

    // Convert S3 URLs to presigned URLs so vendor can view documents (like captain)
    const obj: any = vendor.toObject();
    const ensurePresigned = async (url?: string | null) => {
      if (!url) return url;
      const key = extractS3KeyFromUrl(url);
      if (!key) return url;
      const presigned = await getPresignedUrl(key, 3600);
      return presigned || url;
    };

    if (obj.businessDetails) {
      if (obj.businessDetails.panCard) {
        obj.businessDetails.panCard = await ensurePresigned(obj.businessDetails.panCard);
      }
      if (obj.businessDetails.businessRegistrationProof) {
        obj.businessDetails.businessRegistrationProof = await ensurePresigned(
          obj.businessDetails.businessRegistrationProof
        );
      }
    }
    if (obj.certification) {
      if (obj.certification.experienceCertificate) {
        obj.certification.experienceCertificate = await ensurePresigned(
          obj.certification.experienceCertificate
        );
      }
      if (obj.certification.fixforeverCertificate) {
        obj.certification.fixforeverCertificate = await ensurePresigned(
          obj.certification.fixforeverCertificate
        );
      }
    }
    if (obj.idVerification) {
      if (obj.idVerification.governmentIdProof) {
        obj.idVerification.governmentIdProof = await ensurePresigned(
          obj.idVerification.governmentIdProof
        );
      }
      if (obj.idVerification.panCardProof) {
        obj.idVerification.panCardProof = await ensurePresigned(obj.idVerification.panCardProof);
      }
      if (obj.idVerification.selfieVerification) {
        obj.idVerification.selfieVerification = await ensurePresigned(
          obj.idVerification.selfieVerification
        );
      }
    }
    if (obj.bankDetails?.cancelledCheque) {
      obj.bankDetails.cancelledCheque = await ensurePresigned(obj.bankDetails.cancelledCheque);
    }

    return res.status(200).json({ success: true, vendor: obj });
  } catch (error: any) {
    console.error('Error in getVendorProfile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching vendor profile',
      error: error.message,
    });
  }
};

export const updateVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    const {
      pocInfo,
      businessDetails,
      idVerification,
      servicesOffered,
      operationalDetails,
      bankDetails,
    } = req.body;

    // Handle file uploads
    interface Files {
      businessRegistrationProof?: Express.Multer.File[];
      governmentIdProof?: Express.Multer.File[];
      panCardProof?: Express.Multer.File[];
      selfieVerification?: Express.Multer.File[];
    }

    const files = req.files as Files | undefined;

    // Get username from vendor email for S3 folder organization
    const username = vendor.pocInfo.email || vendor.pocInfo.fullName || userId.toString();

    // Upload files to S3 with structured folder: vendor/onboarding/username/filename
    let uploadedFiles: Record<string, string> = {};

    // Map field names to document types for proper S3 naming
    const documentTypeMap: { [key: string]: string } = {
      panCard: 'pan_card',
      businessRegistrationProof: 'business_registration_proof',
      governmentIdProof: 'government_id_proof',
      aadharCard: 'aadhar_card',
      panCardProof: 'pan_card_proof',
      selfieVerification: 'selfie_verification',
      cancelledCheque: 'cancelled_cheque',
    };

    if (files) {
      for (const [key, fileArray] of Object.entries(files)) {
        if (fileArray && fileArray.length > 0) {
          const file = fileArray[0];
          try {
            const documentType =
              documentTypeMap[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            const result = await uploadToS3(file.path, 'vendor/onboarding', username, documentType);
            if (result && result.url) {
              uploadedFiles[key] = result.url;
            }
          } catch (error) {
            console.error(`Error uploading ${key} to S3:`, error);
          }
        }
      }
    }

    // Update vendor data
    if (pocInfo) {
      vendor.pocInfo = {
        ...vendor.pocInfo,
        ...pocInfo,
        userId, // Ensure userId remains unchanged
      };
    }

    if (businessDetails) {
      vendor.businessDetails = {
        ...vendor.businessDetails,
        ...businessDetails,
        businessRegistrationProof:
          uploadedFiles.businessRegistrationProof ||
          businessDetails.businessRegistrationProof ||
          vendor.businessDetails?.businessRegistrationProof,
      };
    }

    if (idVerification) {
      vendor.idVerification = {
        ...vendor.idVerification,
        ...idVerification,
        governmentIdProof:
          uploadedFiles.governmentIdProof ||
          idVerification.governmentIdProof ||
          vendor.idVerification?.governmentIdProof,
        selfieVerification:
          uploadedFiles.selfieVerification ||
          idVerification.selfieVerification ||
          vendor.idVerification?.selfieVerification,
      };
    }

    if (servicesOffered)
      vendor.servicesOffered = {
        ...vendor.servicesOffered,
        ...servicesOffered,
      };
    if (operationalDetails)
      vendor.operationalDetails = {
        ...vendor.operationalDetails,
        ...operationalDetails,
      };
    if (bankDetails) vendor.bankDetails = { ...vendor.bankDetails, ...bankDetails };

    // Like captains: update stores in Vendor schema only, set onboardingStatus accordingly
    vendor.onboardingStatus = vendor.onboardingStatus === 'Approved' ? 'In Review' : 'In Progress';
    vendor.updatedAt = new Date();
    await vendor.save();

    res.status(200).json({
      success: true,
      message: 'Vendor profile updated successfully',
      vendor,
    });
  } catch (error: any) {
    console.error('Error updating vendor profile:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(200).json({
        success: false,
        message: 'Vendor profile not found',
        requiresOnboarding: true,
      });
    }

    // Get service requests assigned to this vendor
    const serviceRequests = await ServiceRequest.find({
      assignedTechnician: vendor._id,
    });

    // Calculate stats
    const totalRequests = serviceRequests.length;
    const pendingRequests = serviceRequests.filter(req => req.status === 'Pending').length;
    const inProgressRequests = serviceRequests.filter(req => req.status === 'In Progress').length;
    const completedRequests = serviceRequests.filter(req => req.status === 'Completed').length;

    // In a real application, you would calculate these from actual data
    const totalEarnings = completedRequests * 1500; // Example calculation
    const averageRating = 4.7; // Example value

    res.status(200).json({
      success: true,
      stats: {
        totalRequests,
        pendingRequests,
        inProgressRequests,
        completedRequests,
        totalEarnings,
        averageRating,
      },
    });
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorServiceRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    // Get service requests assigned to this vendor
    const serviceRequests = await ServiceRequest.find({
      assignedTechnician: vendor._id,
    })
      .sort({ createdAt: -1 })
      .populate('customerId', 'username email phone');

    res.status(200).json({
      success: true,
      serviceRequests,
    });
  } catch (error: any) {
    console.error('Error fetching service requests:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVendorLocation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    vendor.currentLocation = { latitude, longitude, lastUpdated: new Date() };
    vendor.updatedAt = new Date();
    await vendor.save();

    res.status(200).json({
      success: true,
      message: 'Vendor location updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating vendor location:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const acceptServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    const { requestId } = req.params;

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    const serviceRequest = await ServiceRequest.findOne({ request_id: requestId });

    if (!serviceRequest) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    if (serviceRequest.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Service request is already ${serviceRequest.status}`,
      });
    }

    serviceRequest.status = 'In Progress';
    serviceRequest.assignedTechnician = vendor._id;
    await serviceRequest.save();

    res.status(200).json({
      success: true,
      message: 'Service request accepted successfully',
      serviceRequest,
    });
  } catch (error: any) {
    console.error('Error accepting service request:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const completeServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    const { requestId } = req.params;

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    const serviceRequest = await ServiceRequest.findOne({ request_id: requestId }).populate(
      'customerId',
      'username email phone'
    );

    if (!serviceRequest) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    if (serviceRequest.status !== 'In Progress' && serviceRequest.status !== 'Assigned') {
      return res.status(400).json({
        success: false,
        message: `Service request is not in progress or assigned`,
      });
    }

    if (
      !serviceRequest.assignedTechnician ||
      !serviceRequest.assignedTechnician.equals(vendor._id)
    ) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to complete this service request',
      });
    }

    serviceRequest.status = 'Completed';
    serviceRequest.completedAt = new Date();
    await serviceRequest.save();

    // Update vendor stats
    await Vendor.findByIdAndUpdate(vendor._id, {
      $inc: {
        completedRequests: 1,
        inProgressRequests: -1,
      },
    });

    // Send response immediately
    res.status(200).json({
      success: true,
      message: 'Service request completed successfully',
      serviceRequest,
    });

    // Send notification to customer asynchronously
    const customer = serviceRequest.customerId as any;
    if (customer?.email) {
      const { sendEmailAsync } = require('./serviceRequest.controller');
      sendEmailAsync(
        customer.email,
        'Service Request Completed',
        `<p>Hi ${customer.username || 'Customer'},</p>
        <p>Your service request has been completed by ${vendor.pocInfo.fullName}.</p>
        <p>You can now rate the service and provide feedback.</p>`
      );
    }

    // Create notification for the customer
    if (customer?._id) {
      await createNotification(
        customer._id.toString(),
        'Service Request Completed',
        `Your service request has been completed by ${vendor.pocInfo.fullName}. You can now rate the service.`,
        'service_update',
        (serviceRequest as any)._id?.toString() || ''
      );
    }

    // Create notification for the vendor
    if (vendor.pocInfo?.userId) {
      await createNotification(
        vendor.pocInfo.userId.toString(),
        'Service Request Completed',
        `You have completed the service request for ${customer?.username || 'Customer'}.`,
        'service_update',
        (serviceRequest as any)._id?.toString() || ''
      );
    }
  } catch (error: any) {
    console.error('Error completing service request:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.user as any)?.userId; // Fixed: use userId instead of id

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found' });
    }

    // Check if vendor already exists for this user
    const existingVendor = await Vendor.findOne({ 'pocInfo.userId': userId });
    if (existingVendor) {
      return res.status(400).json({
        success: false,
        message: 'Vendor profile already exists for this user',
      });
    }

    const { pocInfo, currentLocation } = req.body;

    // Validate required fields
    if (
      !pocInfo ||
      !pocInfo.fullName ||
      !pocInfo.email ||
      !pocInfo.phone ||
      !pocInfo.correspondenceAddress
    ) {
      return res.status(400).json({
        success: false,
        message: 'Full name, email, phone, and correspondence address are required.',
      });
    }

    if (
      !currentLocation ||
      currentLocation.latitude === null ||
      currentLocation.longitude === null
    ) {
      return res.status(400).json({
        success: false,
        message: 'Current location is required for service delivery.',
      });
    }

    // Create basic vendor profile - store in Vendor schema only (like captains)
    const vendorData = {
      pocInfo: {
        ...pocInfo,
        userId, // Associate with the authenticated user
      },
      currentLocation: {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        lastUpdated: new Date(),
      },
      termsAndConditionsAccepted: false,
      onboardingStatus: 'In Progress',
    };

    const newVendor = new Vendor(vendorData);
    await newVendor.save();

    res.status(201).json({
      success: true,
      message: 'Vendor profile created successfully. You can now complete your business details.',
      vendor: newVendor,
      vendorId: newVendor._id,
    });
  } catch (error: any) {
    console.error('Error creating vendor profile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating vendor profile',
      error: error.message,
    });
  }
};

// Multi-step vendor onboarding update endpoints
export const updateVendorOnboardingStep = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { step } = req.params;
    const updateData = req.body;

    console.log('updateVendorOnboardingStep called:', { userId, step, updateData });

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    // Find existing vendor or create new one
    let vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      // Create new vendor profile with minimal required fields
      vendor = new Vendor({
        pocInfo: {
          userId,
          fullName: '',
          email: '',
          phone: '',
          correspondenceAddress: '',
        },
        onboardingStatus: 'In Progress',
      });
    }

    // Update specific step data
    switch (step) {
      case 'poc-info':
        // Ensure required fields are present and not empty
        const pocData = {
          fullName: updateData.fullName || vendor.pocInfo?.fullName || '',
          email: updateData.email || vendor.pocInfo?.email || '',
          phone: updateData.phone || vendor.pocInfo?.phone || '',
          correspondenceAddress:
            updateData.correspondenceAddress || vendor.pocInfo?.correspondenceAddress || '',
          alternatePhone: updateData.alternatePhone || vendor.pocInfo?.alternatePhone,
          latitude: updateData.latitude || vendor.pocInfo?.latitude,
          longitude: updateData.longitude || vendor.pocInfo?.longitude,
          userId: userId as any, // Ensure userId is preserved
        };

        // Validate required fields
        if (
          !pocData.fullName ||
          !pocData.email ||
          !pocData.phone ||
          !pocData.correspondenceAddress
        ) {
          return res.status(400).json({
            success: false,
            message: 'Missing required fields: fullName, email, phone, or correspondenceAddress',
          });
        }

        vendor.pocInfo = pocData;
        break;

      case 'business-details':
        vendor.businessDetails = {
          ...vendor.businessDetails,
          ...updateData,
        };
        break;

      case 'id-verification':
        vendor.idVerification = {
          ...vendor.idVerification,
          ...updateData,
        };
        break;

      case 'services-offered':
        vendor.servicesOffered = {
          ...vendor.servicesOffered,
          ...updateData,
        };
        break;

      case 'operational-details':
        vendor.operationalDetails = {
          ...vendor.operationalDetails,
          ...updateData,
        };
        break;

      case 'bank-details':
        vendor.bankDetails = {
          ...vendor.bankDetails,
          ...updateData,
        };
        break;

      case 'review-submit':
        // Mark all data as complete and submit for review
        vendor.termsAndConditionsAccepted = updateData.termsAndConditionsAccepted || false;
        vendor.onboardingStatus = 'In Review';
        vendor.submittedAt = new Date();
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid onboarding step',
        });
    }

    console.log('Saving vendor with data:', vendor.toObject());
    await vendor.save();
    console.log('Vendor saved successfully');

    return res.status(200).json({
      success: true,
      message: 'Vendor onboarding step updated successfully',
      vendor,
    });
  } catch (error: any) {
    console.error('Update vendor onboarding step error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      errors: error.errors,
    });

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// Get vendor onboarding status
export const getVendorOnboardingStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(200).json({
        success: true,
        onboardingStatus: 'Not Started',
        completedSteps: [],
        vendor: null,
      });
    }

    // Determine completed steps
    const completedSteps = [];

    if (vendor.pocInfo?.fullName && vendor.pocInfo?.email && vendor.pocInfo?.phone) {
      completedSteps.push('poc-info');
    }

    if (vendor.businessDetails?.businessName && vendor.businessDetails?.businessRegistrationProof) {
      completedSteps.push('business-details');
    }

    if (vendor.idVerification?.governmentIdProof && vendor.idVerification?.selfieVerification) {
      completedSteps.push('id-verification');
    }

    if (
      vendor.servicesOffered?.hardwareRepairServices &&
      vendor.servicesOffered.hardwareRepairServices.length > 0
    ) {
      completedSteps.push('services-offered');
    }

    if (
      vendor.operationalDetails?.paymentMethods &&
      vendor.operationalDetails.paymentMethods.length > 0
    ) {
      completedSteps.push('operational-details');
    }

    if (vendor.bankDetails?.accountNumber && vendor.bankDetails?.ifscCode) {
      completedSteps.push('bank-details');
    }

    if (vendor.termsAndConditionsAccepted && vendor.onboardingStatus === 'In Review') {
      completedSteps.push('review-submit');
    }

    return res.status(200).json({
      success: true,
      onboardingStatus: vendor.onboardingStatus,
      completedSteps,
      vendor,
    });
  } catch (error) {
    console.error('Get vendor onboarding status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// New unified vendor onboarding endpoint
export const vendorOnboarding = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const {
      step,
      pocInfo,
      businessDetails,
      idVerification,
      servicesOffered,
      operationalDetails,
      bankDetails,
      interviewSchedule: interviewScheduleBody,
      technicianLevel,
    } = req.body;

    if (parseInt(step) === 1) {
      console.log('[Vendor onboarding] Step 1 body:', {
        step,
        hasInterviewSchedule: !!interviewScheduleBody,
        interviewScheduleType: typeof interviewScheduleBody,
        technicianLevel,
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    // Find existing vendor or create new one
    let vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      vendor = new Vendor({
        pocInfo: { userId },
        onboardingStatus: 'Draft',
      });
    } else {
      vendor.onboardingStatus = 'Draft';
    }

    // Get username from vendor/pocInfo for S3 folder organization
    const username =
      vendor.pocInfo?.email ||
      pocInfo?.email ||
      vendor.pocInfo?.fullName ||
      pocInfo?.fullName ||
      userId.toString();

    // Handle file uploads
    interface Files {
      panCard?: Express.Multer.File[];
      businessRegistrationProof?: Express.Multer.File[];
      experienceCertificate?: Express.Multer.File[];
      fixforeverCertificate?: Express.Multer.File[];
      governmentIdProof?: Express.Multer.File[];
      panCardProof?: Express.Multer.File[];
      selfieVerification?: Express.Multer.File[];
      cancelledCheque?: Express.Multer.File[];
    }

    const files = req.files as Files;
    let uploadedFiles: Record<string, string> = {};

    // Map field names to document types for proper S3 naming
    const documentTypeMap: { [key: string]: string } = {
      panCard: 'pan_card',
      businessRegistrationProof: 'business_registration_proof',
      experienceCertificate: 'experience_certificate',
      fixforeverCertificate: 'fixforever_certificate',
      governmentIdProof: 'government_id_proof',
      aadharCard: 'aadhar_card',
      panCardProof: 'pan_card_proof',
      selfieVerification: 'selfie_verification',
      cancelledCheque: 'cancelled_cheque',
    };

    // Upload files to S3 if present
    if (files) {
      for (const [fieldName, fileArray] of Object.entries(files)) {
        if (fileArray && fileArray[0]) {
          try {
            const documentType =
              documentTypeMap[fieldName] ||
              fieldName.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            const uploadResponse = await uploadToS3(
              fileArray[0].path,
              'vendor/onboarding',
              username,
              documentType
            );
            if (uploadResponse?.url) {
              uploadedFiles[fieldName] = uploadResponse.url;
            }
          } catch (error: any) {
            console.error(`Error uploading ${fieldName}:`, error);
            return res.status(500).json({
              success: false,
              message: `Error uploading ${fieldName}`,
              error: error.message,
            });
          }
        }
      }
    }

    // Update vendor data based on step (handle string from FormData)
    const stepNum = typeof step === 'number' ? step : parseInt(String(step || '0'), 10);
    if (isNaN(stepNum) || stepNum < 0 || stepNum > 5) {
      return res.status(400).json({
        success: false,
        message: `Invalid step number. Expected 0-5, received: ${step}`,
      });
    }
    switch (stepNum) {
      case 0: // POC Info
        if (pocInfo) {
          let parsedPocInfo: Record<string, unknown>;
          try {
            parsedPocInfo =
              typeof pocInfo === 'string'
                ? JSON.parse(pocInfo)
                : (pocInfo as Record<string, unknown>);
          } catch {
            return res.status(400).json({
              success: false,
              message: 'Invalid pocInfo format. Please ensure contact information is valid.',
            });
          }
          vendor.pocInfo = {
            ...vendor.pocInfo,
            ...parsedPocInfo,
            userId,
          } as any;
        }
        break;

      case 1: // Business Details and/or Certification and/or Interview schedule
        if (businessDetails) {
          const parsedBusinessDetails =
            typeof businessDetails === 'string' ? JSON.parse(businessDetails) : businessDetails;

          // Priority: 1) New file uploads, 2) URLs from parsed JSON, 3) URLs from req.body, 4) Existing vendor data
          const panCardUrl =
            uploadedFiles.panCard ||
            (typeof parsedBusinessDetails.panCard === 'string' &&
            parsedBusinessDetails.panCard.startsWith('http')
              ? parsedBusinessDetails.panCard
              : null) ||
            (typeof req.body.panCard === 'string' && req.body.panCard.startsWith('http')
              ? req.body.panCard
              : null) ||
            vendor.businessDetails?.panCard;

          const businessRegistrationProofUrl =
            uploadedFiles.businessRegistrationProof ||
            (typeof parsedBusinessDetails.businessRegistrationProof === 'string' &&
            parsedBusinessDetails.businessRegistrationProof.startsWith('http')
              ? parsedBusinessDetails.businessRegistrationProof
              : null) ||
            (typeof req.body.businessRegistrationProof === 'string' &&
            req.body.businessRegistrationProof.startsWith('http')
              ? req.body.businessRegistrationProof
              : null) ||
            vendor.businessDetails?.businessRegistrationProof;

          vendor.businessDetails = {
            ...vendor.businessDetails,
            businessEntityType:
              parsedBusinessDetails.businessEntityType ||
              vendor.businessDetails?.businessEntityType,
            businessName:
              parsedBusinessDetails.businessName || vendor.businessDetails?.businessName,
            entityNumber:
              parsedBusinessDetails.entityNumber || vendor.businessDetails?.entityNumber,
            registeredOfficeAddress:
              parsedBusinessDetails.registeredOfficeAddress ||
              vendor.businessDetails?.registeredOfficeAddress,
            website: parsedBusinessDetails.website || vendor.businessDetails?.website,
            gstin: parsedBusinessDetails.gstin || vendor.businessDetails?.gstin,
            panCard: panCardUrl,
            businessRegistrationProof: businessRegistrationProofUrl,
          };
        }
        // Interview path: experience, technician level, suitable date/time
        if (interviewScheduleBody) {
          const parsed =
            typeof interviewScheduleBody === 'string'
              ? JSON.parse(interviewScheduleBody)
              : interviewScheduleBody;
          if (
            parsed.experience != null ||
            parsed.suitableDate != null ||
            parsed.suitableTimeSlot != null
          ) {
            vendor.interviewSchedule = {
              experience: parsed.experience ?? vendor.interviewSchedule?.experience ?? '',
              suitableDate: parsed.suitableDate
                ? new Date(parsed.suitableDate)
                : (vendor.interviewSchedule?.suitableDate as Date | undefined),
              suitableTimeSlot:
                parsed.suitableTimeSlot ?? vendor.interviewSchedule?.suitableTimeSlot ?? '',
              technicianLevel: technicianLevel,
            };
          }
        }
        if (technicianLevel && ['L1', 'L2', 'L3', 'L4', null].includes(technicianLevel)) {
          vendor.Level = technicianLevel;
        }
        // Optional certification documents (only set when we have at least one value)
        // Priority: 1) New file uploads, 2) URLs from req.body, 3) Existing vendor data
        const experienceCertUrl =
          uploadedFiles.experienceCertificate ||
          (typeof req.body.experienceCertificate === 'string' &&
          req.body.experienceCertificate.startsWith('http')
            ? req.body.experienceCertificate
            : null) ||
          vendor.certification?.experienceCertificate;
        const fixforeverCertUrl =
          uploadedFiles.fixforeverCertificate ||
          (typeof req.body.fixforeverCertificate === 'string' &&
          req.body.fixforeverCertificate.startsWith('http')
            ? req.body.fixforeverCertificate
            : null) ||
          vendor.certification?.fixforeverCertificate;
        if (experienceCertUrl || fixforeverCertUrl) {
          vendor.certification = {
            experienceCertificate: experienceCertUrl,
            fixforeverCertificate: fixforeverCertUrl,
          };
        }
        break;

      case 2: // ID Verification
        if (idVerification) {
          const parsedIdVerification =
            typeof idVerification === 'string' ? JSON.parse(idVerification) : idVerification;

          // Priority: 1) New file uploads, 2) URLs from parsed JSON, 3) URLs from req.body, 4) Existing vendor data
          const governmentIdProofUrl =
            uploadedFiles.governmentIdProof ||
            (typeof parsedIdVerification.governmentIdProof === 'string' &&
            parsedIdVerification.governmentIdProof.startsWith('http')
              ? parsedIdVerification.governmentIdProof
              : null) ||
            (typeof req.body.governmentIdProof === 'string' &&
            req.body.governmentIdProof.startsWith('http')
              ? req.body.governmentIdProof
              : null) ||
            vendor.idVerification?.governmentIdProof;

          const panCardProofUrl =
            uploadedFiles.panCardProof ||
            (typeof parsedIdVerification.panCardProof === 'string' &&
            parsedIdVerification.panCardProof.startsWith('http')
              ? parsedIdVerification.panCardProof
              : null) ||
            (typeof req.body.panCardProof === 'string' && req.body.panCardProof.startsWith('http')
              ? req.body.panCardProof
              : null) ||
            vendor.idVerification?.panCardProof;

          const selfieVerificationUrl =
            uploadedFiles.selfieVerification ||
            (typeof parsedIdVerification.selfieVerification === 'string' &&
            parsedIdVerification.selfieVerification.startsWith('http')
              ? parsedIdVerification.selfieVerification
              : null) ||
            (typeof req.body.selfieVerification === 'string' &&
            req.body.selfieVerification.startsWith('http')
              ? req.body.selfieVerification
              : null) ||
            vendor.idVerification?.selfieVerification;

          vendor.idVerification = {
            ...vendor.idVerification,
            governmentIdType:
              parsedIdVerification.governmentIdType || vendor.idVerification?.governmentIdType,
            governmentIdNumber:
              parsedIdVerification.governmentIdNumber || vendor.idVerification?.governmentIdNumber,
            governmentIdProof: governmentIdProofUrl,
            panCardProof: panCardProofUrl,
            selfieVerification: selfieVerificationUrl,
            verificationStatus: 'Pending',
          };
        }
        break;

      case 3: // Services Offered
        if (servicesOffered) {
          const parsedServicesOffered =
            typeof servicesOffered === 'string' ? JSON.parse(servicesOffered) : servicesOffered;
          vendor.servicesOffered = {
            ...vendor.servicesOffered,
            ...parsedServicesOffered,
          };
        }
        break;

      case 4: // Operational Details
        if (operationalDetails) {
          const parsedOperationalDetails =
            typeof operationalDetails === 'string'
              ? JSON.parse(operationalDetails)
              : operationalDetails;
          vendor.operationalDetails = {
            ...vendor.operationalDetails,
            ...parsedOperationalDetails,
          };
        }
        break;

      case 5: // Bank Details
        if (bankDetails) {
          const parsedBankDetails =
            typeof bankDetails === 'string' ? JSON.parse(bankDetails) : bankDetails;

          // Priority: 1) New file uploads, 2) URLs from parsed JSON, 3) URLs from req.body, 4) Existing vendor data
          const cancelledChequeUrl =
            uploadedFiles.cancelledCheque ||
            (typeof parsedBankDetails.cancelledCheque === 'string' &&
            parsedBankDetails.cancelledCheque.startsWith('http')
              ? parsedBankDetails.cancelledCheque
              : null) ||
            (typeof req.body.cancelledCheque === 'string' &&
            req.body.cancelledCheque.startsWith('http')
              ? req.body.cancelledCheque
              : null) ||
            vendor.bankDetails?.cancelledCheque;

          vendor.bankDetails = {
            ...vendor.bankDetails,
            accountHolderName:
              parsedBankDetails.accountHolderName || vendor.bankDetails?.accountHolderName,
            accountNumber: parsedBankDetails.accountNumber || vendor.bankDetails?.accountNumber,
            ifscCode: parsedBankDetails.ifscCode || vendor.bankDetails?.ifscCode,
            bankName: parsedBankDetails.bankName || vendor.bankDetails?.bankName,
            branchName: parsedBankDetails.branchName || vendor.bankDetails?.branchName,
            accountType: parsedBankDetails.accountType || vendor.bankDetails?.accountType,
            cancelledCheque: cancelledChequeUrl,
          };
        }
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid step number',
        });
    }

    await vendor.save();

    return res.status(200).json({
      success: true,
      message: `Step ${stepNum + 1} completed successfully`,
      vendor,
    });
  } catch (error: any) {
    console.error('Vendor onboarding error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// Submit vendor application for review
export const submitVendorApplication = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { termsAndConditionsAccepted } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found. Please complete the onboarding process first.',
      });
    }

    // Validate all required sections are completed
    const validationErrors = [];

    if (!vendor.pocInfo?.fullName || !vendor.pocInfo?.email || !vendor.pocInfo?.phone) {
      validationErrors.push('Contact information is incomplete');
    }

    const businessValidate = () =>
      !!(
        vendor.businessDetails?.businessName &&
        vendor.businessDetails?.businessRegistrationProof &&
        vendor.businessDetails?.panCard
      );

    const CertificateValidate = () =>
      !!(vendor.certification.experienceCertificate || vendor.certification.fixforeverCertificate);

    const interviewScheduleValidate = () =>
      !!(
        vendor.interviewSchedule?.experience &&
        vendor.interviewSchedule?.suitableDate &&
        vendor.interviewSchedule?.suitableTimeSlot &&
        vendor.interviewSchedule?.technicianLevel
      );

    // if (
    //   !businessValidate() ||
    //   !CertificateValidate() ||
    //   !interviewScheduleValidate()
    // ) {
    //   validationErrors.push('Experience details are incomplete');
    // }

    if (!vendor.idVerification?.governmentIdProof || !vendor.idVerification?.selfieVerification) {
      validationErrors.push('Identity verification is incomplete');
    }

    if (
      !vendor.servicesOffered?.hardwareRepairServices?.length ||
      !vendor.servicesOffered?.warrantyPeriod
    ) {
      validationErrors.push('Services offered information is incomplete');
    }

    if (
      !vendor.operationalDetails?.paymentMethods?.length ||
      !vendor.operationalDetails?.workingDays?.length
    ) {
      validationErrors.push('Operational details are incomplete');
    }

    if (
      !vendor.bankDetails?.accountNumber ||
      !vendor.bankDetails?.ifscCode ||
      !vendor.bankDetails?.cancelledCheque
    ) {
      validationErrors.push('Bank details are incomplete');
    }

    if (!termsAndConditionsAccepted) {
      validationErrors.push('Terms and conditions must be accepted');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Application is incomplete',
        errors: validationErrors,
      });
    }

    // Update vendor status
    vendor.termsAndConditionsAccepted = true;
    vendor.onboardingStatus = 'In Review';
    vendor.submittedAt = new Date();

    await vendor.save();

    // Draft is stored in Vendor schema only (like captains) - no separate draft cleanup needed

    // Send confirmation email
    try {
      await mailSender(
        vendor.pocInfo.email,
        'Vendor Application Submitted Successfully',
        `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Application Submitted Successfully!</h2>
                    <p>Dear ${vendor.pocInfo.fullName},</p>
                    <p>Thank you for submitting your vendor application. We have received your application and it is currently under review.</p>
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="color: #007bff; margin-top: 0;">What happens next?</h3>
                        <ul style="padding-left: 20px;">
                            <li>Our team will review your application within 2-3 business days</li>
                            <li>You'll receive email updates on your application status</li>
                            <li>Additional documents may be requested if needed</li>
                            <li>Once approved, you can start receiving service requests</li>
                        </ul>
                    </div>
                    <p>If you have any questions, please contact our support team.</p>
                    <p>Best regards,<br>The Support Team</p>
                </div>
                `
      );
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
      // Don't fail the request if email fails
    }

    return res.status(200).json({
      success: true,
      message: 'Application submitted successfully for review',
      vendor,
    });
  } catch (error: any) {
    console.error('Submit vendor application error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// Get comprehensive vendor statistics for dashboard
export const getVendorStats = async (req: AuthRequest, res: Response) => {
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
      // Return default stats instead of 404 for users without vendor profile yet
      return res.status(200).json({
        success: true,
        data: {
          totalRequests: 0,
          pendingRequests: 0,
          inProgressRequests: 0,
          completedRequests: 0,
          cancelledRequests: 0,
          totalEarnings: 0,
          thisMonthEarnings: 0,
          avgRating: 0,
          totalReviews: 0,
          completionRate: 0,
          responseTime: 0,
          activeServiceAreas: 0,
        },
        message: 'No vendor profile found. Please complete vendor onboarding.',
      });
    }

    // Import ServiceRequest model
    const ServiceRequest = require('../models/serviceRequest.model').default;

    // Get all service requests for this vendor
    const allRequests = await ServiceRequest.find({
      assignedTechnician: vendor._id,
    });

    // Calculate statistics
    const totalRequests = allRequests.length;
    const pendingRequests = allRequests.filter((req: any) => req.status === 'Pending').length;
    const inProgressRequests = allRequests.filter((req: any) =>
      ['Assigned', 'In Progress'].includes(req.status)
    ).length;
    const completedRequests = allRequests.filter((req: any) => req.status === 'Completed').length;
    const cancelledRequests = allRequests.filter((req: any) => req.status === 'Cancelled').length;

    // Calculate earnings (mock data for now)
    const totalEarnings = completedRequests * 1000; // ₹1000 per completed request
    const thisMonthEarnings = Math.floor(totalEarnings * 0.3); // 30% of total earnings

    // Calculate completion rate
    const completionRate = totalRequests > 0 ? (completedRequests / totalRequests) * 100 : 0;

    // Get rating from vendor profile
    const avgRating = (vendor as any).averageRating || 0;
    const totalReviews = (vendor as any).totalReviews || 0;

    // Calculate response time (mock data)
    const responseTime = 2; // hours

    // Get active service areas
    const activeServiceAreas = (vendor as any).operationalDetails?.serviceAreas?.length || 0;

    const stats = {
      totalRequests,
      pendingRequests,
      inProgressRequests,
      completedRequests,
      cancelledRequests,
      totalEarnings,
      thisMonthEarnings,
      avgRating,
      totalReviews,
      completionRate,
      responseTime,
      activeServiceAreas,
    };

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get vendor stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get vendor assigned service requests
export const getVendorAssignedRequests = async (req: Request, res: Response) => {
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

    // Import ServiceRequest model
    const ServiceRequest = require('../models/serviceRequest.model').default;

    // Get assigned service requests - check both assignedTechnician and assignedVendor fields
    const requests = await ServiceRequest.find({
      $or: [{ assignedTechnician: vendor._id }, { assignedVendor: vendor._id }],
    })
      .populate('customerId', 'username email phone')
      .sort({ createdAt: -1 });

    console.log('Vendor controller - Raw assigned requests found:', requests.length);

    // Debug: Log the first request to see what's in the database
    if (requests.length > 0) {
      const firstRequest = requests[0];
      console.log('Vendor controller - First assigned request debug info:', {
        _id: firstRequest._id,
        userPhone: firstRequest.userPhone,
        customerId: firstRequest.customerId,
        assignedTechnician: firstRequest.assignedTechnician,
        assignedVendor: firstRequest.assignedVendor,
        requestType: firstRequest.requestType,
        serviceType: firstRequest.serviceType,
        beneficiaryName: firstRequest.beneficiaryName,
        beneficiaryPhone: firstRequest.beneficiaryPhone,
      });
    }

    // Format requests for frontend
    const formattedRequests = requests.map((request: any) => ({
      _id: request._id,
      userId: request.customerId._id,
      title: request.title || `${request.brand} ${request.model}`,
      description: request.description || request.problemDescription,
      category: request.category || 'Device Repair',
      deviceType: request.deviceType || 'Unknown',
      deviceBrand: request.deviceBrand || request.brand,
      deviceModel: request.deviceModel || request.model,
      problemType: request.problemType || 'General',
      status: request.status.toLowerCase(),
      priority: request.priority || 'medium',
      budget: request.budget || 0,
      location: request.location || {
        address: request.address,
        lat: request.customerLocation?.latitude,
        lng: request.customerLocation?.longitude,
      },
      preferredDate: request.preferredDate || 'TBD',
      preferredTime: request.preferredTime || 'TBD',
      isUrgent: request.isUrgent || false,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      assignedVendor: request.assignedTechnician || request.assignedVendor,
      completedAt: request.completedAt,
      userDetails: {
        username: request.customerId.username,
        email: request.customerId.email,
        phone: request.customerId.phone,
      },
      customerId: {
        username: request.customerId.username,
        email: request.customerId.email,
        phone: request.customerId.phone,
      },
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
    }));

    return res.status(200).json({
      success: true,
      data: formattedRequests,
    });
  } catch (error) {
    console.error('Get vendor assigned requests error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update service request status
export const updateRequestStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { requestId } = req.params;
    const { status } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Get vendor profile
    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    // Import ServiceRequest model
    const ServiceRequest = require('../models/serviceRequest.model').default;

    // Find the service request - try request_id first, fall back to _id
    let request = await ServiceRequest.findOne({
      request_id: requestId,
      assignedVendor: vendor._id,
    });
    if (!request && Types.ObjectId.isValid(requestId)) {
      request = await ServiceRequest.findOne({
        _id: requestId,
        assignedVendor: vendor._id,
      });
    }

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    // Update status
    request.status = status;

    if (status === 'completed') {
      request.completedAt = new Date();
    }

    await request.save();

    return res.status(200).json({
      success: true,
      message: 'Request status updated successfully',
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

// Get vendor status for frontend refresh
export const getVendorStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const vendor = await Vendor.findOne({ 'pocInfo.userId': userId });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        onboardingStatus: vendor.onboardingStatus,
        vendorId: vendor._id,
        submittedAt: vendor.submittedAt,
        reviewedAt: vendor.reviewedAt,
        reviewComments: vendor.reviewComments,
      },
    });
  } catch (error: any) {
    console.error('Get vendor status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const getNearbyVendors = async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusKm = parseFloat((req.query.radius as string) || '15');

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: 'Valid lat and lng are required' });
    }

    const vendors = await Vendor.find({
      onboardingStatus: 'Approved',
      'pocInfo.latitude': { $exists: true, $ne: null },
      'pocInfo.longitude': { $exists: true, $ne: null },
    }).select('businessDetails.businessName pocInfo.fullName pocInfo.latitude pocInfo.longitude operationalDetails.workingHours');

    const nearby = vendors
      .filter(v => {
        const vLat = v.pocInfo?.latitude;
        const vLng = v.pocInfo?.longitude;
        if (!Number.isFinite(vLat) || !Number.isFinite(vLng) || (vLat === 0 && vLng === 0)) return false;
        return haversineKm(lat, lng, vLat!, vLng!) <= radiusKm;
      })
      .map(v => ({
        _id: v._id,
        name: (() => {
          const raw = v.businessDetails?.businessName || v.pocInfo?.fullName || '';
          if (!raw) return 'Fix4Ever';
          const words = raw.trim().split(/\s+/);
          const take = words.length >= 3 ? 2 : 1;
          return words.slice(0, take).join(' ') + ' Fix4Ever';
        })(),
        latitude: v.pocInfo.latitude!,
        longitude: v.pocInfo.longitude!,
        workingHours: v.operationalDetails?.workingHours,
      }));

    return res.status(200).json({ success: true, vendors: nearby });
  } catch (error: any) {
    console.error('getNearbyVendors error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
