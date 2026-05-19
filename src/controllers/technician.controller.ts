import { Request, Response } from 'express';
import Vendor from '../models/vendor.model';
import ServiceRequest from '../models/serviceRequest.model';

export const getAllTechnicians = async (req: Request, res: Response) => {
  try {
    // Check if user is authenticated and has appropriate role
    const userRole = (req as any).user?.role;
    if (!userRole || !['admin', 'user', 'vendor', 'captain'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
      });
    }
    // Fetch all vendors who are approved and have services offered
    const technicians = await Vendor.find({
      onboardingStatus: 'Approved',
      'servicesOffered.hardwareRepairServices': { $exists: true, $ne: [] },
    }).select(
      'pocInfo.fullName pocInfo.correspondenceAddress businessDetails.businessName businessDetails.registeredOfficeAddress idVerification.selfieVerification servicesOffered operationalDetails.teamSize averageRating totalReviews createdAt'
    );

    // Calculate ratings for each technician
    const techniciansWithRatings = await Promise.all(
      technicians.map(async tech => {
        // Get all completed service requests for this technician
        const completedRequests = await ServiceRequest.find({
          assignedVendor: tech._id,
          status: 'completed',
        }).select('customerRating');

        // Calculate average rating
        const ratings = completedRequests
          .map(req => req.customerRating)
          .filter(rating => rating && rating > 0);

        const averageRating =
          ratings.length > 0
            ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
            : 0;

        const totalReviews = ratings.length;

        // Calculate experience in years based on creation date
        const experienceYears = tech.createdAt
          ? Math.floor(
              (Date.now() - new Date(tech.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365)
            )
          : 0;

        // Use shop address (prefer business address, fallback to correspondence address)
        const shopAddress =
          tech.businessDetails?.registeredOfficeAddress ||
          tech.pocInfo?.correspondenceAddress ||
          'Address not provided';

        return {
          id: tech._id,
          name: tech.pocInfo?.fullName || tech.businessDetails?.businessName || 'Technician',
          businessName: tech.businessDetails?.businessName || '',
          photo:
            tech.idVerification?.selfieVerification ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(tech.pocInfo?.fullName || tech.businessDetails?.businessName || 'Technician')}&background=random&color=fff&size=128`,
          rating: Math.round(averageRating * 10) / 10, // Round to 1 decimal place
          totalReviews,
          shopAddress,
          experienceYears,
          teamSize: tech.operationalDetails?.teamSize || 1,
          servicesOffered: tech.servicesOffered?.hardwareRepairServices || [],
        };
      })
    );

    // Sort by rating (highest first), then by total reviews
    techniciansWithRatings.sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.totalReviews - a.totalReviews;
    });

    res.status(200).json({
      success: true,
      data: techniciansWithRatings,
      count: techniciansWithRatings.length,
    });
  } catch (error) {
    console.error('Error fetching technicians:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch technicians',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
