// Links each site saved before CP-17 to a client, made from the client name
// typed on its assessment: names that match ignoring case and spacing become
// one client, spelt as first found. Sites are never merged, even with the
// same name. The assessment keeps its typed name, unused, in case this needs
// running again. A site with no assessment (e.g. the health check's test
// record) has no name to go by and is left as it is.
// Safe to run more than once: a linked site is skipped.
//   npm --prefix server run migrate:clients
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb } from '../models/db'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { findOrCreateClient } from '../services/client.service'

export async function migrateClients() {
  const clientsBefore = await ClientModel.countDocuments()
  // Oldest first, so a name is spelt as on its first assessment.
  const sites = await SiteModel.find({ client: { $exists: false } }, '_id')
    .sort({ _id: 1 })
    .lean()
  let linked = 0
  let unlinked = 0
  for (const site of sites) {
    // Each site has had one assessment until CP-17; should one have more,
    // its first names the client.
    const assessment = await AssessmentModel.findOne(
      { site: site._id, client: { $type: 'string', $regex: /\S/ } },
      'client',
    )
      .sort({ createdAt: 1, _id: 1 })
      .lean()
    if (!assessment) {
      unlinked++
      continue
    }
    // The query matched only a name with text in it.
    const client = await findOrCreateClient(assessment.client!)
    const updated = await SiteModel.updateOne(
      { _id: site._id, client: { $exists: false } },
      { $set: { client: client._id } },
    )
    linked += updated.modifiedCount
  }
  return {
    clients: (await ClientModel.countDocuments()) - clientsBefore,
    sites: linked,
    unlinked,
  }
}

async function migrate() {
  await connectDb()
  const result = await migrateClients()
  console.log(
    `Clients added: ${result.clients}. Sites linked: ${result.sites}. Sites with no assessment, left unlinked: ${result.unlinked}.`,
  )
  await mongoose.disconnect()
}

// Run from the command line; a test imports migrateClients alone.
if (require.main === module) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
