import { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '../middleware/auth.middleware';
import WorkshopTechnician from '../models/workshopTechnician.model';
import WorkspaceModel from '../models/Workspace.model';
import User from '../models/user.model';
import mailSender from '../utils/mailSender';
import { uploadVendorOnboardingDocument } from '../utils/s3Upload';

// Email template for technician invitation
const getTechnicianInviteEmail = (workshopName: string, workshopId: string, inviteLink: string) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  return {
    subject: `You're Invited to Join ${workshopName} on Fix4Ever`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;box-shadow:0 4px 6px -1px rgba(15,23,42,0.08);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 40px;text-align:center;">
              <div style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Fix4Ever</div>
              <div style="color:rgba(255,255,255,0.85);font-size:13px;letter-spacing:1px;margin-top:4px;text-transform:uppercase;">Premium Device Care</div>
              <div style="color:#ffffff;font-size:18px;font-weight:600;margin-top:16px;">Technician Invitation</div>
              <div style="color:rgba(255,255,255,0.9);font-size:14px;margin-top:4px;">You've been invited to join a workshop</div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;color:#334155;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px;">Hello,</p>
              <p style="margin:0 0 16px;">You have been invited by <strong>${workshopName}</strong> to join their workshop as a technician on Fix4Ever.</p>
              <div style="background:#f8fafc;border-left:4px solid #1e40af;padding:20px;border-radius:0 8px 8px 0;margin:20px 0;">
                <h3 style="margin:0 0 12px;font-size:14px;font-weight:600;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">Workshop Details</h3>
                <p style="margin:0 0 6px;font-size:14px;"><strong>Workshop:</strong> ${workshopName}</p>
                <p style="margin:0;font-size:14px;"><strong>Workshop ID:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-family:monospace;">${workshopId}</code></p>
              </div>
              <p style="margin:0 0 16px;">To complete your onboarding, please click the button below. You'll need to:</p>
              <ul style="margin:0 0 20px;padding-left:20px;color:#334155;">
                <li style="margin-bottom:6px;">Create an account or log in</li>
                <li style="margin-bottom:6px;">Fill in your personal information</li>
                <li style="margin-bottom:6px;">Complete identity verification</li>
                <li style="margin-bottom:6px;">Add your bank details</li>
              </ul>
              <div style="text-align:center;margin:28px 0;">
                <a href="${inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#1e40af 0%,#1e40afdd 100%);color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;letter-spacing:0.3px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">Complete Onboarding</a>
              </div>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">This invitation link expires in 7 days. If you have any questions, please contact your workshop admin.</p>
              <p style="margin:0;font-size:13px;color:#64748b;">If you did not expect this invitation, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#64748b;text-align:center;">© ${new Date().getFullYear()} Fix4Ever. All rights reserved.</p>
              <p style="margin:8px 0 0;font-size:11px;color:#64748b;text-align:center;">Professional device repair & care</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
};

// POST /api/workshop-technicians/invite
// Vendor invites a technician by email
export const inviteTechnician = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { email, workshopId } = req.body;

    if (!email || !workshopId) {
      return res.status(400).json({ success: false, message: 'Email and workshopId are required' });
    }

    // Find the workspace and verify ownership
    const workspace = await WorkspaceModel.findById(workshopId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    if (workspace.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized for this workspace' });
    }

    // Check if already invited
    const existing = await WorkshopTechnician.findOne({
      workshopId,
      inviteEmail: email.toLowerCase(),
    });

    if (existing && existing.onboardingStatus !== 'Rejected') {
      return res.status(400).json({
        success: false,
        message: 'This technician has already been invited to this workshop',
      });
    }

    // Generate invite token
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create or update the invite record
    if (existing && existing.onboardingStatus === 'Rejected') {
      existing.inviteToken = inviteToken;
      existing.inviteTokenExpiry = inviteTokenExpiry;
      existing.onboardingStatus = 'Invited';
      await existing.save();
    } else {
      await WorkshopTechnician.create({
        workshopId,
        inviteEmail: email.toLowerCase(),
        inviteToken,
        inviteTokenExpiry,
        onboardingStatus: 'Invited',
      });
    }

    // Build onboarding link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const inviteLink = `${frontendUrl}/technician-onboarding?token=${inviteToken}`;

    // Send invitation email
    const emailData = getTechnicianInviteEmail(workspace.workspaceName, workshopId, inviteLink);
    await mailSender(email.toLowerCase(), emailData.subject, emailData.html);

    return res.status(200).json({
      success: true,
      message: `Invitation sent to ${email}`,
    });
  } catch (error: any) {
    console.error('Error inviting technician:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/workshop-technicians/verify-invite/:token
// Verify invite token and return workshop info
export const verifyInvite = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const invite = await WorkshopTechnician.findOne({ inviteToken: token }).populate(
      'workshopId',
      'workspaceName'
    );

    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invalid invitation link' });
    }

    if (invite.inviteTokenExpiry < new Date()) {
      return res.status(410).json({ success: false, message: 'Invitation link has expired' });
    }

    const workspace = invite.workshopId as any;

    return res.status(200).json({
      success: true,
      data: {
        inviteEmail: invite.inviteEmail,
        workshopId: invite.workshopId,
        workshopName: workspace?.workspaceName || '',
        onboardingStatus: invite.onboardingStatus,
        technicianId: invite._id,
      },
    });
  } catch (error: any) {
    console.error('Error verifying invite:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/workshop-technicians/onboard
// Submit technician onboarding form (multipart/form-data)
export const onboardTechnician = async (req: AuthRequest, res: Response) => {
  try {
    const { token } = req.body;
    const userId = req.user?.userId;

    // Find invite by token
    const technician = await WorkshopTechnician.findOne({ inviteToken: token });

    if (!technician) {
      return res.status(404).json({ success: false, message: 'Invalid invitation token' });
    }

    if (technician.inviteTokenExpiry < new Date()) {
      return res.status(410).json({ success: false, message: 'Invitation token has expired' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // Upload documents to S3
    let governmentIdProofUrl = technician.idVerification?.governmentIdProof || '';
    let selfieVerificationUrl = technician.idVerification?.selfieVerification || '';
    let cancelledChequeUrl = technician.bankDetails?.cancelledCheque || '';

    const techEmail = req.body.email || technician.inviteEmail;

    if (files?.governmentIdProof?.[0]?.path) {
      const result = await uploadVendorOnboardingDocument(
        files.governmentIdProof[0].path,
        techEmail,
        'gov_id'
      );
      if (result) governmentIdProofUrl = result.url;
    }
    if (files?.selfieVerification?.[0]?.path) {
      const result = await uploadVendorOnboardingDocument(
        files.selfieVerification[0].path,
        techEmail,
        'selfie'
      );
      if (result) selfieVerificationUrl = result.url;
    }
    if (files?.cancelledCheque?.[0]?.path) {
      const result = await uploadVendorOnboardingDocument(
        files.cancelledCheque[0].path,
        techEmail,
        'cancelled_cheque'
      );
      if (result) cancelledChequeUrl = result.url;
    }

    // Parse body fields
    const {
      // Personal Info
      fullName,
      email,
      phone,
      alternatePhone,
      address,
      // ID Verification
      governmentIdType,
      governmentIdNumber,
      // Bank Details
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      accountType,
    } = req.body;

    // Update technician record
    technician.userId = userId;
    technician.personalInfo = { fullName, email, phone, alternatePhone, address };
    technician.idVerification = {
      governmentIdType,
      governmentIdNumber,
      governmentIdProof: governmentIdProofUrl,
      selfieVerification: selfieVerificationUrl,
      verificationStatus: 'Pending',
    };
    technician.bankDetails = {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      accountType,
      cancelledCheque: cancelledChequeUrl,
    };
    technician.onboardingStatus = 'Submitted';
    technician.submittedAt = new Date();

    await technician.save();

    // Add technician to workspace's technicians array
    await WorkspaceModel.findByIdAndUpdate(technician.workshopId, {
      $addToSet: { technicians: technician._id },
    });

    return res.status(200).json({
      success: true,
      message: 'Onboarding submitted successfully. Your profile is under review.',
      data: { technicianId: technician._id },
    });
  } catch (error: any) {
    console.error('Error onboarding technician:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/workshop-technicians/workshop/:workshopId
// Get all technicians for a workspace (vendor/admin only)
export const getWorkshopTechnicians = async (req: AuthRequest, res: Response) => {
  try {
    const { workshopId } = req.params;
    const userId = req.user?.userId;

    const workspace = await WorkspaceModel.findById(workshopId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    if (workspace.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const technicians = await WorkshopTechnician.find({ workshopId }).sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: technicians });
  } catch (error: any) {
    console.error('Error fetching workshop technicians:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/workshop-technicians/my-profile
// Technician views their own profile
export const getMyTechnicianProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    const technician = await WorkshopTechnician.findOne({ userId }).populate(
      'workshopId',
      'workspaceName'
    );

    if (!technician) {
      return res.status(404).json({ success: false, message: 'Technician profile not found' });
    }

    return res.status(200).json({ success: true, data: technician });
  } catch (error: any) {
    console.error('Error fetching technician profile:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
