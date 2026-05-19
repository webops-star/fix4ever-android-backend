import ServiceRequest from '../models/serviceRequest.model';
import { generateRequestId } from './requestIdGenerator';

/**
 * One-time migration: assign request_id to all existing ServiceRequest documents that don't have one.
 * Safe to run on every startup — skips documents that already have request_id.
 */
export async function migrateRequestIds(): Promise<void> {
  const missing = await ServiceRequest.find({
    $or: [{ request_id: { $exists: false } }, { request_id: null }, { request_id: '' }],
  }).select('_id');

  if (missing.length === 0) {
    console.log('[Migration] All service requests already have request_id. ✓');
    return;
  }

  console.log(`[Migration] Backfilling request_id for ${missing.length} service request(s)...`);

  for (const doc of missing) {
    const request_id = await generateRequestId();
    await ServiceRequest.updateOne({ _id: doc._id }, { $set: { request_id } });
  }

  console.log(`[Migration] Done. ${missing.length} service request(s) updated. ✓`);
}
