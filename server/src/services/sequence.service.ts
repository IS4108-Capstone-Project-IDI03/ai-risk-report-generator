import { CounterModel } from '../models/counter.model'

// Takes the next number in a named sequence, e.g. `assessment:2026` or
// `staff`. Incremented atomically, so concurrent requests never share one.
export async function nextInSequence(sequence: string): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate(
    { _id: sequence },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  ).lean()
  if (!counter) throw new Error(`Sequence ${sequence} could not be incremented.`)
  return counter.seq
}
