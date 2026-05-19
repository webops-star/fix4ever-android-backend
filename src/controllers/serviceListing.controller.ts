import ServiceListing from '../models/serviceListings.model';
import Vendor from '../models/vendor.model';
import { Request, Response } from 'express';

// Create new service listing
export const createServiceListing = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { serviceName, description, price, estimatedTime } = req.body;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor/Technician not found.' });
    }
    const newListing = await ServiceListing.create({
      vendorId,
      serviceName,
      description,
      price,
      estimatedTime,
    });

    res.status(201).json({ success: true, data: newListing });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error creating service listing' });
  }
};

// Get all listings by a vendor
export const getServiceListings = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor/Technician not found.' });
    }
    const listings = await ServiceListing.find({ vendorId });
    res.status(200).json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error fetching service listings' });
  }
};

// Update listing
export const updateServiceListing = async (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    const updated = await ServiceListing.findByIdAndUpdate(listingId, req.body, { new: true });
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error updating service listing' });
  }
};

// Delete listing
export const deleteServiceListing = async (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    await ServiceListing.findByIdAndDelete(listingId);
    res.status(200).json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error deleting service listing' });
  }
};
