import DraftServiceRequest from '../models/draftServiceRequest.model';

/**
 * Ensures a TTL index exists for draft expiration.
 * Safe to run on every startup.
 */
export async function ensureDraftTtlIndex(): Promise<void> {
  const collection = DraftServiceRequest.collection;
  const ttlIndexName = 'draft_expiresAt_ttl';

  const indexes = await collection.indexes();

  const desiredTtlIndex = indexes.find(index => index.name === ttlIndexName);
  const desiredTtlAlreadyCorrect =
    desiredTtlIndex &&
    desiredTtlIndex.expireAfterSeconds === 0 &&
    desiredTtlIndex.partialFilterExpression?.status === 'DRAFT';

  if (desiredTtlAlreadyCorrect) {
    console.log('[Migration] Draft TTL index already configured. ✓');
    return;
  }

  // Remove legacy non-TTL index created by old schema definition if it exists.
  const legacyExpiresIndex = indexes.find(index => index.name === 'expiresAt_1');
  if (legacyExpiresIndex) {
    await collection.dropIndex('expiresAt_1');
    console.log('[Migration] Dropped legacy expiresAt_1 index.');
  }

  // If the named index exists but has old/wrong options, recreate it.
  if (desiredTtlIndex) {
    await collection.dropIndex(ttlIndexName);
    console.log('[Migration] Dropped outdated draft TTL index.');
  }

  await collection.createIndex(
    { expiresAt: 1 },
    {
      name: ttlIndexName,
      expireAfterSeconds: 0,
      partialFilterExpression: { status: 'DRAFT' },
    }
  );

  console.log('[Migration] Draft TTL index created. ✓');
}
