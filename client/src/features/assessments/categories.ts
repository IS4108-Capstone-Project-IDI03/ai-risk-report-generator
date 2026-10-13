// The COPE categories an observation is filed under, by the value each is
// stored as: the same values the knowledge base tags its chunks with.
export const CAT_ICON: Record<string, string> = {
  Construction: 'hard-hat',
  Occupancy: 'factory',
  Protection: 'flame',
  Exposure: 'cloud-lightning',
}
// An observation may be saved before it is categorised (CP-02) and categorised
// later by editing its tags (CP-06); report drafting leaves it out until then.
export const UNCATEGORISED = 'Uncategorised'

// The COPE categories an observation can be filed under, in C-O-P-E order
// (CP-08 AC7). One finding can concern several, so an observation holds a
// list; an empty one is uncategorised, which drafting leaves out.
export const COPE_CATEGORIES = Object.keys(CAT_ICON)

// The list as the gateway stores it: in C-O-P-E order, without repeats.
const ordered = (cats: string[]) => COPE_CATEGORIES.filter((c) => cats.includes(c))

// Adds a category, or takes it off when it is already there.
export const toggleCategory = (cats: string[], cat: string) =>
  cats.includes(cat) ? cats.filter((c) => c !== cat) : ordered([...cats, cat])
// Adds a category, keeping those already chosen.
export const withCategory = (cats: string[], cat: string) => ordered([...cats, cat])
export const sameCategories = (a: string[], b: string[]) => String(a) === String(b)

// "Construction, Protection", or "Uncategorised".
export const categoryLabel = (cats: string[]) => cats.join(', ') || UNCATEGORISED
// The icon of its first category.
export const categoryIcon = (cats: string[]) => CAT_ICON[cats[0]] || 'circle-dot'
// Whether it matches the category filter: Uncategorised matches only those with none.
export const hasCategory = (cats: string[], cat: string) =>
  cat === UNCATEGORISED ? !cats.length : cats.includes(cat)
// What the gateway is sent: null for none.
export const copeDimensionsOf = (cats: string[]) => (cats.length ? cats : null)

export const UNCATEGORISED_HINT =
  'None chosen: report drafting leaves this observation out until it is categorised.'
