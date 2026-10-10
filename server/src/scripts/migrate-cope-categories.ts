// Rewrites COPE categories saved as one string into lists, now that an
// observation can be filed under several: observations' metadata.COPE_dimension
// and the evidence kept in report section drafts. Reads already treat a string
// as a list of one (copeDimensionsOf), so this only tidies what is stored.
// Safe to run more than once; null (uncategorised) is left as it is.
//   npm --prefix server run migrate:cope
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb } from '../models/db'
import { ObservationModel } from '../models/observation.model'
import { ReportSectionModel } from '../models/report-section.model'

// The aggregation $type, unlike the query one, says 'array' for a list, so a
// list holding strings is not matched as a string.
const isString = (path: string) => ({ $eq: [{ $type: path }, 'string'] })

export async function migrateCopeCategories() {
  const observations = await ObservationModel.collection.updateMany(
    { $expr: isString('$metadata.COPE_dimension') },
    [{ $set: { 'metadata.COPE_dimension': ['$metadata.COPE_dimension'] } }],
  )

  const drafts = await ReportSectionModel.collection.updateMany(
    {
      $expr: {
        $anyElementTrue: [
          {
            $map: { input: { $ifNull: ['$evidence', []] }, in: isString('$$this.COPE_dimension') },
          },
        ],
      },
    },
    [
      {
        $set: {
          evidence: {
            $map: {
              input: '$evidence',
              in: {
                $mergeObjects: [
                  '$$this',
                  {
                    COPE_dimension: {
                      $cond: [
                        isString('$$this.COPE_dimension'),
                        ['$$this.COPE_dimension'],
                        '$$this.COPE_dimension',
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ],
  )

  return { observations: observations.modifiedCount, drafts: drafts.modifiedCount }
}

async function migrate() {
  await connectDb()
  const updated = await migrateCopeCategories()
  console.log(`Observations updated: ${updated.observations}. Drafts updated: ${updated.drafts}.`)
  await mongoose.disconnect()
}

// Run from the command line; a test imports migrateCopeCategories alone.
if (require.main === module) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
