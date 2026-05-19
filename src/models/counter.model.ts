import mongoose, { Schema } from 'mongoose';

// _id is the month key e.g. "202603"
// seq is the last used sequence number for that month
const CounterSchema: Schema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export default mongoose.model('Counter', CounterSchema);
