import { AuthRequest } from '../middleware/auth.middleware';
import Review from '../models/review.model';
import Vendor from '../models/vendor.model';
import ServiceRequest from '../models/serviceRequest.model';
import { Request, Response } from 'express';
import mongoose from 'mongoose';

// Resolve a serviceRequestId that may be a request_id (e.g. "F4E20260300114") or an ObjectId string
const resolveServiceRequestObjectId = async (
  id: string
): Promise<mongoose.Types.ObjectId | null> => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  const sr = await ServiceRequest.findOne({ request_id: id }).select('_id').lean();
  return sr ? (sr._id as mongoose.Types.ObjectId) : null;
};

// Helper function to update vendor ratings
const updateVendorRatings = async (vendorId: string) => {
  try {
    const vendorObjectId = new mongoose.Types.ObjectId(vendorId);

    // Calculate ratings using the model's static method
    const ratingStats = await Review.calculateVendorRating(vendorId);

    // Calculate rating distribution
    const distributionData = await Review.aggregate([
      { $match: { vendorId: vendorObjectId } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 },
        },
      },
    ]);

    // Convert to rating distribution object
    const ratingDistribution = new Map([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);

    distributionData.forEach(item => {
      if (item._id >= 1 && item._id <= 5) {
        ratingDistribution.set(item._id, item.count);
      }
    });

    // Update vendor document
    await Vendor.findByIdAndUpdate(vendorId, {
      averageRating: ratingStats.averageRating || 0,
      totalReviews: ratingStats.totalReviews || 0,
      ratingBreakdown: {
        serviceQuality: ratingStats.averageServiceQuality || 0,
        communication: ratingStats.averageCommunication || 0,
        punctuality: ratingStats.averagePunctuality || 0,
        overallExperience: ratingStats.averageOverallExperience || 0,
      },
      ratingDistribution: ratingDistribution,
    });
  } catch (error) {
    console.error('Error updating vendor ratings:', error);
  }
};

export const addReview = async (req: AuthRequest, res: Response) => {
  try {
    const { vendorId } = req.params;
    const {
      rating,
      comment,
      serviceQuality,
      communication,
      punctuality,
      overallExperience,
      serviceRequestId,
      wouldRecommend,
    } = req.body;
    const customerId = req.user?.userId;

    // Validate required fields
    if (!vendorId || vendorId === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required',
      });
    }

    if (
      !rating ||
      !comment ||
      !serviceQuality ||
      !communication ||
      !punctuality ||
      !overallExperience ||
      !serviceRequestId
    ) {
      return res.status(400).json({
        success: false,
        message: 'All rating fields and service request ID are required',
      });
    }

    // Resolve request_id → ObjectId
    const resolvedServiceRequestId = await resolveServiceRequestObjectId(serviceRequestId);
    if (!resolvedServiceRequestId) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    // Check if user already reviewed this service request
    const existingReview = await Review.findOne({
      customerId,
      vendorId,
      serviceRequestId: resolvedServiceRequestId,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this service',
      });
    }

    // Create the review with enhanced fields
    const review = await Review.create({
      vendorId,
      customerId,
      serviceRequestId: resolvedServiceRequestId,
      rating: Number(rating),
      comment: comment.trim(),
      serviceQuality: Number(serviceQuality),
      communication: Number(communication),
      punctuality: Number(punctuality),
      overallExperience: Number(overallExperience),
      wouldRecommend: wouldRecommend !== undefined ? Boolean(wouldRecommend) : true,
      isVerified: true,
    });

    // Update vendor ratings asynchronously
    await updateVendorRatings(vendorId);

    // Populate the review for response
    const populatedReview = await Review.findById(review._id)
      .populate('customerId', 'username')
      .populate('vendorId', 'pocInfo.fullName');

    res.status(201).json({
      success: true,
      review: populatedReview,
      message: 'Review submitted successfully!',
    });
  } catch (err: any) {
    console.error('Error adding review:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to add review',
    });
  }
};

export const getVendorReviews = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find({ vendorId })
        .populate('customerId', 'username')
        .populate('serviceRequestId', 'brand model problemDescription')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments({ vendorId }),
    ]);

    res.status(200).json({
      success: true,
      reviews,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
};

export const getVendorRatingStats = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;

    // Get enhanced rating statistics
    const ratingStats = await Review.calculateVendorRating(vendorId);

    // Get rating distribution
    const distributionData = await Review.aggregate([
      { $match: { vendorId: new mongoose.Types.ObjectId(vendorId) } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Format distribution data
    const ratingDistribution = [1, 2, 3, 4, 5].map(rating => ({
      rating,
      count: distributionData.find(item => item._id === rating)?.count || 0,
    }));

    res.status(200).json({
      success: true,
      averageRating: ratingStats.averageRating || 0,
      totalReviews: ratingStats.totalReviews || 0,
      ratingBreakdown: {
        serviceQuality: ratingStats.averageServiceQuality || 0,
        communication: ratingStats.averageCommunication || 0,
        punctuality: ratingStats.averagePunctuality || 0,
        overallExperience: ratingStats.averageOverallExperience || 0,
      },
      ratingDistribution,
    });
  } catch (err) {
    console.error('Error getting rating stats:', err);
    res.status(500).json({ success: false, message: 'Failed to get rating stats' });
  }
};

export const getCustomerReviews = async (req: AuthRequest, res: Response) => {
  try {
    const customerId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find({ customerId })
        .populate('vendorId', 'pocInfo.fullName pocInfo.businessName')
        .populate('serviceRequestId', 'brand model problemDescription')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments({ customerId }),
    ]);

    res.status(200).json({
      success: true,
      reviews,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Error fetching customer reviews:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch your reviews' });
  }
};

export const updateReview = async (req: AuthRequest, res: Response) => {
  try {
    const { reviewId } = req.params;
    const { rating, comment, serviceQuality, communication, punctuality, overallExperience } =
      req.body;
    const userId = req.user?.userId;

    const review = await Review.findOne({ _id: reviewId, customerId: userId });

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found or not yours' });
    }

    // Update fields if provided
    if (rating !== undefined) review.rating = Number(rating);
    if (comment !== undefined) review.comment = comment.trim();
    if (serviceQuality !== undefined) review.serviceQuality = Number(serviceQuality);
    if (communication !== undefined) review.communication = Number(communication);
    if (punctuality !== undefined) review.punctuality = Number(punctuality);
    if (overallExperience !== undefined) review.overallExperience = Number(overallExperience);

    await review.save();

    // Update vendor ratings
    updateVendorRatings(review.vendorId.toString());

    const populatedReview = await Review.findById(review._id)
      .populate('customerId', 'username')
      .populate('vendorId', 'pocInfo.fullName');

    res.status(200).json({ success: true, review: populatedReview });
  } catch (err) {
    console.error('Error updating review:', err);
    res.status(500).json({ success: false, message: 'Failed to update review' });
  }
};

export const deleteReview = async (req: AuthRequest, res: Response) => {
  try {
    const { reviewId } = req.params;
    const userId = req.user?.userId;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    if (review.customerId.toString() !== userId) {
      return res
        .status(403)
        .json({ success: false, message: 'Unauthorized to delete this review' });
    }

    const vendorId = review.vendorId.toString();
    await Review.findByIdAndDelete(reviewId);

    // Update vendor ratings after deletion
    updateVendorRatings(vendorId);

    res.status(200).json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const markReviewAsHelpful = async (req: AuthRequest, res: Response) => {
  try {
    const { reviewId } = req.params;

    const review = await Review.findByIdAndUpdate(
      reviewId,
      { $inc: { helpfulVotes: 1 } },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    res.status(200).json({
      success: true,
      helpfulVotes: review.helpfulVotes,
      message: 'Marked as helpful!',
    });
  } catch (error) {
    console.error('Error marking review as helpful:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const checkReviewStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { vendorId, serviceRequestId } = req.params;
    const customerId = req.user?.userId;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const resolvedServiceRequestId = await resolveServiceRequestObjectId(serviceRequestId);

    const existingReview = resolvedServiceRequestId
      ? await Review.findOne({ customerId, vendorId, serviceRequestId: resolvedServiceRequestId })
      : null;

    res.status(200).json({
      success: true,
      hasReviewed: !!existingReview,
    });
  } catch (error: any) {
    console.error('Error checking review status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check review status',
      error: error.message,
    });
  }
};
