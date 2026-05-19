import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  validateCoupon,
  applyCoupon,
  getAvailableCouponsForUser,
  getUserCouponHistory,
} from '../utils/couponService';

/**
 * POST /api/coupon/validate
 * Validate a coupon code before applying it.
 * Body: { code, orderValue, serviceCategory? }
 */
export const validateCouponController = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { code, orderValue, serviceCategory } = req.body;
    if (!code || orderValue === undefined) {
      return res.status(400).json({ success: false, message: 'code and orderValue are required' });
    }

    const result = await validateCoupon(code, userId, Number(orderValue), serviceCategory);

    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.error });
    }

    return res.json({
      success: true,
      data: {
        discountAmount: result.discountAmount,
        couponCode: result.coupon?.code,
        discountType: result.coupon?.discountType,
        discountValue: result.coupon?.discountValue,
        description: result.coupon?.description,
      },
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to validate coupon', error: error.message });
  }
};

/**
 * POST /api/coupon/apply
 * Apply a coupon to a service request (after validation).
 * Body: { code, serviceRequestId, orderValue, serviceCategory? }
 */
export const applyCouponController = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { code, serviceRequestId, orderValue, serviceCategory } = req.body;
    if (!code || !serviceRequestId || orderValue === undefined) {
      return res.status(400).json({
        success: false,
        message: 'code, serviceRequestId, and orderValue are required',
      });
    }

    // Re-validate before applying
    const validation = await validateCoupon(code, userId, Number(orderValue), serviceCategory);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    // Resolve actual MongoDB _id (serviceRequestId may be a request_id string like "F4E20260300218")
    const ServiceRequest = require('../models/serviceRequest.model').default;
    const mongoose = require('mongoose');
    const isObjectId =
      mongoose.Types.ObjectId.isValid(serviceRequestId) && serviceRequestId.length === 24;
    const srQuery = isObjectId
      ? { $or: [{ request_id: serviceRequestId }, { _id: serviceRequestId }] }
      : { request_id: serviceRequestId };
    const sr = await ServiceRequest.findOne(srQuery).select('_id');
    if (!sr) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }
    const resolvedId = sr._id.toString();

    const result = await applyCoupon(
      validation.coupon._id.toString(),
      userId,
      resolvedId,
      validation.discountAmount!
    );

    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error });
    }

    // Update ServiceRequest with coupon fields
    await ServiceRequest.findByIdAndUpdate(resolvedId, {
      couponCode: code.toUpperCase(),
      couponDiscount: validation.discountAmount,
      couponUsageId: result.usageId,
    });

    return res.json({
      success: true,
      data: {
        usageId: result.usageId,
        discountAmount: validation.discountAmount,
        message: `Coupon applied! You save ₹${validation.discountAmount}`,
      },
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to apply coupon', error: error.message });
  }
};

/**
 * GET /api/coupon/my-coupons
 * Returns available coupons + usage history for the user.
 */
export const getMyCoupons = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const [available, history] = await Promise.all([
      getAvailableCouponsForUser(userId),
      getUserCouponHistory(userId),
    ]);

    const used = history.filter(h => h.status === 'REDEEMED');
    const applied = history.filter(h => h.status === 'APPLIED');
    const now = new Date();

    return res.json({
      success: true,
      data: {
        available,
        used,
        applied,
      },
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, message: 'Failed to get coupons', error: error.message });
  }
};
