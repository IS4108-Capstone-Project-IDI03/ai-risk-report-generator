import { Schema, model } from 'mongoose'

// A client the firm surveys for (CP-17), e.g. NUS, with many sites. Every
// engineer sees every client, so one isn't added twice.
export interface IClient {
  name: string
  // The name lowercased, with its spacing tidied, so "NUS" and "nus " are one
  // client. See clientKey.
  key: string
}

const clientSchema = new Schema<IClient>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    key: { type: String, required: true, unique: true },
  },
  {
    timestamps: true,
    collection: 'clients',
  },
)

export const ClientModel = model<IClient>('Client', clientSchema)
