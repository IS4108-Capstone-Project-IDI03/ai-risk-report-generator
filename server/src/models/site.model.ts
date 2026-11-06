import { Schema, Types, model } from 'mongoose'
import type { IStamp } from './observation.model'

export interface ICoordinates {
  lat: number
  lng: number
}

export interface IBlockPin extends ICoordinates {
  key: string
  name: string
}

export interface ISite {
  code: string
  name: string
  jurisdiction: string
  facilityType: string
  address?: string
  // Where it is on the map (CP-26), for directions. Optional: absent until an
  // engineer sets it.
  coordinates?: ICoordinates
  // A pin for each block pinned on its map (CP-26), kept on the site rather
  // than a visit because buildings don't move. `key` is the lowercased name, so
  // "Block A" on a later visit finds the same pin. Levels and rooms have none.
  blockPins?: IBlockPin[]
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

export const coordinateFields = {
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
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
    coordinates: { type: coordinateFields, _id: false, default: undefined },
    blockPins: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          name: { type: String, required: true, trim: true },
          ...coordinateFields,
        },
      ],
      default: undefined,
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
