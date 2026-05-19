import { AuthRequest } from '../middleware/auth.middleware';
import WorkspaceModel from '../models/Workspace.model';
import userModel from '../models/user.model';

import { Response } from 'express';
import vendorModel from '../models/vendor.model';

export const createSpace = async (req: AuthRequest, res: Response) => {
  const { workspaceName } = req.body;

  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const user = await userModel.findOne({ _id: userId, role: 'vendor' });

    if (!user) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to create workspace',
      });
    }

    const vendor = await vendorModel.findOne({ 'pocInfo.userId': userId }, { _id: 1 });

    if (!vendor) {
      return res.status(400).json({
        success: false,
        message: 'Vendor not found for this user',
      });
    }

    const existingWorkspace = await WorkspaceModel.findOne({ userId });

    if (existingWorkspace) {
      return res.status(400).json({
        success: false,
        message: 'You already have a workspace',
      });
    }

    const workspaceDoc = new WorkspaceModel({
      userId,
      vendorId: vendor._id,
      workspaceName,
      createdAt: new Date(),
    });

    const data = await workspaceDoc.save();

    return res.status(201).json({
      success: true,
      message: 'Workspace created successfully',
      data,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getWorkSpace = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    const workspace = await WorkspaceModel.findOne({ userId: userId });

    if (!workspace) {
      return res.json({
        success: false,
        message: 'No WorkSpace existed  Create New WorkSpace',
      });
    }

    res.json({
      success: true,
      data: workspace,
    });
  } catch (error: any) {
    res.json({
      success: false,
      message: error.message,
    });
  }
};
