// A site's locations by building and level (CP-16): one in a building, with
// an optional level (none is the whole building, e.g. its facade), or one
// elsewhere on site, with a name only. One saved before CP-16 may have a level
// but no building.
export type Place = {
  building?: string | null
  floor?: string | null
  name: string
}

export const ELSEWHERE = 'Elsewhere on site'
export const WHOLE_BUILDING = 'Whole building'
export const NO_BUILDING = 'Building not recorded'

// Suggested on the Level field, so levels are spelt the way they sort.
export const LEVEL_SUGGESTIONS = [
  'Basement 2',
  'Basement 1',
  'Ground',
  'Level 1',
  'Level 2',
  'Level 3',
  'Mezzanine',
  'Roof',
]

// The place as shown on screen, general to specific: "Block A · Level 2 ·
// Staircase", "Block A · Facade", "Elsewhere on site · Fire access route".
// One with a level but no building reads "Level 2 · Stairwell B".
export function locationLabel(l: Place) {
  return [l.building || (l.floor ? null : ELSEWHERE), l.floor, l.name].filter(Boolean).join(' · ')
}

// The place as a report words it, most specific first: "Staircase, Level 2,
// Block A" (the gateway's locationText).
export function locationText(l: Place) {
  return [l.name, l.floor, l.building].filter(Boolean).join(', ')
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
// The same name whatever the case, as the gateway matches them.
export const sameName = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

// A level it recognises, in its standard spelling: "L2", "lvl 2" and "2nd
// floor" are all Level 2, "B1" is Basement 1 and "GF" is Ground. null for a
// name it doesn't know, e.g. Podium. The gateway saves levels the same way
// (standardLevel in location.service.ts), so "L2" and "Level 2" are one level.
export function standardLevel(level: string): string | null {
  const l = level.trim().toLowerCase().replace(/\s+/g, ' ')
  let m = /^(?:basement|b) ?(\d+)$/.exec(l)
  if (m) return 'Basement ' + Number(m[1])
  if (l === 'basement') return 'Basement'
  if (/^(?:lower ground|lg)$/.test(l)) return 'Lower ground'
  if (/^(?:ground|ground floor|g|gf)$/.test(l)) return 'Ground'
  if (/^(?:upper ground|ug)$/.test(l)) return 'Upper ground'
  if (/^(?:mezzanine|mezz)$/.test(l)) return 'Mezzanine'
  if (/^(?:roof|rooftop|roof level)$/.test(l)) return 'Roof'
  m =
    /^(?:level|lvl|l|floor|storey) ?(\d+)$/.exec(l) ?? /^(\d+)(?:st|nd|rd|th)?(?: floor)?$/.exec(l)
  if (m) return 'Level ' + Number(m[1])
  return null
}

const RANKS: Record<string, number> = {
  Basement: -1,
  'Lower ground': -0.5,
  Ground: 0,
  'Upper ground': 0.5,
  Mezzanine: 1.5,
  Roof: 10000,
}
// Where a level sorts, lowest first: basements, ground, numbered levels, a
// mezzanine just above Level 1, then the roof. null for a name it doesn't
// know, which goes after the rest in the order it was added.
export function levelRank(level: string): number | null {
  const standard = standardLevel(level)
  if (!standard) return null
  const m = /^(Basement|Level) (\d+)$/.exec(standard)
  if (m) return m[1] === 'Basement' ? -Number(m[2]) : Number(m[2])
  return RANKS[standard]
}

// How many letters differ between two words: adding, dropping or changing a
// letter, or swapping two side by side, each counts one.
function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)),
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[a.length][b.length]
}
// A slip of the finger: another word, but one letter off a short one, or two
// off a longer one.
const nearly = (typed: string, word: string) =>
  typed !== word && editDistance(typed, word) <= (word.length < 6 ? 1 : 2)

const LEVEL_WORDS = [
  'level',
  'basement',
  'ground',
  'lower ground',
  'upper ground',
  'mezzanine',
  'roof',
  'rooftop',
  'floor',
  'storey',
]
// The level a name it doesn't recognise was probably meant to be, from a slip
// in its word: "lvel 2" is Level 2, "basment 1" Basement 1, "grond" Ground.
// null when no level word is that close, e.g. Podium.
export function suggestLevel(level: string): string | null {
  const m = /^([a-z][a-z ]*?) ?(\d*)$/.exec(level.trim().toLowerCase().replace(/\s+/g, ' '))
  const word = m && LEVEL_WORDS.find((w) => nearly(m[1], w))
  return word ? standardLevel(m[2] ? word + ' ' + m[2] : word) : null
}

// A name already used that this one was probably meant to be: the same words
// but for a slip in one, e.g. "Blcok A" for Block A. A short or numbered word,
// such as A, B2 or 3, must match, so Block B is never taken for Block A.
export function similarName(typed: string, names: (string | null | undefined)[]) {
  const words = (s: string) => s.trim().toLowerCase().split(/\s+/)
  const t = words(typed)
  return (
    names.find((name): name is string => {
      if (!name) return false
      const n = words(name)
      return (
        n.length === t.length &&
        n.some((w, i) => w !== t[i]) &&
        n.every((w, i) => w === t[i] || (w.length > 3 && !/\d/.test(w) && nearly(t[i], w)))
      )
    }) ?? null
  )
}

// Common building words, and the usual names of places on a site, in their
// standard spelling: what a mistyped building or location is checked against
// (CP-16). The Location field also suggests the places as the engineer types.
export const BUILDING_WORDS = [
  'Block',
  'Tower',
  'Building',
  'Wing',
  'Annexe',
  'Warehouse',
  'Factory',
  'Hall',
  'Mall',
  'Podium',
  'Car park',
  'Office',
  'Workshop',
  'Pavilion',
  'Terminal',
  'Hangar',
]
export const LOCATION_NAMES = [
  'Staircase',
  'Stairwell',
  'Lobby',
  'Lift lobby',
  'Corridor',
  'Store room',
  'Office',
  'Kitchen',
  'Canteen',
  'Toilet',
  'Reception',
  'Fire pump room',
  'Pump room',
  'Sprinkler valve room',
  'Fire command centre',
  'Control room',
  'Electrical room',
  'Switch room',
  'Main switchboard room',
  'Transformer room',
  'Generator room',
  'Battery room',
  'Server room',
  'Data centre',
  'Riser',
  'Electrical riser',
  'Plant room',
  'Boiler room',
  'Lift motor room',
  'Chiller plant',
  'Loading bay',
  'Production area',
  'Workshop',
  'Car park',
  'Roof',
  'Facade',
  'Fire access route',
  'Service road',
  'Driveway',
  'Guardhouse',
  'Bin centre',
  'Substation',
  'Sprinkler tank',
  'Water tank',
  'Diesel tank',
  'External yard',
]

// A name's words, less the short or numbered ones at its end, such as A, B2
// or 3: its own mark, which is never corrected.
function stemOf(typed: string) {
  const words = typed.trim().split(/\s+/)
  let end = words.length
  while (end > 0 && (words[end - 1].length <= 2 || /\d/.test(words[end - 1]))) end--
  return { stem: words.slice(0, end).join(' ').toLowerCase(), marks: words.slice(end) }
}

// Whether a name is a standard one, whatever its case or mark, e.g. "block a"
// or "Riser B". One that is is never corrected towards a name already on the
// site, which may itself be mistyped.
export const isStandardName = (typed: string, standard: string[]) =>
  standard.some((s) => s.toLowerCase() === stemOf(typed).stem)

// The standard name a typed one was probably meant to be, keeping its mark:
// "blcok a" is Block A, "stiarcase" Staircase, "fire pmp room" Fire pump room.
// null when it is already standard, too short to judge (under five letters,
// so Hall is never taken for Mall), or not close to any.
export function correctName(typed: string, standard: string[]): string | null {
  const { stem, marks } = stemOf(typed)
  if (stem.length < 5 || isStandardName(typed, standard)) return null
  let best: string | null = null
  let closest = Infinity
  for (const s of standard) {
    const distance = editDistance(stem, s.toLowerCase())
    if (distance < closest && distance <= (s.length < 6 ? 1 : 2)) {
      best = s
      closest = distance
    }
  }
  return best && [best, ...marks.map((m) => m.toUpperCase())].join(' ')
}

export type LevelGroup<T> = {
  // Shown above its locations: a level, Whole building, or null elsewhere on site.
  title: string | null
  locations: T[]
}
export type LocationGroup<T> = {
  key: string
  // A building, Elsewhere on site, or Building not recorded.
  title: string
  levels: LevelGroup<T>[]
}

// Locations in one building (or with none) by level: the whole building
// first, then lowest first. Each level's locations in name order.
function byLevel<T extends Place>(list: T[], whole: string | null): LevelGroup<T>[] {
  const levels: { title: string | null; locations: T[] }[] = []
  for (const l of list) {
    const title = l.floor || whole
    const level = levels.find((x) => sameName(x.title, title))
    if (level) level.locations.push(l)
    else levels.push({ title, locations: [l] })
  }
  const rank = (title: string | null) =>
    !title || title === whole ? -Infinity : (levelRank(title) ?? Infinity)
  return levels
    .map((level, added) => ({ level, added }))
    .sort((a, b) => rank(a.level.title) - rank(b.level.title) || a.added - b.added)
    .map(({ level }) => ({
      ...level,
      locations: [...level.locations].sort((a, b) => collator.compare(a.name, b.name)),
    }))
}

// The picker's groups: each building, in name order, then Elsewhere on site,
// then any locations with a level but no building.
export function groupLocations<T extends Place>(list: T[]): LocationGroup<T>[] {
  const buildings: { title: string; locations: T[] }[] = []
  for (const l of list.filter((x) => x.building)) {
    const building = buildings.find((b) => sameName(b.title, l.building))
    if (building) building.locations.push(l)
    else buildings.push({ title: l.building!, locations: [l] })
  }
  const elsewhere = list.filter((l) => !l.building && !l.floor)
  const unplaced = list.filter((l) => !l.building && l.floor)
  return [
    ...buildings
      .sort((a, b) => collator.compare(a.title, b.title))
      .map((b) => ({
        key: 'building:' + b.title.toLowerCase(),
        title: b.title,
        levels: byLevel(b.locations, WHOLE_BUILDING),
      })),
    ...(elsewhere.length
      ? [{ key: 'elsewhere', title: ELSEWHERE, levels: byLevel(elsewhere, null) }]
      : []),
    ...(unplaced.length
      ? [{ key: 'unplaced', title: NO_BUILDING, levels: byLevel(unplaced, null) }]
      : []),
  ]
}

// The group a location is listed in.
export const groupKey = (l: Place) =>
  l.building ? 'building:' + l.building.toLowerCase() : l.floor ? 'unplaced' : 'elsewhere'

// Names already used, once each whatever the case, in the order first used,
// then the given suggestions not already among them.
export function suggestions(used: (string | null | undefined)[], extra: string[] = []) {
  const names: string[] = []
  for (const name of [...used, ...extra])
    if (name && !names.some((n) => sameName(n, name))) names.push(name)
  return names
}
