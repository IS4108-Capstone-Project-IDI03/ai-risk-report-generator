import { Schema, model } from 'mongoose'

export const USER_ROLES = ['risk_engineer', 'reviewer', 'knowledge_admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

// A team member's account profile (F-03). Sign-in and passwords arrive with
// F-04; nothing here authenticates anyone.
export interface IUser {
  // Stable staff ID, e.g. MRE-0001. Not editable, so seeds and other records
  // can refer to an account even after its email changes.
  staffId: string
  name: string
  email: string
  role: UserRole
  jobTitle?: string
  phone?: string
  // Two-letter jurisdiction code of the office the user works from, e.g. SG.
  office?: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>(
  {
    staffId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    role: { type: String, required: true, enum: USER_ROLES },
    jobTitle: { type: String, trim: true },
    phone: { type: String, trim: true },
    office: { type: String, trim: true },
    active: { type: Boolean, required: true, default: true },
  },
  {
    timestamps: true,
    collection: 'users',
  },
)

export const UserModel = model<IUser>('User', userSchema)
