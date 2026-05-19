import mongoose, { Document, Schema, SchemaType } from 'mongoose';
export interface Workspace extends Document {
  userId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  technicians: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;

  workspaceName: string;
}

const Workspaceschema = new Schema<Workspace>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  vendorId: { type: Schema.Types.ObjectId, ref: 'Vendors', required: true },
  technicians: [{ type: Schema.Types.ObjectId, ref: 'Technicians' }],
  createdAt: { type: Date, required: true },
  updatedAt: { type: Date },
  workspaceName: { type: String, required: true },
});

export default mongoose.model<Workspace>('Workspace', Workspaceschema);
