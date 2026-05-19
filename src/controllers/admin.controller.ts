import { Request, Response } from 'express';
import Vendor from '../models/vendor.model';
import User from '../models/user.model';
import ServiceRequest from '../models/serviceRequest.model';
import TestSubmission from '../models/testSubmission.model';
import CustomerWallet from '../models/customerWallet.model';
import TechnicianWallet from '../models/technicianWallet.model';
import CaptainWallet from '../models/captainWallet.model';
import PaymentTransaction from '../models/PaymentTransaction.model';
import Captain from '../models/captain.model';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

// Simple admin access verification endpoint
export const verifyAdminAccess = async (req: Request, res: Response) => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;
    const userEmail = req.user?.email;

    console.log('Admin access verification:', {
      userId,
      userEmail,
      userRole,
      hasUser: !!req.user,
    });

    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
        debug: {
          hasUser: !!req.user,
          userRole,
          userId,
          userEmail,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Admin access verified',
      user: {
        userId,
        email: userEmail,
        role: userRole,
      },
    });
  } catch (error) {
    console.error('Admin verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Middleware to check admin role
const checkAdminRole = (req: Request, res: Response, next: Function) => {
  const userRole = req.user?.role;

  if (!userRole || userRole !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin role required.',
    });
  }

  next();
};

// Get all vendor applications for review
export const getVendorApplications = async (req: Request, res: Response) => {
  try {
    // Check admin role
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const { status = 'all', page = 1, limit = 50 } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};
    if (status && status !== 'all') {
      filter.onboardingStatus = status;
    }

    const vendors = await Vendor.find(filter)
      .populate('pocInfo.userId', 'username email createdAt')
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Vendor.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: vendors, // Frontend expects data property
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  } catch (error) {
    console.error('Get vendor applications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get single vendor application details
export const getVendorApplication = async (req: Request, res: Response) => {
  try {
    // Check admin role
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const { vendorId } = req.params;

    const vendor = await Vendor.findById(vendorId)
      .populate('pocInfo.userId', 'username email phone createdAt')
      .populate('reviewedBy', 'username email');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor application not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    console.error('Get vendor application error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Review vendor application (approve/reject)
export const reviewVendorApplication = async (req: Request, res: Response) => {
  try {
    // Check admin role
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const { vendorId } = req.params;
    const { action, comments } = req.body; // action: 'approve' | 'reject'
    const adminUserId = req.user?.userId;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    if (!action || !['approve', 'reject', 'clarification'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be "approve", "reject", or "clarification"',
      });
    }

    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor application not found',
      });
    }

    // Update vendor status based on action
    if (action === 'clarification') {
      vendor.onboardingStatus = 'In Review';
      vendor.reviewComments = comments || '';
      vendor.clarificationRequested = true;
      vendor.clarificationRequestedAt = new Date();
    } else {
      vendor.onboardingStatus = action === 'approve' ? 'Approved' : 'Rejected';
      vendor.reviewedAt = new Date();
      vendor.reviewedBy = new mongoose.Types.ObjectId(adminUserId);
      vendor.reviewComments = comments || '';
    }

    await vendor.save();

    // If approved, update user's role to vendor
    if (action === 'approve' && vendor.pocInfo.userId) {
      await User.findByIdAndUpdate(vendor.pocInfo.userId, {
        role: 'vendor',
        isVendor: true,
      });
    }

    // Send notification email to vendor
    try {
      const mailSender = require('../utils/mailSender').default;
      let emailContent = '';
      let emailSubject = '';

      if (action === 'approve') {
        emailSubject = 'Vendor Application Approved';
        emailContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #28a745;">🎉 Application Approved!</h2>
            <p>Dear ${vendor.pocInfo.fullName},</p>
            <p>Congratulations! Your vendor application has been approved.</p>
            <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <h3 style="color: #155724; margin-top: 0;">What's Next?</h3>
              <ul style="padding-left: 20px; color: #155724;">
                <li>You can now log in to your vendor dashboard</li>
                <li>Start receiving and managing service requests</li>
                <li>Update your profile and services offered</li>
                <li>Begin earning with our platform</li>
              </ul>
            </div>
            <p><a href="${process.env.CORS_ORIGIN}/dashboard" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Access Dashboard</a></p>
            <p>Welcome to our vendor network!</p>
            <p>Best regards,<br>The Admin Team</p>
          </div>
        `;
      } else if (action === 'reject') {
        emailSubject = 'Vendor Application Rejected';
        emailContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc3545;">Application Update</h2>
            <p>Dear ${vendor.pocInfo.fullName},</p>
            <p>We regret to inform you that your vendor application has been rejected.</p>
            ${
              comments
                ? `
              <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
                <h3 style="color: #721c24; margin-top: 0;">Review Comments:</h3>
                <p style="color: #721c24;">${comments}</p>
              </div>
            `
                : ''
            }
            <div style="background-color: #e2e3e5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #383d41; margin-top: 0;">What You Can Do:</h3>
              <ul style="padding-left: 20px; color: #383d41;">
                <li>Review the feedback provided</li>
                <li>Make necessary improvements to your application</li>
                <li>Reapply when ready</li>
                <li>Contact support if you need clarification</li>
              </ul>
            </div>
            <p>If you have any questions, please contact our support team.</p>
            <p>Best regards,<br>The Admin Team</p>
          </div>
        `;
      } else if (action === 'clarification') {
        emailSubject = 'Vendor Application - Clarification Required';
        emailContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ffc107;">📋 Clarification Required</h2>
            <p>Dear ${vendor.pocInfo.fullName},</p>
            <p>Your vendor application requires additional clarification before we can proceed with the review.</p>
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin-top: 0;">Clarification Request:</h3>
              <p style="color: #856404;">${comments}</p>
            </div>
            <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
              <h3 style="color: #0056b3; margin-top: 0;">Next Steps:</h3>
              <ul style="padding-left: 20px; color: #0056b3;">
                <li>Review the clarification request above</li>
                <li>Update your application with the required information</li>
                <li>Resubmit your application when ready</li>
                <li>Contact support if you need assistance</li>
              </ul>
            </div>
            <p><a href="${process.env.CORS_ORIGIN}/vendor-onboarding" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Update Application</a></p>
            <p>Best regards,<br>The Admin Team</p>
          </div>
        `;
      }

      await mailSender(vendor.pocInfo.email, emailSubject, emailContent);
    } catch (emailError) {
      console.error('Error sending notification email:', emailError);
      // Don't fail the request if email fails
    }

    return res.status(200).json({
      success: true,
      message: `Vendor application ${action}d successfully`,
      data: vendor,
    });
  } catch (error) {
    console.error('Review vendor application error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get vendor statistics for admin dashboard
export const getVendorStats = async (req: Request, res: Response) => {
  try {
    // Check admin role
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const totalVendors = await Vendor.countDocuments();
    const approvedVendors = await Vendor.countDocuments({
      onboardingStatus: 'Approved',
    });
    const pendingVendors = await Vendor.countDocuments({
      onboardingStatus: 'Pending',
    });
    const inReviewVendors = await Vendor.countDocuments({
      onboardingStatus: 'In Review',
    });
    const rejectedVendors = await Vendor.countDocuments({
      onboardingStatus: 'Rejected',
    });

    // Recent applications (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentApplications = await Vendor.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    // Stats structure that matches frontend expectations
    const stats = {
      total: totalVendors,
      approved: approvedVendors,
      pending: pendingVendors,
      inReview: inReviewVendors,
      rejected: rejectedVendors,
      recentApplications,
    };

    return res.status(200).json({
      success: true,
      data: stats, // Frontend expects data property
    });
  } catch (error) {
    console.error('Get vendor stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Assign technician to service request
export const assignTechnicianToRequest = async (req: Request, res: Response) => {
  try {
    // Check admin role
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const { requestId, technicianId } = req.body;

    if (!requestId || !technicianId) {
      return res.status(400).json({
        success: false,
        message: 'Both requestId and technicianId are required',
      });
    }

    // Find the service request (by request_id or _id)
    let serviceRequest = await ServiceRequest.findOne({ request_id: requestId }).populate(
      'customerId',
      'username email phone'
    );
    if (!serviceRequest && mongoose.Types.ObjectId.isValid(requestId)) {
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

    // Find the technician (vendor)
    const technician = await Vendor.findById(technicianId);

    if (!technician) {
      return res.status(404).json({
        success: false,
        message: 'Technician not found',
      });
    }

    // Check if technician is approved
    if (technician.onboardingStatus !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Technician is not approved yet',
      });
    }

    // Update service request (admin override: no level restriction)
    serviceRequest.assignedTechnician = technicianId;
    serviceRequest.assignedVendor = technicianId; // For compatibility with vendor-assigned flows
    serviceRequest.status = 'Assigned';
    serviceRequest.assignedAt = new Date();

    await serviceRequest.save();

    // Send notification email to technician
    try {
      const mailSender = require('../utils/mailSender').default;
      const emailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #007bff;">🔧 New Service Request Assigned</h2>
          <p>Dear ${technician.pocInfo.fullName},</p>
          <p>You have been assigned a new service request by our admin team.</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
            <h3 style="color: #007bff; margin-top: 0;">Service Request Details:</h3>
            <p><strong>Request ID:</strong> ${serviceRequest._id}</p>
            <p><strong>Customer:</strong> ${serviceRequest.customerId.username}</p>
            <p><strong>Issue:</strong> ${serviceRequest.issueDescription}</p>
            <p><strong>Budget:</strong> ₹${serviceRequest.budget}</p>
            <p><strong>Location:</strong> ${serviceRequest.address}</p>
          </div>
          <div style="background-color: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #0056b3; margin-top: 0;">Next Steps:</h3>
            <ul style="padding-left: 20px; color: #0056b3;">
              <li>Review the service request details</li>
              <li>Accept or reject the assignment</li>
              <li>Contact the customer if needed</li>
              <li>Update your location when you accept</li>
            </ul>
          </div>
          <p><a href="${process.env.CORS_ORIGIN}/dashboard" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">View in Dashboard</a></p>
          <p>Best regards,<br>The Admin Team</p>
        </div>
      `;

      await mailSender(technician.pocInfo.email, 'New Service Request Assigned', emailContent);
    } catch (emailError) {
      console.error('Error sending assignment email:', emailError);
    }

    // Send notification email to customer
    try {
      const mailSender = require('../utils/mailSender').default;
      const customerEmailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #28a745;">👨‍🔧 Technician Assigned to Your Request</h2>
          <p>Dear ${serviceRequest.customerId.username},</p>
          <p>Great news! We've assigned a qualified technician to your service request.</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
            <h3 style="color: #28a745; margin-top: 0;">Assigned Technician:</h3>
            <p><strong>Name:</strong> ${technician.pocInfo.fullName}</p>
            <p><strong>Business:</strong> ${technician.businessDetails?.businessName}</p>
            <p><strong>Experience:</strong> ${technician.servicesOffered?.hardwareRepairServices?.length || 0} services offered</p>
            <p><strong>Contact:</strong> ${technician.pocInfo.phone}</p>
          </div>
          <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #155724; margin-top: 0;">What Happens Next:</h3>
            <ul style="padding-left: 20px; color: #155724;">
              <li>The technician will review your request</li>
              <li>They will contact you to schedule the service</li>
              <li>You'll receive real-time location updates when they're on their way</li>
              <li>Service will be completed as per your requirements</li>
            </ul>
          </div>
          <p><a href="${process.env.CORS_ORIGIN}/dashboard" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Track Your Request</a></p>
          <p>Best regards,<br>The Support Team</p>
        </div>
      `;

      await mailSender(
        serviceRequest.customerId.email,
        'Technician Assigned to Your Request',
        customerEmailContent
      );
    } catch (emailError) {
      console.error('Error sending customer notification email:', emailError);
    }

    return res.status(200).json({
      success: true,
      message: 'Technician assigned successfully',
      data: {
        serviceRequest,
        technician: {
          id: technician._id,
          name: technician.pocInfo.fullName,
          business: technician.businessDetails?.businessName,
          experience: technician.servicesOffered?.hardwareRepairServices?.length || 0,
        },
      },
    });
  } catch (error) {
    console.error('Admin assign technician error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Get all service requests for management
export const getAllServiceRequests = async (req: Request, res: Response) => {
  try {
    // Check admin role
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const { status = 'all', page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const serviceRequests = await ServiceRequest.find(filter)
      .populate('customerId', 'username email phone')
      .populate(
        'assignedTechnician',
        'pocInfo.fullName pocInfo.email pocInfo.correspondenceAddress pocInfo.latitude pocInfo.longitude businessDetails.businessName businessDetails.registeredOfficeAddress businessDetails.website experience rating averageRating totalReviews'
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await ServiceRequest.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: serviceRequests,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  } catch (error) {
    console.error('Get all service requests error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Get available technicians for assignment
export const getAvailableTechnicians = async (req: Request, res: Response) => {
  try {
    // Check admin role
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const { serviceType } = req.query;

    const filter: any = {
      onboardingStatus: 'Approved',
    };

    // Filter by service type if provided
    if (serviceType) {
      filter['servicesOffered.hardwareRepairServices'] = {
        $in: [serviceType],
      };
    }

    const technicians = await Vendor.find(filter)
      .select(
        'pocInfo.fullName pocInfo.email pocInfo.phone businessDetails.businessName servicesOffered.yearsOfExperience servicesOffered.hardwareRepairServices operationalDetails.paymentMethods'
      )
      .sort({ 'servicesOffered.yearsOfExperience': -1 });

    return res.status(200).json({
      success: true,
      data: technicians,
    });
  } catch (error) {
    console.error('Get available technicians error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Get all test submissions from MongoDB
export const getTestSubmissions = async (req: Request, res: Response) => {
  // try {
  //   // Check admin role
  //   const userRole = req.user?.role;
  //   if (!userRole || userRole !== 'admin') {
  //     return res.status(403).json({
  //       success: false,
  //       message: 'Access denied. Admin role required.',
  //     });
  //   }
  //   // Fetch all test submissions from MongoDB
  //   const pendingVendors = await Vendor.find(
  //     { onboardingStatus: { $in: ['Pending', 'Not Started'] } },
  //     { 'pocInfo.email': 1, _id: 0 }
  //   ).lean();
  //   const pendingEmails = pendingVendors.map(v => v.pocInfo?.email).filter(Boolean);
  //   // console.log(pendingEmails);
  //   const submissions = await TestSubmission.find({
  //     userEmail: { $in: pendingEmails },
  //   })
  //     .sort({ submittedAt: -1 })
  //     .lean();
  //   console.log(submissions);
  //   // const submissions = await TestSubmission.find({})
  //   //   .populate('userId', 'username email')
  //   //   .sort({ submittedAt: -1 })
  //   //   .lean();
  //   // Transform to match frontend interface
  //   const formattedSubmissions = submissions.map(submission => {
  //     const user = submission.userId as any;
  //     return {
  //       userId: submission._id.toString(), // Use submission ID as userId for API calls
  //       userName: submission.userName || user?.username || 'Unknown',
  //       userEmail: submission.userEmail || user?.email || '',
  //       submittedAt: submission.submittedAt.toISOString(),
  //       videos: submission.videos.map(video => ({
  //         questionId: video.questionId,
  //         fileName: video.fileName,
  //         url: video.s3Url, // Use S3 URL directly - frontend will fetch from S3
  //         size: video.size,
  //         uploadedAt: video.uploadedAt.toISOString(),
  //       })),
  //       totalQuestions: submission.totalQuestions,
  //       review: submission.review
  //         ? {
  //             marks: submission.review.marks,
  //             total: submission.review.total,
  //             reviewedAt: submission.review.reviewedAt.toISOString(),
  //           }
  //         : undefined,
  //     };
  //   });
  //   return res.status(200).json({
  //     success: true,
  //     data: formattedSubmissions,
  //   });
  // } catch (error) {
  //   console.error('Get test submissions error:', error);
  //   return res.status(500).json({
  //     success: false,
  //     message: 'Internal server error',
  //   });
  // }
};

// Admin: Download/Play test video from S3
export const downloadTestVideo = async (req: Request, res: Response) => {
  // try {
  //   // Check admin role
  //   const userRole = req.user?.role;
  //   if (!userRole || userRole !== 'admin') {
  //     return res.status(403).json({
  //       success: false,
  //       message: 'Access denied. Admin role required.',
  //     });
  //   }
  //   const { userId, questionId } = req.params;
  //   // Find submission by ID (userId is now the submission ID)
  //   const submission = await TestSubmission.findById(userId);
  //   if (!submission) {
  //     return res.status(404).json({
  //       success: false,
  //       message: 'Test submission not found',
  //     });
  //   }
  //   // Find the video for this question
  //   const video = submission.videos.find(v => v.questionId === parseInt(questionId));
  //   if (!video) {
  //     return res.status(404).json({
  //       success: false,
  //       message: 'Video not found for this question',
  //     });
  //   }
  //   // Redirect to S3 URL or return presigned URL
  //   // For direct access, return the S3 URL
  //   // For download, we can generate a presigned URL or redirect
  //   const isDownload = req.query.download === 'true';
  //   if (isDownload) {
  //     // For download, redirect to S3 URL with download disposition
  //     // Or generate a presigned URL with download parameter
  //     const { getPresignedUrl } = require('../utils/s3Upload');
  //     const presignedUrl = await getPresignedUrl(video.s3Key, 3600); // 1 hour expiry
  //     if (presignedUrl) {
  //       return res.redirect(presignedUrl);
  //     } else {
  //       // Fallback to direct S3 URL
  //       return res.redirect(video.s3Url);
  //     }
  //   } else {
  //     // For playback, return S3 URL (or presigned URL if bucket is private)
  //     return res.json({
  //       success: true,
  //       url: video.s3Url,
  //       fileName: video.fileName,
  //     });
  //   }
  // } catch (error) {
  //   console.error('Download test video error:', error);
  //   return res.status(500).json({
  //     success: false,
  //     message: 'Internal server error',
  //   });
  // }
};

// Admin: PATCH test submission review (store marks in MongoDB and vendor details)
export const patchTestSubmissionReview = async (req: Request, res: Response) => {
  try {
    const userRole = req.user?.role;
    if (!userRole || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    const { userId } = req.params; // userId is now the submission ID
    const { marks, total } = req.body as { marks: Record<string, number>; total: number };

    if (!marks || typeof marks !== 'object' || typeof total !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Request body must include marks (object) and total (number).',
      });
    }

    // Find submission by ID
    const submission = await TestSubmission.findById(userId).populate('userId');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Test submission not found',
      });
    }

    // Update review in test submission
    submission.review = {
      marks,
      total,
      reviewedAt: new Date(),
    };

    await submission.save();

    // Also update vendor details with marks if user is a vendor
    try {
      const Vendor = require('../models/vendor.model').default;
      const vendor = await Vendor.findOne({ 'pocInfo.userId': submission.userId });

      if (vendor) {
        vendor.TotalMarks = total;
        vendor.onboardingStatus = 'Pending';
        // Determine level based on total marks
        if (total >= 80) {
          vendor.Level = 'L4';
        } else if (total >= 60) {
          vendor.Level = 'L3';
        } else if (total >= 40) {
          vendor.Level = 'L2';
        } else if (total >= 20) {
          vendor.Level = 'L1';
        }
        await vendor.save();
        console.log(`Updated vendor ${vendor._id} with marks: ${total}, level: ${vendor.Level}`);
      }
    } catch (vendorError) {
      console.error('Error updating vendor marks:', vendorError);
      // Don't fail the request if vendor update fails
    }

    return res.status(200).json({
      success: true,
      data: {
        marks: submission.review.marks,
        total: submission.review.total,
        reviewedAt: submission.review.reviewedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Patch test submission review error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get all users (admin)
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { role, search, page = 1, limit = 100 } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const filter: any = {};
    if (role && role !== 'all') filter.role = role;
    if (search) {
      const q = new RegExp(search as string, 'i');
      filter.$or = [{ username: q }, { email: q }, { phone: q }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  } catch (error) {
    console.error('getAllUsers error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get single user detail with wallet + service request summary (admin)
export const getUserById = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { userId } = req.params;

    const [user, requests] = await Promise.all([
      User.findById(userId).select('-password'),
      ServiceRequest.find({ customerId: userId })
        .select('request_id status serviceType brand model createdAt')
        .sort({ createdAt: -1 })
        .limit(20),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Fetch wallet based on role
    let wallet: any = null;
    if (user.role === 'vendor') {
      const vendorDoc = await Vendor.findOne({ 'pocInfo.userId': userId }).select('_id');
      if (vendorDoc) {
        wallet = await TechnicianWallet.findOne({ technicianId: vendorDoc._id });
      }
    } else if (user.role === 'captain') {
      const captainDoc = await Captain.findOne({ 'personalInfo.userId': userId }).select('_id');
      if (captainDoc) {
        wallet = await CaptainWallet.findOne({ captainId: captainDoc._id });
      }
    } else {
      wallet = await CustomerWallet.findOne({ userId });
    }

    const srStats = requests.reduce(
      (acc: any, r: any) => {
        acc.total++;
        if (r.status === 'Completed') acc.completed++;
        else if (r.status === 'Cancelled') acc.cancelled++;
        else acc.active++;
        return acc;
      },
      { total: 0, completed: 0, cancelled: 0, active: 0 }
    );

    return res.status(200).json({
      success: true,
      data: { user, wallet, requests, srStats },
    });
  } catch (error) {
    console.error('getUserById error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Admin analytics endpoint
export const getAnalytics = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      userCounts,
      vendorStatusCounts,
      vendorLevelCounts,
      captainStatusCounts,
      srStatusCounts,
      srTypeCounts,
      srMonthlyTrend,
      userMonthlyGrowth,
      paymentStats,
      revenueMonthlyTrend,
    ] = await Promise.all([
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      Vendor.aggregate([{ $group: { _id: '$onboardingStatus', count: { $sum: 1 } } }]),
      Vendor.aggregate([
        { $match: { onboardingStatus: 'Approved' } },
        { $group: { _id: '$Level', count: { $sum: 1 } } },
      ]),
      Captain.aggregate([{ $group: { _id: '$onboardingStatus', count: { $sum: 1 } } }]),
      ServiceRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ServiceRequest.aggregate([{ $group: { _id: '$serviceType', count: { $sum: 1 } } }]),
      ServiceRequest.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo }, role: 'user' } },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      PaymentTransaction.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, '$amount', 0] } },
            platformRevenue: {
              $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, '$platformFee', 0] },
            },
            vendorEarnings: {
              $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, '$vendorEarnings', 0] },
            },
            totalTransactions: { $sum: 1 },
            completedTransactions: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
            totalGst: {
              $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, '$gstBreakdown.gstAmount', 0] },
            },
          },
        },
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: 'Completed', createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            revenue: { $sum: '$amount' },
            platformFee: { $sum: '$platformFee' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);

    const monthLabel = (year: number, month: number) =>
      new Date(year, month - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });

    const allMonths: { year: number; month: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      allMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const srTrend = allMonths.map(({ year, month }) => {
      const f = (srMonthlyTrend as any[]).find(r => r._id.year === year && r._id.month === month);
      return {
        month: monthLabel(year, month),
        total: f?.total || 0,
        completed: f?.completed || 0,
        cancelled: f?.cancelled || 0,
      };
    });

    const userGrowth = allMonths.map(({ year, month }) => {
      const f = (userMonthlyGrowth as any[]).find(
        r => r._id.year === year && r._id.month === month
      );
      return { month: monthLabel(year, month), count: f?.count || 0 };
    });

    const revenueTrend = allMonths.map(({ year, month }) => {
      const f = (revenueMonthlyTrend as any[]).find(
        r => r._id.year === year && r._id.month === month
      );
      return {
        month: monthLabel(year, month),
        revenue: f?.revenue || 0,
        platformFee: f?.platformFee || 0,
      };
    });

    const toMap = (arr: any[]) =>
      arr.reduce((acc: any, r: any) => {
        acc[r._id] = r.count;
        return acc;
      }, {});

    const roleMap = toMap(userCounts as any[]);
    const srStatusMap = toMap(srStatusCounts as any[]);
    const srTypeMap = toMap(srTypeCounts as any[]);
    const vendorStatusMap = toMap(vendorStatusCounts as any[]);
    const captainStatusMap = toMap(captainStatusCounts as any[]);
    const vendorLevelMap: Record<string, number> = { L1: 0, L2: 0, L3: 0, L4: 0 };
    (vendorLevelCounts as any[]).forEach(r => {
      if (r._id) vendorLevelMap[r._id] = r.count;
    });

    const payment = (paymentStats as any[])[0] || {
      totalRevenue: 0,
      platformRevenue: 0,
      vendorEarnings: 0,
      totalTransactions: 0,
      completedTransactions: 0,
      totalGst: 0,
    };
    const totalSR = (Object.values(srStatusMap) as number[]).reduce((a, b) => a + b, 0);
    const completedSR = (srStatusMap['Completed'] as number) || 0;

    return res.status(200).json({
      success: true,
      data: {
        overview: {
          totalCustomers: roleMap['user'] || 0,
          totalVendors: roleMap['vendor'] || 0,
          approvedVendors: vendorStatusMap['Approved'] || 0,
          totalCaptains: roleMap['captain'] || 0,
          approvedCaptains: captainStatusMap['Approved'] || 0,
          totalServiceRequests: totalSR,
          completedRequests: completedSR,
          pendingRequests: srStatusMap['Pending'] || 0,
          completionRate: totalSR > 0 ? Math.round((completedSR / totalSR) * 100) : 0,
          totalRevenue: payment.totalRevenue,
          platformRevenue: payment.platformRevenue,
          vendorEarnings: payment.vendorEarnings,
          totalGst: payment.totalGst,
          totalTransactions: payment.totalTransactions,
          completedTransactions: payment.completedTransactions,
        },
        srByStatus: srStatusMap,
        srByType: srTypeMap,
        vendorByStatus: vendorStatusMap,
        vendorByLevel: vendorLevelMap,
        captainByStatus: captainStatusMap,
        trends: { serviceRequests: srTrend, userGrowth, revenue: revenueTrend },
      },
    });
  } catch (error) {
    console.error('getAnalytics error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
