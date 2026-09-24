import { Schema, model } from 'mongoose'

export interface ISite {
  code: string
  name: string
  jurisdiction: string
  facilityType: string
  address?: string
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
  },
  {
    timestamps: true,
    collection: 'sites',
  },
)

export const SiteModel = model<ISite>('Site', siteSchema)
