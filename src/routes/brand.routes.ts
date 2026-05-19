import express from 'express';

import { getBrandUrls, getModelUrls } from '../controllers/brands.controller';

const router = express.Router();

router.post('/brands', getBrandUrls);
router.post('/models', getModelUrls);

export default router;
