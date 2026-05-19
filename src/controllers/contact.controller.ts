import { Request, Response } from 'express';
import mailSender from '../utils/mailSender';

export const sendContactEmail = async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const recipient = process.env.CONTACT_FORM_EMAIL;
    if (!recipient) {
      return res.status(500).json({ success: false, message: 'Contact email is not configured.' });
    }

    const emailSubject = `[Contact Form] ${subject} — from ${name}`;

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #111827; margin-bottom: 4px;">New Contact Form Submission</h2>
        <p style="color: #6b7280; font-size: 14px; margin-top: 0;">Received via Fix4Ever contact page</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <table style="width: 100%; font-size: 15px; color: #374151;">
          <tr>
            <td style="padding: 8px 0; font-weight: 600; width: 100px;">Name</td>
            <td style="padding: 8px 0;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: 600;">Email</td>
            <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #2563eb;">${email}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: 600;">Subject</td>
            <td style="padding: 8px 0;">${subject}</td>
          </tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="font-weight: 600; color: #374151; margin-bottom: 8px;">Message</p>
        <p style="color: #374151; white-space: pre-wrap; background: #f9fafb; padding: 16px; border-radius: 6px;">${message}</p>
      </div>
    `;

    await mailSender(recipient, emailSubject, emailBody);

    return res.status(200).json({ success: true, message: 'Message sent successfully.' });
  } catch (error: any) {
    console.error('Contact form email error:', error.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to send message. Please try again later.' });
  }
};
