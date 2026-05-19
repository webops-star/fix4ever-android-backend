// Premium email design system - professional theme colors
const PREMIUM_COLORS = {
  primary: '#0f172a', // Slate 900 - deep, sophisticated
  primaryLight: '#1e293b', // Slate 800
  accent: '#1e40af', // Blue 800 - refined accent
  accentLight: '#3b82f6', // Blue 500 - for links/CTAs
  text: '#334155', // Slate 700 - readable body
  textMuted: '#64748b', // Slate 500 - secondary text
  border: '#e2e8f0', // Slate 200
  bg: '#f8fafc', // Slate 50
  white: '#ffffff',
  success: '#047857', // Emerald 700
  successLight: '#d1fae5',
  warning: '#b45309', // Amber 700
  warningLight: '#fef3c7',
  error: '#b91c1c', // Red 700
  errorLight: '#fee2e2',
  info: '#0369a1', // Sky 700
  infoLight: '#e0f2fe',
};

const wrapPremiumEmail = (
  content: string,
  options?: { accentColor?: string; title?: string; subtitle?: string }
) => {
  const accent = options?.accentColor || PREMIUM_COLORS.accent;
  const title = options?.title || '';
  const subtitle = options?.subtitle || '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fix4Ever</title>
</head>
<body style="margin:0; padding:0; background-color: #f1f5f9; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background: ${PREMIUM_COLORS.white}; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.06); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${PREMIUM_COLORS.primary} 0%, ${PREMIUM_COLORS.primaryLight} 100%); padding: 28px 40px; text-align: center;">
              <div style="color: ${PREMIUM_COLORS.white}; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Fix4Ever</div>
              <div style="color: rgba(255,255,255,0.85); font-size: 13px; letter-spacing: 1px; margin-top: 4px; text-transform: uppercase;">Premium Device Care</div>
              ${title ? `<div style="color: ${PREMIUM_COLORS.white}; font-size: 18px; font-weight: 600; margin-top: 16px;">${title}</div>` : ''}
              ${subtitle ? `<div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 4px;">${subtitle}</div>` : ''}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 36px 40px; color: ${PREMIUM_COLORS.text}; font-size: 15px; line-height: 1.6;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: ${PREMIUM_COLORS.bg}; padding: 24px 40px; border-top: 1px solid ${PREMIUM_COLORS.border};">
              <p style="margin: 0; font-size: 12px; color: ${PREMIUM_COLORS.textMuted}; text-align: center;">© ${new Date().getFullYear()} Fix4Ever. All rights reserved.</p>
              <p style="margin: 8px 0 0; font-size: 11px; color: ${PREMIUM_COLORS.textMuted}; text-align: center;">Professional device repair & care</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const premiumCtaButton = (href: string, label: string, color?: string) => {
  const btnColor = color || PREMIUM_COLORS.accent;
  return `<a href="${href}" style="display: inline-block; background: linear-gradient(135deg, ${btnColor} 0%, ${btnColor}dd 100%); color: ${PREMIUM_COLORS.white}; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; letter-spacing: 0.3px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${label}</a>`;
};

const premiumInfoCard = (title: string, content: string, accentColor?: string) => {
  const border = accentColor || PREMIUM_COLORS.accent;
  return `<div style="background: ${PREMIUM_COLORS.bg}; border-left: 4px solid ${border}; padding: 20px; border-radius: 0 8px 8px 0; margin: 20px 0;"><h3 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${PREMIUM_COLORS.primary}; text-transform: uppercase; letter-spacing: 0.5px;">${title}</h3><div style="color: ${PREMIUM_COLORS.text}; font-size: 14px; line-height: 1.6;">${content}</div></div>`;
};

// Build problem category & related behavior section for emails (mainProblem, subProblem, relationalBehaviors)
const formatProblemDetailsForEmail = (serviceRequest: any): string => {
  if (!serviceRequest) return '';
  const parts: string[] = [];
  if (serviceRequest.mainProblem?.title) {
    parts.push(
      `<p style="margin: 0 0 6px;"><strong>Problem Category:</strong> ${serviceRequest.mainProblem.title}</p>`
    );
  }
  if (serviceRequest.subProblem?.title) {
    parts.push(
      `<p style="margin: 0 0 6px;"><strong>Sub-Category:</strong> ${serviceRequest.subProblem.title}</p>`
    );
  }
  if (
    serviceRequest.relationalBehaviors &&
    Array.isArray(serviceRequest.relationalBehaviors) &&
    serviceRequest.relationalBehaviors.length > 0
  ) {
    const behaviorTitles = serviceRequest.relationalBehaviors
      .map((b: any) => b.title)
      .filter(Boolean)
      .join(', ');
    if (behaviorTitles) {
      parts.push(
        `<p style="margin: 0 0 6px;"><strong>Related Issue:</strong> ${behaviorTitles}</p>`
      );
    }
  }
  if (serviceRequest.problemDescription) {
    parts.push(
      `<p style="margin: 0;"><strong>Description:</strong> ${serviceRequest.problemDescription}</p>`
    );
  }
  if (parts.length === 0) return '';
  return premiumInfoCard('Problem Details', parts.join(''), PREMIUM_COLORS.info);
};

export const getEmailForStatusChange = (status: string, name: string) => {
  const greeting = `<p style="margin: 0 0 16px;">Hello ${name},</p>`;
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  switch (status) {
    case 'Assigned':
      return {
        subject: 'Technician Assigned to Your Request',
        html: wrapPremiumEmail(
          `${greeting}<p style="margin: 0 0 20px;">A technician has been assigned to your request. We'll notify you about further updates.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(`${baseUrl}/dashboard/service-requests`, 'View Request')}</div>`,
          { title: 'Technician Assigned' }
        ),
      };
    case 'In Progress':
      return {
        subject: 'Service In Progress',
        html: wrapPremiumEmail(
          `${greeting}<p style="margin: 0 0 20px;">Your service request is now in progress. Our team is working on your device.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(`${baseUrl}/dashboard/service-requests`, 'Track Progress')}</div>`,
          { title: 'Service In Progress' }
        ),
      };
    case 'Completed':
      return {
        subject: 'Service Completed',
        html: wrapPremiumEmail(
          `${greeting}<p style="margin: 0 0 20px;">Your service has been completed successfully. Thank you for choosing Fix4Ever.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(`${baseUrl}/dashboard/service-requests`, 'View Details', PREMIUM_COLORS.success)}</div>`,
          { title: 'Service Completed' }
        ),
      };
    case 'Cancelled':
      return {
        subject: 'Service Cancelled',
        html: wrapPremiumEmail(
          `${greeting}<p style="margin: 0 0 20px;">Your service request has been cancelled. If you have any questions, please reach out to our support team.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(`${baseUrl}/dashboard/service-requests`, 'View Dashboard')}</div>`,
          { title: 'Service Cancelled' }
        ),
      };
    default:
      return {
        subject: `Service Status Updated`,
        html: wrapPremiumEmail(
          `${greeting}<p style="margin: 0 0 20px;">Your service status is now <strong style="color: ${PREMIUM_COLORS.primary};">${status}</strong>.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(`${baseUrl}/dashboard/service-requests`, 'View Details')}</div>`,
          { title: 'Status Updated' }
        ),
      };
  }
};

export const generateStatusUpdateEmail = (
  status: string,
  customerName: string,
  serviceRequest: any,
  selectedComponents?: any[],
  componentCost?: number
) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const requestId = serviceRequest.request_id || serviceRequest._id;
  const requestUrl = `${baseUrl}/dashboard/service-requests/${requestId}`;

  const greeting = `<p style="margin: 0 0 16px;">Hello ${customerName},</p>`;

  const statusTemplates = {
    'In Progress': {
      subject: 'Service Started — Your Device is Being Repaired',
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">Your technician has started working on your <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong>.</p>${formatProblemDetailsForEmail(serviceRequest) || premiumInfoCard('Problem Description', serviceRequest.problemDescription || 'N/A', PREMIUM_COLORS.info)}<p style="margin: 0 0 20px;">You will receive regular updates throughout the repair process.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Progress', PREMIUM_COLORS.info)}</div>`,
        { title: 'Service Started', subtitle: 'Your device is being repaired' }
      ),
    },
    'Diagnosis Complete': {
      subject: 'Diagnosis Complete — Review Required',
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">We have completed the diagnosis of your <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong>.</p>${formatProblemDetailsForEmail(serviceRequest)}${premiumInfoCard('Technician Notes', serviceRequest.technicianNotes || 'Detailed diagnosis notes will be provided by your technician.', PREMIUM_COLORS.warning)}<p style="margin: 0 0 20px;">Please review the findings and approve any required component replacements before we proceed.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'Review & Approve', PREMIUM_COLORS.warning)}</div>`,
        { title: 'Diagnosis Complete', subtitle: 'Review required' }
      ),
    },
    'Parts Required': {
      subject: 'Component Replacement Required — Approval Needed',
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">Your <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong> requires component replacement to complete the repair.</p>${formatProblemDetailsForEmail(serviceRequest)}${
          selectedComponents && selectedComponents.length > 0
            ? premiumInfoCard(
                'Selected Components',
                selectedComponents
                  .map(
                    comp =>
                      `<div style="margin: 6px 0;">• <strong>${comp.name}</strong> — ₹${comp.price}</div>`
                  )
                  .join('') +
                  `<div style="margin-top: 12px; font-weight: 600; color: ${PREMIUM_COLORS.primary};">Additional Component Cost: ₹${componentCost || 0}</div>`,
                PREMIUM_COLORS.error
              )
            : ''
        }<p style="margin: 0 0 20px;">Please review and approve the component replacement to proceed with the repair.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'Review Components', PREMIUM_COLORS.error)}</div>`,
        { title: 'Component Replacement Required', subtitle: 'Approval needed' }
      ),
    },
    'Awaiting Parts': {
      subject: "Awaiting Parts — We'll Keep You Updated",
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">We are waiting for the required parts to arrive for your <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong> repair.</p>${formatProblemDetailsForEmail(serviceRequest)}<p style="margin: 0 0 20px;">We will notify you as soon as the parts arrive and work can continue.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'Track Progress')}</div>`,
        { title: 'Awaiting Parts', subtitle: 'Updates coming soon' }
      ),
    },
    'Repair Complete': {
      subject: 'Repair Complete — Quality Check in Progress',
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">The repair of your <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong> has been completed successfully.</p>${formatProblemDetailsForEmail(serviceRequest)}<p style="margin: 0 0 20px;">We are performing quality checks to ensure everything is working perfectly before returning it to you.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Details', PREMIUM_COLORS.success)}</div>`,
        { title: 'Repair Complete', subtitle: 'Quality check in progress' }
      ),
    },
    'Quality Check': {
      subject: 'Quality Check in Progress — Almost Ready',
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">We are performing final quality checks on your <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong>.</p>${formatProblemDetailsForEmail(serviceRequest)}<p style="margin: 0 0 20px;">This is the final step before your device is ready for pickup.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'Track Progress', PREMIUM_COLORS.info)}</div>`,
        { title: 'Quality Check', subtitle: 'Almost ready' }
      ),
    },
    'Ready for Pickup': {
      subject: 'Ready for Pickup — Your Device is Ready',
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">Your <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong> is ready for pickup.</p>${formatProblemDetailsForEmail(serviceRequest)}<p style="margin: 0 0 16px;">Please contact us to schedule a convenient time for pickup or delivery.</p>${premiumInfoCard('Contact', 'Reach out via your dashboard or our support channels to arrange pickup.', PREMIUM_COLORS.success)}<div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Details', PREMIUM_COLORS.success)}</div>`,
        { title: 'Ready for Pickup', subtitle: 'Your device awaits' }
      ),
    },
    Completed: {
      subject: 'Service Completed Successfully',
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">Your service request for <strong style="color: ${PREMIUM_COLORS.primary};">${serviceRequest.brand} ${serviceRequest.model}</strong> has been completed successfully.</p>${formatProblemDetailsForEmail(serviceRequest)}<p style="margin: 0 0 16px;">Thank you for choosing Fix4Ever. We hope you're satisfied with the repair work.</p><p style="margin: 0 0 20px;">If you have any questions or need further assistance, please don't hesitate to contact us.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Summary', PREMIUM_COLORS.success)}</div>`,
        { title: 'Service Completed', subtitle: 'Thank you for choosing Fix4Ever' }
      ),
    },
  };

  return (
    statusTemplates[status as keyof typeof statusTemplates] || {
      subject: `Service Status Updated — ${status}`,
      html: wrapPremiumEmail(
        `${greeting}<p style="margin: 0 0 16px;">Your service request status has been updated to <strong style="color: ${PREMIUM_COLORS.primary};">${status}</strong>.</p>${formatProblemDetailsForEmail(serviceRequest)}<div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Details')}</div>`,
        { title: 'Status Updated', subtitle: status }
      ),
    }
  );
};

export const getTechnicianAssignmentEmail = (
  technicianName: string,
  requestId: string,
  technicianId: string
) => {
  const apiBaseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;
  const acceptLink = `${apiBaseUrl}/api/service-requests/${requestId}/accept?technicianId=${technicianId}`;
  const rejectLink = `${apiBaseUrl}/api/service-requests/${requestId}/reject?technicianId=${technicianId}`;

  return {
    subject: 'New Service Request Assigned — Action Required',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${technicianName},</p><p style="margin: 0 0 16px;">You have been assigned a new service request. Please review the details and choose an action.</p>${premiumInfoCard('Request ID', requestId)}<div style="text-align: center; margin: 24px 0;"><span style="margin-right: 12px;">${premiumCtaButton(acceptLink, 'Accept Request', PREMIUM_COLORS.success)}</span><a href="${rejectLink}" style="display: inline-block; background: transparent; color: ${PREMIUM_COLORS.error}; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; border: 2px solid ${PREMIUM_COLORS.error};">Reject Request</a></div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">If you have any questions, please contact support.</p>`,
      { title: 'New Assignment', subtitle: 'Action required' }
    ),
  };
};

// Schedule-related email templates
export const getScheduleProposedEmail = (
  customerName: string,
  vendorName: string,
  scheduledDate: string,
  scheduledTime: string,
  serviceType: string,
  serviceRequest?: any
) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/service-requests`;
  const scheduleContent = `<p><strong>Date:</strong> ${scheduledDate}</p><p><strong>Time:</strong> ${scheduledTime}</p><p><strong>Service Type:</strong> ${serviceType}</p>`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';

  return {
    subject: 'Service Schedule Proposed — Action Required',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;"><strong>${vendorName}</strong> has proposed a schedule for your service request.</p>${problemBlock}${premiumInfoCard('Schedule Details', scheduleContent, PREMIUM_COLORS.info)}<p style="margin: 0 0 20px;">Please log in to your dashboard to accept or reject this schedule.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(dashboardUrl, 'View Service Request', PREMIUM_COLORS.success)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">If you have any questions, please contact our support team.</p>`,
      { title: 'Schedule Proposed', subtitle: 'Review and respond' }
    ),
  };
};

export const getScheduleAcceptedEmail = (
  customerName: string,
  vendorName: string,
  scheduledDate: string,
  scheduledTime: string,
  serviceType: string,
  serviceRequest?: any
) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/service-requests`;
  const scheduleContent = `<p><strong>Date:</strong> ${scheduledDate}</p><p><strong>Time:</strong> ${scheduledTime}</p><p><strong>Service Type:</strong> ${serviceType}</p><p><strong>Vendor:</strong> ${vendorName}</p>`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';

  return {
    subject: 'Service Schedule Confirmed',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;">Your service schedule has been confirmed.</p>${problemBlock}${premiumInfoCard('Confirmed Schedule', scheduleContent, PREMIUM_COLORS.success)}<p style="margin: 0 0 20px;"><strong>Important:</strong> Please ensure someone is available at the scheduled time and location.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(dashboardUrl, 'View Details', PREMIUM_COLORS.info)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">We'll send you a reminder before the scheduled time.</p>`,
      { title: 'Schedule Confirmed', subtitle: 'See you soon' }
    ),
  };
};

export const getScheduleRejectedEmail = (
  customerName: string,
  vendorName: string,
  serviceType: string,
  serviceRequest?: any
) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/service-requests`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';

  return {
    subject: 'Service Schedule Rejected',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;">You have rejected the proposed schedule from <strong>${vendorName}</strong>.</p>${problemBlock}${premiumInfoCard('What happens next?', `The vendor will propose a new schedule that better fits your requirements.<p style="margin: 12px 0 0;"><strong>Service Type:</strong> ${serviceType}</p>`, PREMIUM_COLORS.warning)}<p style="margin: 0 0 20px;">You'll receive a new schedule proposal soon.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(dashboardUrl, 'View Service Request')}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">If you need immediate assistance, please contact our support team.</p>`,
      { title: 'Schedule Rejected', subtitle: 'New proposal coming soon' }
    ),
  };
};

export const getPickupScheduledEmail = (
  customerName: string,
  vendorName: string,
  pickupDate: string,
  pickupTime: string,
  pickupAddress: string,
  serviceRequest?: any
) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/service-requests`;
  const pickupContent = `<p><strong>Date:</strong> ${pickupDate}</p><p><strong>Time:</strong> ${pickupTime}</p><p><strong>Location:</strong> ${pickupAddress}</p>`;
  const checklist = `<ul style="margin: 0; padding-left: 20px;"><li>Your device is ready for pickup</li><li>Someone is available at the scheduled time</li><li>The device is properly packaged if needed</li></ul>`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';

  return {
    subject: 'Device Pickup Scheduled',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;"><strong>${vendorName}</strong> has scheduled a pickup for your device.</p>${problemBlock}${premiumInfoCard('Pickup Details', pickupContent, PREMIUM_COLORS.warning)}<p style="margin: 0 0 8px;"><strong>Please ensure:</strong></p><div style="margin: 0 0 20px;">${checklist}</div><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(dashboardUrl, 'View Details', PREMIUM_COLORS.warning)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">You'll receive a notification when the vendor arrives for pickup.</p>`,
      { title: 'Pickup Scheduled', subtitle: 'Device collection' }
    ),
  };
};

export const getPickupConfirmedEmail = (
  customerName: string,
  vendorName: string,
  pickupTime: string,
  pickupAddress: string,
  serviceRequest?: any
) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/service-requests`;
  const pickupContent = `<p><strong>Pickup Time:</strong> ${pickupTime}</p><p><strong>Location:</strong> ${pickupAddress}</p><p><strong>Status:</strong> Device picked up successfully</p>`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';

  return {
    subject: 'Device Pickup Confirmed',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;"><strong>${vendorName}</strong> has confirmed that your device has been picked up.</p>${problemBlock}${premiumInfoCard('Pickup Details', pickupContent, PREMIUM_COLORS.success)}<p style="margin: 0 0 20px;">Your device is now being serviced. You'll receive updates on the service progress.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(dashboardUrl, 'Track Progress', PREMIUM_COLORS.info)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">We'll notify you when the service is completed and ready for delivery.</p>`,
      { title: 'Pickup Confirmed', subtitle: 'Device in service' }
    ),
  };
};

export const getDropScheduledEmail = (
  customerName: string,
  vendorName: string,
  dropDate: string,
  dropTime: string,
  dropAddress: string,
  serviceRequest?: any
) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/service-requests`;
  const deliveryContent = `<p><strong>Date:</strong> ${dropDate}</p><p><strong>Time:</strong> ${dropTime}</p><p><strong>Location:</strong> ${dropAddress}</p>`;
  const checklist = `<ul style="margin: 0; padding-left: 20px;"><li>Someone is available to receive the device</li><li>Payment is ready if required</li><li>You have proper identification for verification</li></ul>`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';

  return {
    subject: 'Device Delivery Scheduled',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;"><strong>${vendorName}</strong> has scheduled the delivery of your serviced device.</p>${problemBlock}${premiumInfoCard('Delivery Details', deliveryContent, PREMIUM_COLORS.info)}<p style="margin: 0 0 8px;"><strong>Please ensure:</strong></p><div style="margin: 0 0 20px;">${checklist}</div><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(dashboardUrl, 'View Details', PREMIUM_COLORS.info)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">You'll receive a notification when the vendor arrives for delivery.</p>`,
      { title: 'Delivery Scheduled', subtitle: 'Your device is on its way' }
    ),
  };
};

export const getDropCompletedEmail = (
  customerName: string,
  vendorName: string,
  dropTime: string,
  dropAddress: string,
  serviceRequest?: any
) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/service-requests`;
  const deliveryContent = `<p><strong>Delivery Time:</strong> ${dropTime}</p><p><strong>Location:</strong> ${dropAddress}</p><p><strong>Status:</strong> Device delivered successfully</p>`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';

  return {
    subject: 'Device Delivered Successfully',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;">Your serviced device has been delivered successfully by <strong>${vendorName}</strong>.</p>${problemBlock}${premiumInfoCard('Delivery Details', deliveryContent, PREMIUM_COLORS.success)}<p style="margin: 0 0 20px;">Your service request is now complete. Please test your device and let us know if you need any assistance.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(dashboardUrl, 'View Service Details', PREMIUM_COLORS.success)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">Thank you for choosing Fix4Ever. We hope you're satisfied with the results.</p>`,
      { title: 'Device Delivered', subtitle: 'Thank you for choosing Fix4Ever' }
    ),
  };
};

// Admin Review Flow Email Templates

export const getAdminIdentificationReviewEmail = (
  serviceRequestId: string,
  deviceBrand: string,
  deviceModel: string,
  identifiedProblem: string,
  vendorEstimate: number,
  vendorName: string
) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const reviewUrl = `${baseUrl}/admin/service-requests/${serviceRequestId}`;
  const deviceContent = `<p><strong>Device:</strong> ${deviceBrand} ${deviceModel}</p><p><strong>Vendor:</strong> ${vendorName}</p>`;
  const identificationContent = `<p><strong>Identified Problem:</strong> ${identifiedProblem}</p><p><strong>Vendor's Estimated Cost:</strong> <span style="font-size: 18px; font-weight: bold; color: ${PREMIUM_COLORS.accent};">₹${vendorEstimate}</span></p>`;
  const actionList = `<ul style="margin: 0; padding-left: 20px; color: ${PREMIUM_COLORS.text};"><li>Review the vendor's problem identification</li><li>Set the customer-facing price</li><li>Approve or request revision</li></ul>`;

  return {
    subject: 'Vendor Identification Requires Review — Action Required',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello Admin,</p><p style="margin: 0 0 16px;">A vendor has submitted problem identification for a service request that requires your review and approval.</p>${premiumInfoCard('Device Details', deviceContent, PREMIUM_COLORS.warning)}${premiumInfoCard("Vendor's Identification", identificationContent)}<p style="margin: 0 0 8px; font-weight: 600; color: ${PREMIUM_COLORS.error};">Action Required:</p><div style="margin: 0 0 20px;">${actionList}</div><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(reviewUrl, 'Review Now', PREMIUM_COLORS.warning)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">Please review this as soon as possible to avoid delays in service delivery.</p>`,
      { title: 'Admin Review Required', subtitle: 'Vendor identification pending' }
    ),
  };
};

export const getCustomerAdminApprovedPricingEmail = (
  customerName: string,
  serviceRequestId: string,
  deviceBrand: string,
  deviceModel: string,
  identifiedProblem: string,
  approvedPrice: number,
  adminAdjustments?: string,
  serviceRequest?: any
) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const requestUrl = `${baseUrl}/dashboard/service-requests/${serviceRequestId}`;
  const deviceContent = `<p><strong>Device:</strong> ${deviceBrand} ${deviceModel}</p>`;
  const problemBlock = serviceRequest ? formatProblemDetailsForEmail(serviceRequest) : '';
  const priceBlock = `<div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 24px; border-radius: 8px; text-align: center; border: 2px solid ${PREMIUM_COLORS.accent}; margin: 20px 0;"><p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: ${PREMIUM_COLORS.primary}; text-transform: uppercase; letter-spacing: 0.5px;">Approved Repair Cost</p><p style="font-size: 28px; font-weight: bold; color: ${PREMIUM_COLORS.accent}; margin: 0;">₹${approvedPrice}</p><p style="color: ${PREMIUM_COLORS.textMuted}; font-size: 13px; margin: 8px 0 0;">Reviewed and approved by Fix4Ever</p></div>`;
  const adjustmentNote = adminAdjustments
    ? premiumInfoCard('Price Adjustment Note', adminAdjustments, PREMIUM_COLORS.warning)
    : '';

  return {
    subject: 'Repair Estimate Ready for Your Approval',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;">Our technician has identified the problem with your device and the repair estimate has been reviewed and approved by Fix4Ever.</p>${premiumInfoCard('Device Details', deviceContent)}${problemBlock}${premiumInfoCard('Problem Identified', identifiedProblem, PREMIUM_COLORS.success)}${priceBlock}${adjustmentNote}<p style="margin: 0 0 8px; font-weight: 600; color: ${PREMIUM_COLORS.error};">Action Required:</p><p style="margin: 0 0 20px;">Please review the repair estimate and let us know if you'd like to proceed with the repair or return your device without repair.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'Review & Approve', PREMIUM_COLORS.success)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">If you reject the pricing, your device will be returned to you without repair (only service type charges will apply).</p>`,
      { title: 'Repair Estimate Ready', subtitle: 'Review and approve' }
    ),
  };
};

export const getVendorCustomerApprovedEmail = (
  vendorName: string,
  serviceRequestId: string,
  deviceBrand: string,
  deviceModel: string,
  customerName: string,
  approvedPrice: number
) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const requestUrl = `${baseUrl}/vendor/service-requests/${serviceRequestId}`;
  const detailsContent = `<p><strong>Device:</strong> ${deviceBrand} ${deviceModel}</p><p><strong>Customer:</strong> ${customerName}</p><p><strong>Approved Price:</strong> <span style="font-size: 18px; font-weight: bold; color: ${PREMIUM_COLORS.success};">₹${approvedPrice}</span></p>`;
  const nextSteps = `<ul style="margin: 0; padding-left: 20px; color: ${PREMIUM_COLORS.text};"><li>Proceed with the repair work</li><li>Update the status as you progress</li><li>Notify the customer when repair is complete</li></ul>`;

  return {
    subject: 'Customer Approved Repair — Proceed with Work',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${vendorName},</p><p style="margin: 0 0 16px;">The customer <strong>${customerName}</strong> has approved the repair pricing for their device.</p>${premiumInfoCard('Service Request Details', detailsContent, PREMIUM_COLORS.success)}<p style="margin: 0 0 8px; font-weight: 600; color: ${PREMIUM_COLORS.success};">Next Steps:</p><div style="margin: 0 0 20px;">${nextSteps}</div><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Service Request', PREMIUM_COLORS.success)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">Please complete the repair in a timely manner and keep the customer informed of progress.</p>`,
      { title: 'Customer Approved', subtitle: 'Proceed with repair' }
    ),
  };
};

export const getVendorRevisionRequestedEmail = (
  vendorName: string,
  serviceRequestId: string,
  deviceBrand: string,
  deviceModel: string,
  adminNotes: string
) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const requestUrl = `${baseUrl}/vendor/service-requests/${serviceRequestId}`;
  const deviceContent = `<p><strong>Device:</strong> ${deviceBrand} ${deviceModel}</p>`;
  const actionList = `<ul style="margin: 0; padding-left: 20px; color: ${PREMIUM_COLORS.text};"><li>Review the admin's feedback carefully</li><li>Re-examine the device if necessary</li><li>Submit an updated identification with correct information</li></ul>`;

  return {
    subject: 'Identification Revision Requested — Action Required',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${vendorName},</p><p style="margin: 0 0 16px;">The admin has reviewed your problem identification and is requesting a revision before it can be sent to the customer.</p>${premiumInfoCard('Service Request Details', deviceContent)}${premiumInfoCard('Admin Feedback', adminNotes, PREMIUM_COLORS.warning)}<p style="margin: 0 0 8px; font-weight: 600; color: ${PREMIUM_COLORS.error};">Action Required:</p><div style="margin: 0 0 20px;">${actionList}</div><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'Update Identification', PREMIUM_COLORS.warning)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">Please address the feedback and resubmit as soon as possible to avoid delays.</p>`,
      { title: 'Revision Requested', subtitle: 'Action required' }
    ),
  };
};

// Vendor schedule accepted - notification to vendor
export const getVendorScheduleAcceptedEmail = (
  vendorName: string,
  customerName: string,
  serviceRequest: any
) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const requestId = serviceRequest?.request_id || serviceRequest?._id;
  const requestUrl = `${baseUrl}/vendor/service-requests/${requestId}`;
  const detailsContent = `<p><strong>Device:</strong> ${serviceRequest?.brand || ''} ${serviceRequest?.model || ''}</p><p><strong>Status:</strong> Schedule Accepted</p>`;

  return {
    subject: 'Schedule Accepted & Status Updated',
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${vendorName},</p><p style="margin: 0 0 16px;">Customer <strong>${customerName}</strong> has accepted the schedule and confirmed arrival for their service request.</p>${formatProblemDetailsForEmail(serviceRequest)}${premiumInfoCard('Service Request Details', detailsContent, PREMIUM_COLORS.success)}<p style="margin: 0 0 20px;">Please proceed with the service.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Service Request', PREMIUM_COLORS.success)}</div>`,
      { title: 'Schedule Accepted', subtitle: 'Proceed with service' }
    ),
  };
};

// Customer notification for vendor workflow status updates (Pickup Initiated, Repair Done, etc.)
export const getCustomerVendorStatusUpdateEmail = (
  customerName: string,
  status: string,
  message: string,
  serviceRequest: any,
  technicianName?: string
) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const requestId = serviceRequest?.request_id || serviceRequest?._id;
  const requestUrl = `${baseUrl}/dashboard/service-requests/${requestId}`;
  const detailsContent = `<p><strong>Device:</strong> ${serviceRequest?.brand || ''} ${serviceRequest?.model || ''}</p><p><strong>Status:</strong> ${status}</p>${technicianName ? `<p><strong>Technician:</strong> ${technicianName}</p>` : ''}<p><strong>Updated:</strong> ${new Date().toLocaleString()}</p>`;

  return {
    subject: `Service Request Update — ${status}`,
    html: wrapPremiumEmail(
      `<p style="margin: 0 0 16px;">Hello ${customerName},</p><p style="margin: 0 0 16px;">${message}</p>${formatProblemDetailsForEmail(serviceRequest)}${premiumInfoCard('Service Request Details', detailsContent)}<p style="margin: 0 0 20px;">You can track the progress of your service request in your dashboard.</p><div style="text-align: center; margin: 24px 0;">${premiumCtaButton(requestUrl, 'View Service Request', PREMIUM_COLORS.info)}</div><p style="margin: 0; font-size: 13px; color: ${PREMIUM_COLORS.textMuted};">Thank you for choosing Fix4Ever. If you have any questions, please don't hesitate to contact us.</p>`,
      { title: 'Status Update', subtitle: status }
    ),
  };
};
