import {
  getServiceListings,
  createServiceListing,
  updateServiceListing,
  deleteServiceListing,
} from '../controllers/serviceListing.controller';
import { Router } from 'express';

const router = Router();

router.post('/create/:vendorId', createServiceListing);
router.get('/:vendorId', getServiceListings);
router.put('/update/:listingId', updateServiceListing);
router.delete('/delete/:listingId', deleteServiceListing);

export default router;
