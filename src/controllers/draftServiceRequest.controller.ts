import { Request, Response } from 'express';
import DraftServiceRequest from '../models/draftServiceRequest.model';
import ServiceRequest from '../models/serviceRequest.model';
import { uploadOnCloudinary, uploadToS3 } from '../utils/s3';

interface AuthRequest extends Request {
  user?: any;
}

// Create or update a draft service request
export const createOrUpdateDraft = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    console.log('Creating/updating draft:', { userId, sessionId, body: req.body });

    const {
      draftId, // If provided, update this specific draft
      address,
      city,
      brand,
      model,
      problemDescription,
      userName,
      userPhone,
      requestType,
      serviceType,
      beneficiaryName,
      beneficiaryPhone,
      preferredDate,
      preferredTime,
      selectedDate,
      selectedTimeSlot,
      budget,
      priority,
      isUrgent,
      issueLevel,
      urgency,
      wantsWarranty,
      wantsDataSafety,
      calculatedPricing,
      aiPredictions,
      selectedProblem,
      aiPredicted,
      problemType,
      problemTypeLabel, // Problem type label for display
      knowsProblem,
      location,
      currentStep,
      currentStepKey,
      issueImages, // Array of image URLs
      createNew, // Flag to force creation of new draft (from home screen)
    } = req.body;

    // Determine if this is an update or new draft
    let draft: any;

    // Priority 1: If draftId is provided, find and update that specific draft
    if (draftId) {
      const query: any = {
        _id: draftId,
        $and: [
          {
            $or: [{ status: 'DRAFT' }, { status: { $exists: false } }, { status: null }],
          },
          { status: { $ne: 'SUBMITTED' } },
        ],
      };

      if (userId) {
        query.$and.push({ $or: [{ customerId: userId }, { sessionId: sessionId }] });
      } else if (sessionId) {
        query.$and.push({ sessionId: sessionId });
      }

      draft = await DraftServiceRequest.findOne(query);

      if (!draft) {
        return res.status(404).json({
          success: false,
          message: 'Draft not found or already submitted',
        });
      }
    }
    // Priority 2: If createNew flag is set, create a new draft (from home screen)
    else if (createNew === true || createNew === 'true') {
      // Don't find existing draft, create new one
      draft = null;
    }
    // Priority 3: Otherwise, find existing incomplete draft for this user
    // NOTE: We do NOT create new drafts here - only update existing ones
    // New drafts should ONLY be created from home screen with createNew=true
    else {
      if (userId) {
        // For authenticated users, find existing incomplete draft
        const query: any = {
          $and: [
            {
              $or: [{ status: 'DRAFT' }, { status: { $exists: false } }, { status: null }],
            },
            { status: { $ne: 'SUBMITTED' } },
            { customerId: userId },
          ],
        };
        draft = await DraftServiceRequest.findOne(query).sort({ createdAt: -1 });
      } else if (sessionId) {
        // For unauthenticated users, find by session ID
        const query: any = {
          $and: [
            {
              $or: [{ status: 'DRAFT' }, { status: { $exists: false } }, { status: null }],
            },
            { status: { $ne: 'SUBMITTED' } },
            { sessionId: sessionId },
          ],
        };
        draft = await DraftServiceRequest.findOne(query).sort({ createdAt: -1 });
      }

      // If no draft found in Priority 3, we do NOT create a new one
      // This prevents accidental draft creation during form navigation/editing
      // New drafts should ONLY be created from home screen with createNew=true
    }

    // Calculate completion percentage based on step progress.
    // currentStep is stored as a 0-based index and there are 7 total steps (0..6).
    const TOTAL_STEPS = 7;
    const MAX_STEP_INDEX = TOTAL_STEPS - 1;
    const hasIncomingCurrentStep = currentStep !== undefined && currentStep !== null;
    const stepSource = hasIncomingCurrentStep ? currentStep : draft?.currentStep;
    const parsedStep = Number(stepSource);
    const normalizedStep = Number.isFinite(parsedStep) ? parsedStep : 0;
    const safeStepIndex = Math.min(Math.max(normalizedStep, 0), MAX_STEP_INDEX);
    const completionPercentage = Math.round((safeStepIndex / MAX_STEP_INDEX) * 100);

    if (draft) {
      // Update existing draft - only update fields that are provided
      if (address !== undefined) draft.address = address;
      if (city !== undefined) draft.city = city;
      if (brand !== undefined) draft.brand = brand;
      if (model !== undefined) draft.model = model;
      if (problemDescription !== undefined) draft.problemDescription = problemDescription;
      if (userName !== undefined) draft.userName = userName;
      if (userPhone !== undefined) draft.userPhone = userPhone;
      if (requestType !== undefined) draft.requestType = requestType;
      if (serviceType !== undefined) draft.serviceType = serviceType;
      if (beneficiaryName !== undefined) draft.beneficiaryName = beneficiaryName;
      if (beneficiaryPhone !== undefined) draft.beneficiaryPhone = beneficiaryPhone;
      if (preferredDate !== undefined) draft.preferredDate = preferredDate;
      if (preferredTime !== undefined) draft.preferredTime = preferredTime;
      if (selectedDate !== undefined) draft.selectedDate = selectedDate;
      if (selectedTimeSlot !== undefined) draft.selectedTimeSlot = selectedTimeSlot;
      if (budget !== undefined) draft.budget = budget || 0;
      if (priority !== undefined) draft.priority = priority || 'medium';
      if (isUrgent !== undefined) draft.isUrgent = isUrgent || false;
      if (issueLevel !== undefined) draft.issueLevel = issueLevel || 'software';
      if (urgency !== undefined) draft.urgency = urgency || 'standard';
      if (wantsWarranty !== undefined) draft.wantsWarranty = wantsWarranty || false;
      if (wantsDataSafety !== undefined) draft.wantsDataSafety = wantsDataSafety || false;
      if (calculatedPricing !== undefined) draft.calculatedPricing = calculatedPricing;
      if (aiPredictions !== undefined) {
        draft.aiPredictions =
          typeof aiPredictions === 'string' ? JSON.parse(aiPredictions) : aiPredictions;
      }
      if (selectedProblem !== undefined) {
        draft.selectedProblem =
          typeof selectedProblem === 'string' ? JSON.parse(selectedProblem) : selectedProblem;
      }
      if (aiPredicted !== undefined) draft.aiPredicted = aiPredicted || false;
      if (problemType !== undefined) draft.problemType = problemType || '';
      if (problemTypeLabel !== undefined) draft.problemTypeLabel = problemTypeLabel || '';
      if (knowsProblem !== undefined)
        draft.knowsProblem = knowsProblem === 'true' || knowsProblem === true;
      if (currentStep !== undefined) draft.currentStep = currentStep || 0;
      if (currentStepKey !== undefined) draft.currentStepKey = currentStepKey;
      if (issueImages !== undefined) {
        draft.issueImages = Array.isArray(issueImages) ? issueImages : [];
      }
      if (location !== undefined) {
        draft.location = location;
        // Always update customerLocation if lat/lng are provided (even if 0)
        if (
          location &&
          (location.lat !== undefined || location.latitude !== undefined) &&
          (location.lng !== undefined || location.longitude !== undefined)
        ) {
          draft.customerLocation = {
            latitude: location.lat || location.latitude || 0,
            longitude: location.lng || location.longitude || 0,
          };
        }
      }

      draft.completionPercentage = completionPercentage;
      draft.updatedAt = new Date();
      // Always ensure status is DRAFT
      draft.status = 'DRAFT';

      // Update customerId if user just logged in
      if (userId && !draft.customerId) {
        draft.customerId = userId;
        draft.sessionId = undefined; // Clear session ID since user is now authenticated
      }

      await draft.save();
      console.log('Updated existing draft:', draft._id);
    } else {
      // Create new draft ONLY when createNew flag is set
      // This ensures drafts are only created intentionally (from home screen or form initialization)
      if (createNew !== true && createNew !== 'true') {
        console.log('No draft found and createNew is false - skipping draft creation');
        return res.status(200).json({
          success: true,
          message: 'No draft to update. Please create a new draft first.',
          draft: null,
        });
      }

      // Create new draft (when createNew=true)
      console.log('Creating new draft with createNew flag');
      const draftData: any = {
        customerId: userId || undefined,
        sessionId: !userId ? sessionId : undefined,
        address,
        city,
        brand,
        model,
        problemDescription,
        userName,
        userPhone,
        requestType: requestType || 'self',
        serviceType: serviceType || 'pickup-drop',
        beneficiaryName,
        beneficiaryPhone,
        preferredDate,
        preferredTime,
        selectedDate,
        selectedTimeSlot,
        budget: budget || 0,
        priority: priority || 'medium',
        isUrgent: isUrgent || false,
        issueLevel: issueLevel || 'software',
        urgency: urgency || 'standard',
        wantsWarranty: wantsWarranty || false,
        wantsDataSafety: wantsDataSafety || false,
        calculatedPricing,
        aiPredictions: aiPredictions
          ? typeof aiPredictions === 'string'
            ? JSON.parse(aiPredictions)
            : aiPredictions
          : [],
        selectedProblem: selectedProblem
          ? typeof selectedProblem === 'string'
            ? JSON.parse(selectedProblem)
            : selectedProblem
          : null,
        aiPredicted: aiPredicted || false,
        problemType: problemType || '',
        problemTypeLabel: problemTypeLabel || '',
        knowsProblem: knowsProblem === 'true' || knowsProblem === true,
        location,
        currentStep: currentStep || 0,
        currentStepKey: currentStepKey,
        issueImages: Array.isArray(issueImages) ? issueImages : [],
        status: 'DRAFT', // Explicitly set status
        completionPercentage,
      };

      // Add location data if provided (even if lat/lng are 0, we still save them)
      if (
        location &&
        (location.lat !== undefined || location.latitude !== undefined) &&
        (location.lng !== undefined || location.longitude !== undefined)
      ) {
        draftData.customerLocation = {
          latitude: location.lat || location.latitude || 0,
          longitude: location.lng || location.longitude || 0,
        };
      }

      draft = new DraftServiceRequest(draftData);
      await draft.save();
      console.log('Created new draft:', draft._id);
    }

    res.status(200).json({
      success: true,
      message: 'Draft saved successfully',
      draft: {
        id: draft._id,
        draftId: draft._id.toString(), // Return as draftId for consistency
        completionPercentage: draft.completionPercentage,
        currentStep: draft.currentStep,
        currentStepKey: draft.currentStepKey,
        status: draft.status,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error creating/updating draft:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save draft',
      error: error.message,
    });
  }
};

// Get user's draft service requests
export const getMyDrafts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'User ID or session ID required',
      });
    }

    // Query for drafts that are NOT SUBMITTED
    // Explicitly exclude SUBMITTED status and include DRAFT, null, or missing status (backward compatibility)
    const query: any = {
      $and: [
        {
          $or: [
            { status: 'DRAFT' }, // Explicitly DRAFT status
            { status: { $exists: false } }, // Status field doesn't exist (old drafts)
            { status: null }, // Status is null
          ],
        },
        { status: { $ne: 'SUBMITTED' } }, // Explicitly exclude SUBMITTED
      ],
    };

    if (userId) {
      query.$and.push({
        $or: [{ customerId: userId }, { sessionId: sessionId }],
      });
    } else {
      query.$and.push({ sessionId: sessionId });
    }

    console.log('Draft query:', JSON.stringify(query, null, 2));
    console.log('Query params:', { userId, sessionId });

    const drafts = await DraftServiceRequest.find(query).sort({ updatedAt: -1 }).limit(10); // Limit to 10 most recent drafts

    console.log(
      'Found drafts:',
      drafts.length,
      drafts.map(d => ({
        id: d._id,
        city: d.city,
        brand: d.brand,
        status: d.status,
        customerId: d.customerId,
        sessionId: d.sessionId,
      }))
    );

    res.status(200).json({
      success: true,
      drafts: drafts.map(draft => ({
        id: draft._id,
        address: draft.address,
        city: draft.city,
        brand: draft.brand,
        model: draft.model,
        problemDescription: draft.problemDescription,
        completionPercentage: draft.completionPercentage,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        expiresAt: draft.expiresAt,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching drafts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch drafts',
      error: error.message,
    });
  }
};

// Get a specific draft by ID
export const getDraftById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    // Query for drafts that are NOT SUBMITTED (includes DRAFT, null, or missing status)
    const query: any = {
      _id: id,
      $and: [
        {
          $or: [{ status: { $ne: 'SUBMITTED' } }, { status: { $exists: false } }, { status: null }],
        },
      ],
    };

    if (userId) {
      query.$and.push({
        $or: [{ customerId: userId }, { sessionId: sessionId }],
      });
    } else {
      query.$and.push({ sessionId: sessionId });
    }

    const draft = await DraftServiceRequest.findOne(query);

    if (!draft) {
      return res.status(404).json({
        success: false,
        message: 'Draft not found',
      });
    }

    res.status(200).json({
      success: true,
      draft: {
        id: draft._id,
        address: draft.address,
        city: draft.city,
        brand: draft.brand,
        model: draft.model,
        problemDescription: draft.problemDescription,
        userName: draft.userName,
        userPhone: draft.userPhone,
        requestType: draft.requestType,
        serviceType: draft.serviceType,
        beneficiaryName: draft.beneficiaryName,
        beneficiaryPhone: draft.beneficiaryPhone,
        preferredDate: draft.preferredDate,
        preferredTime: draft.preferredTime,
        budget: draft.budget,
        priority: draft.priority,
        isUrgent: draft.isUrgent,
        issueLevel: draft.issueLevel,
        urgency: draft.urgency,
        wantsWarranty: draft.wantsWarranty,
        wantsDataSafety: draft.wantsDataSafety,
        calculatedPricing: draft.calculatedPricing,
        aiPredictions: draft.aiPredictions,
        selectedProblem: draft.selectedProblem,
        aiPredicted: draft.aiPredicted,
        problemType: draft.problemType,
        problemTypeLabel: draft.problemTypeLabel,
        selectedDate: draft.selectedDate,
        selectedTimeSlot: draft.selectedTimeSlot,
        issueImages: draft.issueImages || [],
        currentStep: draft.currentStep || 0,
        currentStepKey: draft.currentStepKey,
        location: draft.location || {
          address: draft.address,
          lat: draft.customerLocation?.latitude || 0,
          lng: draft.customerLocation?.longitude || 0,
        },
        customerLocation: draft.customerLocation,
        completionPercentage: draft.completionPercentage,
        status: draft.status,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error fetching draft:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch draft',
      error: error.message,
    });
  }
};

// Convert draft to actual service request
export const convertDraftToServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const userEmail = req.user?.email;
    const userUsername = req.user?.username;
    const userPhone = req.user?.phone;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to convert draft',
      });
    }

    // Try multiple approaches to find the draft
    let draft = null;

    // Flexible status query (handles DRAFT, null, or missing status)
    const statusQuery = {
      $and: [
        {
          $or: [{ status: { $ne: 'SUBMITTED' } }, { status: { $exists: false } }, { status: null }],
        },
      ],
    };

    // First, try to find by ID only (most permissive)
    const query1: any = {
      _id: id,
      $and: [...statusQuery.$and],
    };
    draft = await DraftServiceRequest.findOne(query1);

    // If found, verify ownership
    if (draft) {
      const isOwner =
        (userId && draft.customerId && draft.customerId.toString() === userId) ||
        (req.headers['x-session-id'] && draft.sessionId === req.headers['x-session-id']);

      if (!isOwner) {
        console.log('Draft found but user not authorized:', {
          draftId: draft._id,
          draftCustomerId: draft.customerId,
          draftSessionId: draft.sessionId,
          userId,
          sessionId: req.headers['x-session-id'],
        });
        draft = null; // Reset to null if not authorized
      }
    }

    // If still not found, try with customerId filter
    if (!draft && userId) {
      const query2: any = {
        _id: id,
        customerId: userId,
        $and: [...statusQuery.$and],
      };
      draft = await DraftServiceRequest.findOne(query2);
    }

    // If still not found, try with sessionId filter
    if (!draft && req.headers['x-session-id']) {
      const query3: any = {
        _id: id,
        sessionId: req.headers['x-session-id'],
        $and: [...statusQuery.$and],
      };
      draft = await DraftServiceRequest.findOne(query3);
    }

    if (!draft) {
      console.log('Draft not found:', {
        id,
        userId,
        sessionId: req.headers['x-session-id'],
        allDrafts: await DraftServiceRequest.find({})
          .select('_id customerId sessionId isCompleted')
          .limit(5),
      });
      return res.status(404).json({
        success: false,
        message: 'Draft not found',
      });
    }

    console.log('Found draft:', {
      id: draft._id,
      address: draft.address,
      city: draft.city,
      brand: draft.brand,
      model: draft.model,
      userName: draft.userName,
      userPhone: draft.userPhone,
      requestType: draft.requestType,
      serviceType: draft.serviceType,
    });

    // Validate required fields for service request
    const requiredFields = ['address', 'city', 'brand', 'model', 'requestType', 'serviceType'];
    const missingFields = requiredFields.filter(field => !draft[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`,
        missingFields,
      });
    }

    // Get username for S3 folder organization
    const username = (draft.customerId || userId).toString(); // Use customerId or userId as username for drafts

    // Handle image uploads if any
    let issueImages: string[] = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      try {
        const uploadPromises = (req.files as Express.Multer.File[]).map(async file => {
          const result = await uploadToS3(file.path, 'user/service-request/drafts', username);
          return result?.url;
        });

        const uploadedUrls = await Promise.all(uploadPromises);
        issueImages = uploadedUrls.filter(url => url !== undefined) as string[];
      } catch (uploadError: any) {
        console.error('Image upload error:', uploadError);
        issueImages = [];
      }
    }

    // Get selectedDate and selectedTimeSlot from request body (if provided in FormData)
    const selectedDate = req.body.selectedDate;
    const selectedTimeSlot = req.body.selectedTimeSlot;

    // Process user-selected date and time slot (prefer FormData over draft data)
    let userSelectedDate: Date | null = null;
    let userSelectedTime: string = '';
    let userSelectedSlot: string = '';

    if (selectedDate && selectedTimeSlot) {
      // Use the new selectedDate and selectedTimeSlot from FormData
      userSelectedDate = new Date(selectedDate);
      userSelectedSlot = selectedTimeSlot;

      // Map time slot to time range
      const timeSlotMap: Record<string, string> = {
        '9-12': '09:00 - 12:00',
        '12-15': '12:00 - 15:00',
        '15-18': '15:00 - 18:00',
      };
      userSelectedTime = timeSlotMap[selectedTimeSlot] || draft.preferredTime || '';
    } else if (draft.selectedDate && draft.selectedTimeSlot) {
      // Fallback to draft's selectedDate/selectedTimeSlot
      userSelectedDate = new Date(draft.selectedDate);
      userSelectedSlot = draft.selectedTimeSlot;
      const timeSlotMap: Record<string, string> = {
        '9-12': '09:00 - 12:00',
        '12-15': '12:00 - 15:00',
        '15-18': '15:00 - 18:00',
      };
      userSelectedTime = timeSlotMap[draft.selectedTimeSlot] || draft.preferredTime || '';
    } else if (draft.preferredDate) {
      // Fallback to draft's preferredDate for backward compatibility
      userSelectedDate = new Date(draft.preferredDate);
      userSelectedTime = draft.preferredTime || '';
    }

    // Create service request from draft
    const serviceRequestData: any = {
      customerId: userId,
      address: draft.address,
      customerLocation: draft.customerLocation || {
        latitude: draft.location?.lat || 12.9716, // Default to Bangalore coordinates
        longitude: draft.location?.lng || 77.5946,
      },
      city: draft.city,
      brand: draft.brand,
      model: draft.model,
      problemDescription: draft.problemDescription || '',
      issueImages,
      status: 'Pending',
      preferredDate: userSelectedDate
        ? userSelectedDate.toISOString().split('T')[0]
        : draft.preferredDate || '',
      preferredTime: userSelectedTime || draft.preferredTime || '',
      // Store user-selected scheduling - automatically accepted since user set it
      scheduledDate: userSelectedDate,
      scheduledTime: userSelectedTime,
      scheduledSlot: userSelectedSlot || undefined,
      userSelectedDate: userSelectedDate,
      userSelectedTimeSlot: userSelectedSlot || undefined,
      scheduleStatus: userSelectedDate ? 'scheduled' : 'pending',
      // Automatically set user response as accepted since user selected the schedule
      userResponse: userSelectedDate
        ? {
            status: 'accepted',
            respondedAt: new Date(),
            userNotes: 'Schedule selected by user during request creation',
          }
        : undefined,
      priority: draft.priority || 'medium',
      isUrgent: draft.isUrgent || false,
      location: draft.location || {
        address: draft.address,
        lat: draft.customerLocation?.latitude || 0,
        lng: draft.customerLocation?.longitude || 0,
      },
      title: `${draft.brand} ${draft.model}`,
      description: draft.problemDescription || '',
      category: 'Device Repair',
      deviceType: 'Unknown',
      deviceBrand: draft.brand,
      deviceModel: draft.model,
      requestType: draft.requestType,
      serviceType: draft.serviceType,
      issueLevel: draft.issueLevel || 'software',
      urgency: draft.urgency || 'standard',
      wantsWarranty: draft.wantsWarranty || false,
      wantsDataSafety: draft.wantsDataSafety || false,
      calculatedPricing: draft.calculatedPricing,
      budget: draft.calculatedPricing
        ? draft.calculatedPricing.finalChargeRange?.min || draft.budget || 0
        : draft.budget || 0,
      aiPredictions: draft.aiPredictions || [],
      selectedProblem: draft.selectedProblem || null,
      aiPredicted: draft.aiPredicted || false,
      problemType:
        draft.problemType && ['known', 'unknown'].includes(draft.problemType)
          ? draft.problemType
          : draft.knowsProblem
            ? 'known'
            : 'unknown',
      knowsProblem: draft.knowsProblem || false,
    };

    // Conditionally add fields based on requestType
    if (draft.requestType === 'self') {
      serviceRequestData.userName = draft.userName || userUsername || 'User';
      serviceRequestData.userPhone = draft.userPhone || userPhone || '';
    } else if (draft.requestType === 'other') {
      serviceRequestData.beneficiaryName = draft.beneficiaryName;
      serviceRequestData.beneficiaryPhone = draft.beneficiaryPhone;
    }

    console.log('Creating service request with data:', {
      customerId: serviceRequestData.customerId,
      address: serviceRequestData.address,
      city: serviceRequestData.city,
      brand: serviceRequestData.brand,
      model: serviceRequestData.model,
      userName: serviceRequestData.userName,
      userPhone: serviceRequestData.userPhone,
      requestType: serviceRequestData.requestType,
      serviceType: serviceRequestData.serviceType,
      customerLocation: serviceRequestData.customerLocation,
    });

    const newServiceRequest = new ServiceRequest(serviceRequestData);
    const savedServiceRequest = await newServiceRequest.save();

    // Mark draft as SUBMITTED and link to service request
    draft.status = 'SUBMITTED';
    draft.isCompleted = true; // Keep for backward compatibility
    draft.convertedToServiceRequestId = savedServiceRequest._id;

    // Update customerId if user is authenticated (for drafts created before login)
    if (userId && !draft.customerId) {
      draft.customerId = userId;
      draft.sessionId = undefined; // Clear session ID since user is now authenticated
    }

    await draft.save();

    console.log('Draft marked as SUBMITTED:', {
      draftId: draft._id,
      status: draft.status,
      serviceRequestId: savedServiceRequest._id,
    });

    res.status(201).json({
      success: true,
      message: 'Draft converted to service request successfully',
      serviceRequest: {
        id: savedServiceRequest._id,
        status: savedServiceRequest.status,
        createdAt: savedServiceRequest.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Error converting draft to service request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert draft to service request',
      error: error.message,
    });
  }
};

// Delete a draft
export const deleteDraft = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    const query: any = { _id: id };

    if (userId) {
      query.$or = [{ customerId: userId }, { sessionId: sessionId }];
    } else {
      query.sessionId = sessionId;
    }

    const draft = await DraftServiceRequest.findOneAndDelete(query);

    if (!draft) {
      return res.status(404).json({
        success: false,
        message: 'Draft not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Draft deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting draft:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete draft',
      error: error.message,
    });
  }
};

// Clean up expired drafts (can be called by a cron job)
export const cleanupExpiredDrafts = async (req: Request, res: Response) => {
  try {
    const result = await DraftServiceRequest.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    console.log(`Cleaned up ${result.deletedCount} expired drafts`);

    res.status(200).json({
      success: true,
      message: `Cleaned up ${result.deletedCount} expired drafts`,
      deletedCount: result.deletedCount,
    });
  } catch (error: any) {
    console.error('Error cleaning up expired drafts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired drafts',
      error: error.message,
    });
  }
};

// Migrate drafts from sessionId to authenticated user
export const migrateDrafts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!sessionId) {
      return res.status(200).json({
        success: true,
        message: 'No session ID provided, nothing to migrate',
        migratedCount: 0,
      });
    }

    // Find all incomplete drafts with this sessionId (not SUBMITTED)
    const drafts = await DraftServiceRequest.find({
      sessionId: sessionId,
      $and: [
        {
          $or: [{ status: { $ne: 'SUBMITTED' } }, { status: { $exists: false } }, { status: null }],
        },
      ],
    });

    let migratedCount = 0;
    const migratedIds = [];

    // Migrate each draft
    for (const draft of drafts) {
      if (!draft.customerId && draft.status !== 'SUBMITTED') {
        draft.customerId = userId;
        draft.sessionId = undefined;
        draft.updatedAt = new Date();
        await draft.save();
        migratedCount++;
        migratedIds.push(draft._id);
      }
    }

    console.log(`Migrated ${migratedCount} draft(s) for user ${userId}`);

    res.status(200).json({
      success: true,
      message: `Successfully migrated ${migratedCount} draft(s)`,
      migratedCount,
      draftIds: migratedIds,
    });
  } catch (error: any) {
    console.error('Error migrating drafts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to migrate drafts',
      error: error.message,
    });
  }
};
