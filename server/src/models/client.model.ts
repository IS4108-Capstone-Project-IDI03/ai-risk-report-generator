import { Schema, model } from 'mongoose'
import type { IStamp } from './observation.model'

// A client the firm surveys for (CP-17), e.g. NUS, with many sites. Every
// engineer sees every client, so one isn't added twice.
export interface IClient {
  name: string
  // The name lowercased, with its spacing tidied, so "NUS" and "nus " are one
  // client. See clientKey.
  key: string
  // The part of the client the work is for, e.g. "Cold chain" (CP-23).
  division?: string
  // The names it had before it was renamed (CP-18), kept so notes written
  // with them are still masked before external AI calls (PV-02). Absent until
  // it is first renamed.
  formerNames?: string[]
  // Its latest rename (CP-18).
  edited?: IStamp
}

const clientSchema = new Schema<IClient>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    key: { type: String, required: true, unique: true },
    division: { type: String, trim: true, maxlength: 200 },
    // Left out until there is one, rather than defaulting to [].
    formerNames: { type: [String], default: undefined },
    edited: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          by: { id: { type: String, required: true }, name: { type: String, required: true } },
        },
        { _id: false },
      ),
    },
  },
  {
    timestamps: true,
    collection: 'clients',
  },
)

export const ClientModel = model<IClient>('Client', clientSchema)
