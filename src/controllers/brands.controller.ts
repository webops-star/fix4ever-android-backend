import { Request, Response } from 'express';
import { listObjects, getPresignedUrl } from '../utils/s3';
import { raw } from 'body-parser';

interface DeviceRequest extends Request {
  body: {
    device: 'laptop' | 'smartphone';
  };
}

interface BrandRequest extends Request {
  body: {
    device: 'laptop' | 'smartphone';
    brand: string;
  };
}

const brands_paths: Record<string, string> = {
  laptop: 'images/laptops/brands',
  smartphone: 'images/smartphones/brands',
};

const model_paths: Record<string, string> = {
  laptop: 'images/laptops/models/',
  smartphone: 'images/smartphones/models/',
};

export const getBrandUrls = async (req: DeviceRequest, res: Response) => {
  try {
    const device = req.body?.device as string; // ex. laptop or smartphone

    if (!device) {
      return res.status(400).json({ error: 'Device not specified' });
    }

    const bucketFolder = brands_paths[device];

    const objects = await listObjects(bucketFolder);
    const urls = await Promise.all(
      objects?.map(async object => {
        return {
          key: object?.Key || '',
          url: await getPresignedUrl(object?.Key || ''),
        };
      }) || []
    );

    return res.status(200).json({ success: true, data: urls });
  } catch (error) {
    console.error(error); // Log the error
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getModelUrls = async (req: BrandRequest, res: Response) => {
  try {
    const device = req.body.device as string;
    const brand = req.body.brand as string;

    if (!device || !brand) {
      return res.status(400).json({ error: 'Device or brand not specified' });
    }

    const bucketFolder = model_paths[device] + brand;
    const objects = await listObjects(bucketFolder);
    const urls = await Promise.all(
      objects?.map(async object => {
        return {
          key: object?.Key || '',
          url: await getPresignedUrl(object?.Key || ''),
        };
      }) || []
    );

    return res.status(200).json({ success: true, data: urls });
  } catch (error) {
    console.error(error); // Log the error
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
