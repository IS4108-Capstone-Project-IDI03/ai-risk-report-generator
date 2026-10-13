import { Schema, Types, model } from 'mongoose'

export interface ISite {
  code: string
  name: string
  jurisdiction: string
  facilityType: string
  address?: string
  // The client it belongs to (CP-17). Every site created since has one; one
  // created before gets it from `npm run migrate:clients`.
  client?: Types.ObjectId
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
  },
  {
    timestamps: true,
    collection: 'sites',
  },
)

export const SiteModel = model<ISite>('Site', siteSchema)
