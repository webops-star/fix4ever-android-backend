import Counter from '../models/counter.model';

export async function generateRequestId(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthKey = `${year}${month}`; // e.g. "202603"

  const counter = await Counter.findOneAndUpdate(
    { _id: monthKey },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const seq = String(counter!.seq).padStart(5, '0'); // "00001"
  return `F4E${year}${month}${seq}`; // "F4E2026030001"
}
