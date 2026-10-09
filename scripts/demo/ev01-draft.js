// Inserts ONE hand-made draft with deliberate problems, so EV-01 can be tried
// for free (no AI call). Run: mongosh mongodb://localhost:27017/riskreport EV-01-draft.js
const a = db.assessments.findOne({ reference: "RPT-2026-0408" });
let obs = db.observations.findOne({ assessment: a._id, deleted: { $exists: false } });
if (!obs) {   // none yet: add one clearly marked demo observation (no AI call)
  let ses = db.capture_sessions.findOne({ assessment: a._id });
  if (!ses) { const r = db.capture_sessions.insertOne({ assessment: a._id, status: "active", createdAt: new Date(), updatedAt: new Date() }); ses = { _id: r.insertedId }; }
  const r = db.observations.insertOne({
    assessment: a._id, session: ses._id, engineer: "EV-01 demo", note: "EV-01 demo observation: risers not fire-stopped.",
    recordings: [], photos: [], severity: "high", location: (a.locations && a.locations[0] ? a.locations[0]._id : new ObjectId()),
    createdAt: new Date(), updatedAt: new Date(),
    metadata: { source_type: "observation", jurisdiction: "SG", facility_type: "Warehouse", COPE_dimension: "Construction", effective_date: new Date() } });
  obs = { _id: r.insertedId };
}
const real = "O:" + obs._id;
db.report_sections.deleteMany({ assessment: a._id, "provenance.model": "ev01-demo" });
db.report_sections.insertOne({
  assessment: a._id, sectionId: "7", title: "Construction",
  subsections: [
    { heading: "Construction Narrative", kind: "narrative", statements: [
      { text: "Cites a real observation.", citations: [real], supported: true },
      { text: "Has no citation at all.", citations: [], supported: true },
      { text: "Cites an active standard passage.", citations: ["C:demo-doc:1"], supported: true },
      { text: "Cites a passage of a withdrawn document.", citations: ["P:demo-withdrawn:1"], supported: true },
      { text: "Cites a passage that does not exist.", citations: ["C:no-such-doc:1"], supported: true },
      { text: "Cites an observation that does not exist.", citations: ["O:" + new ObjectId()], supported: true } ] },
    { heading: "Construction Table", kind: "table", statements: [] },
    // "Compartmentalization and Fire Divisions" is left out on purpose (compulsory heading)
    { heading: "Details on Combustible Construction", kind: "narrative", statements: [] },
    { heading: "Roof Condition", kind: "narrative", statements: [] } ],   // not in the template
  sources: {}, questions: [], evidence: [], guardrail: { passed: true, unsupported_count: 0 },
  provenance: { provider: "demo", model: "ev01-demo", effort: "high", prompt_version: "demo",
                template_version: "global-pre-v1.0", generated_at: new Date() },   // older template
  createdBy: a.engineer, createdAt: new Date(), updatedAt: new Date(),
  metadata: { source_type: "report_section", jurisdiction: "SG", facility_type: "Warehouse",
              COPE_dimension: "Construction", effective_date: new Date() } });
print("inserted a demo draft for RPT-2026-0408 (observation cited: " + real + ")");
