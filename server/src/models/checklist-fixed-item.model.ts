// CP-37: one fixed checklist question for a site type, kept in `checklist_fixed_items`. It is
// copied into every checklist generated for that site type. Written by checklist-fixed.service.ts;
// see docs/areas/database.md. Soft delete (`removed`) so the admin can restore one.
import { Schema, model } from 'mongoose'

export interface IChecklistFixedItem {
  facilityType: string
  text: string
  // A report section id ('7' to '12'), or null for the "Always check" group.
  area: string | null
  removed: { at: Date; by: { id: string; name: string } } | null
  metadata: {
    source_type: 'checklist'
    // A fixed question applies in every country.
    jurisdiction: 'all'
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
}

const schema = new Schema<IChecklistFixedItem>(
  {
    facilityType: { type: String, required: true, index: true },
    text: { type: String, required: true, maxlength: 500 },
    area: { type: String, default: null },
    removed: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          by: { id: { type: String, required: true }, name: { type: String, required: true } },
        },
        { _id: false },
      ),
      default: null,
    },
    metadata: {
      source_type: { type: String, enum: ['checklist'], required: true },
      jurisdiction: { type: String, enum: ['all'], required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true },
)

export const ChecklistFixedItemModel = model<IChecklistFixedItem>('ChecklistFixedItem', schema)
