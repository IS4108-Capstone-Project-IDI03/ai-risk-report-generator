import { Schema, Types, model } from 'mongoose'
import type { IStamp } from './observation.model'

export interface ISite {
  code: string
  name: string
  jurisdiction: string
  facilityType: string
  address?: string
  // The client it belongs to (CP-17). Every site created since has one; one
  // created before gets it from `npm run migrate:clients`.
  client?: Types.ObjectId
  // The names and addresses it had before it was corrected (CP-18), kept so
  // notes written with them are still masked before external AI calls (PV-02).
  // Absent until it is first corrected.
  formerNames?: string[]
  formerAddresses?: string[]
  // Its latest correction (CP-18).
  edited?: IStamp
  // Present only while it is removed (CP-18), a soft removal: it leaves the
  // create form and its client's page, and restoring removes this.
  // `withClient` marks one removed with its client, which restore together.
  removed?: IStamp & { withClient?: boolean }
}

const stampFields = {
  at: { type: Date, required: true },
  by: {
    id: { type: String, required: true },
    name: { type: String, required: true },
  },
}

const siteSchema = new Schema<ISite>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    jurisdiction: {
      type: String,
      required: true,
      trim: true,
    },
    facilityType: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    client: { type: Schema.Types.ObjectId, ref: 'Client', index: true },
    // Left out until there is one, rather than defaulting to [].
    formerNames: { type: [String], default: undefined },
    formerAddresses: { type: [String], default: undefined },
    edited: { type: new Schema(stampFields, { _id: false }) },
    removed: {
      type: new Schema({ ...stampFields, withClient: Boolean }, { _id: false }),
    },
  },
  {
    timestamps: true,
    collection: 'sites',
  },
)

export const SiteModel = model<ISite>('Site', siteSchema)
