import { Schema, model } from 'mongoose'

// Named sequences, e.g. `assessment:2026` for report references. Incremented
// atomically, so concurrent requests never receive the same number.
export interface ICounter {
  _id: string
  seq: number
}

const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: 'counters', versionKey: false },
)

export const CounterModel = model<ICounter>('Counter', counterSchema)
