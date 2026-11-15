import { BODY_AREAS, type BodyArea } from './types.ts';

/**
 * Offline free-text → body area matching. Pure, no network.
 *
 * Normalising: the text is lower-cased, "n't" becomes " not", "&" and "/"
 * become "and", and every other non-alphanumeric run becomes one space, so
 * "T-Spine!!" reads as "t spine". "upper and lower back" is expanded to
 * "upper back lower back" (both orders, also "spine" and "body").
 *
 * Matching: phrases are matched as whole words, LONGEST FIRST, and each match
 * is blanked out of the text so a specific phrase wins over the generic words
 * inside it ("lower back" does not also fire "back"; "thoracic spine" does not
 * also fire "spine"; "back of my neck" is only the neck). Idioms that merely
 * contain an area word ("come back later", "lean back", "hip hop", "trap
 * bar") are blanked before anything else.
 *
 * Negation: "not", "no", "avoid", "skip", "except", "without", "but not",
 * "other than", ... exclude the areas named AFTER them, up to the next comma
 * (or other punctuation) or "and"/"but"/"or". Results:
 *   - areas named, some excluded  → named minus excluded;
 *   - only exclusions ("not my neck"), or "everything / full body except X"
 *                                  → every area minus the excluded ones, so
 *     the routine really avoids them (a well-rounded fallback would not);
 *   - "full body" / "whole body" / "everything" / "head to toe" with no
 *     exclusions                     → [] (meaning well-rounded; see
 *     {@link parseAreas} to tell that apart from "nothing recognised").
 */

/** Marker for "the whole body" phrases. */
const FULL = 'FULL' as const;
type Hit = BodyArea | typeof FULL;

const BACK_OF: ReadonlyArray<readonly [string, readonly Hit[]]> = [
  ['neck', ['neck']],
  ['head', ['neck']],
  ['thigh', ['hamstrings']],
  ['thighs', ['hamstrings']],
  ['leg', ['hamstrings', 'calves']],
  ['legs', ['hamstrings', 'calves']],
  ['knee', ['hamstrings', 'calves']],
  ['knees', ['hamstrings', 'calves']],
  ['arm', ['shoulders']],
  ['arms', ['shoulders']],
  ['shoulder', ['shoulders']],
  ['shoulders', ['shoulders']],
];

const FRONT_OF: ReadonlyArray<readonly [string, readonly Hit[]]> = [
  ['thigh', ['quads']],
  ['thighs', ['quads']],
  ['hip', ['hips']],
  ['hips', ['hips']],
  ['neck', ['neck']],
  ['shoulder', ['shoulders', 'chest']],
  ['shoulders', ['shoulders', 'chest']],
];

/** "back of my legs", "back of the legs", "back of legs", ... */
function ofPhrases(
  lead: string,
  list: ReadonlyArray<readonly [string, readonly Hit[]]>,
): [string, readonly Hit[]][] {
  const out: [string, readonly Hit[]][] = [];
  for (const [part, hits] of list) {
    for (const det of ['', 'my ', 'the ', 'your ']) out.push([`${lead} of ${det}${part}`, hits]);
  }
  return out;
}

const SYNONYMS: ReadonlyArray<readonly [string, readonly Hit[]]> = [
  // Whole body (means well-rounded)
  ['full body', [FULL]],
  ['whole body', [FULL]],
  ['entire body', [FULL]],
  ['everything', [FULL]],
  ['all over', [FULL]],
  ['head to toe', [FULL]],
  ['head to toes', [FULL]],
  ['upper body', ['neck', 'upperBack', 'chest', 'shoulders', 'wristsForearms']],
  ['lower body', ['hips', 'glutes', 'hamstrings', 'quads', 'calves']],
  // Neck
  ['neck', ['neck']],
  ['necks', ['neck']],
  ['stiff neck', ['neck']],
  ['tech neck', ['neck', 'upperBack']],
  ['text neck', ['neck', 'upperBack']],
  ['traps', ['neck']],
  ['trap', ['neck']],
  ['trapezius', ['neck']],
  ['cervical', ['neck']],
  ['cervical spine', ['neck']],
  ['c spine', ['neck']],
  ['levator', ['neck']],
  ['scalene', ['neck']],
  ['scalenes', ['neck']],
  ['head', ['neck']],
  // Upper back
  ['upper back', ['upperBack']],
  ['upperback', ['upperBack']],
  ['mid back', ['upperBack']],
  ['midback', ['upperBack']],
  ['middle back', ['upperBack']],
  ['upper spine', ['upperBack']],
  ['mid spine', ['upperBack']],
  ['t spine', ['upperBack']],
  ['tspine', ['upperBack']],
  ['thoracic', ['upperBack']],
  ['thoracic spine', ['upperBack']],
  ['between shoulder blades', ['upperBack']],
  ['between my shoulder blades', ['upperBack']],
  ['between the shoulder blades', ['upperBack']],
  ['shoulder blades', ['upperBack']],
  ['shoulder blade', ['upperBack']],
  ['rhomboids', ['upperBack']],
  ['rhomboid', ['upperBack']],
  ['lats', ['upperBack', 'shoulders']],
  ['lat', ['upperBack', 'shoulders']],
  ['hunch', ['upperBack', 'chest']],
  ['hunched', ['upperBack', 'chest']],
  ['rounded shoulders', ['chest', 'upperBack', 'shoulders']],
  // Lower back
  ['lower back', ['lowerBack']],
  ['lowerback', ['lowerBack']],
  ['low back', ['lowerBack']],
  ['lumbar', ['lowerBack']],
  ['lumbar spine', ['lowerBack']],
  ['lower spine', ['lowerBack']],
  ['l spine', ['lowerBack']],
  ['ql', ['lowerBack']],
  ['core', ['lowerBack']],
  ['back', ['upperBack', 'lowerBack']],
  ['backs', ['upperBack', 'lowerBack']],
  ['spine', ['upperBack', 'lowerBack']],
  // Chest
  ['chest', ['chest']],
  ['open up chest', ['chest']],
  ['open up my chest', ['chest']],
  ['pecs', ['chest']],
  ['pec', ['chest']],
  ['pectorals', ['chest']],
  ['pectoral', ['chest']],
  ['posture', ['neck', 'upperBack', 'chest']],
  ['desk', ['neck', 'upperBack', 'chest']],
  ['computer', ['neck', 'upperBack', 'chest']],
  ['office', ['neck', 'upperBack', 'chest']],
  // Shoulders
  ['shoulders', ['shoulders']],
  ['shoulder', ['shoulders']],
  ['delts', ['shoulders']],
  ['delt', ['shoulders']],
  ['rotator cuff', ['shoulders']],
  ['triceps', ['shoulders']],
  ['tricep', ['shoulders']],
  ['arms', ['shoulders']],
  ['arm', ['shoulders']],
  // Hips
  ['hips', ['hips']],
  ['hip', ['hips']],
  ['hip flexors', ['hips']],
  ['hip flexor', ['hips']],
  ['psoas', ['hips']],
  ['groin', ['hips']],
  ['adductors', ['hips']],
  ['adductor', ['hips']],
  ['inner thigh', ['hips']],
  ['inner thighs', ['hips']],
  ['sitting', ['hips', 'lowerBack', 'hamstrings']],
  // Glutes
  ['glutes', ['glutes']],
  ['glute', ['glutes']],
  ['butt', ['glutes']],
  ['bum', ['glutes']],
  ['buttocks', ['glutes']],
  ['piriformis', ['glutes']],
  // Hamstrings
  ['hamstrings', ['hamstrings']],
  ['hamstring', ['hamstrings']],
  ['hams', ['hamstrings']],
  ['hammies', ['hamstrings']],
  ['hammy', ['hamstrings']],
  ['hammys', ['hamstrings']],
  ...ofPhrases('back', BACK_OF),
  // Quads
  ['quads', ['quads']],
  ['quad', ['quads']],
  ['quadriceps', ['quads']],
  ...ofPhrases('front', FRONT_OF),
  ['thighs', ['quads', 'hamstrings']],
  ['thigh', ['quads', 'hamstrings']],
  ['legs', ['hamstrings', 'quads', 'calves']],
  ['leg', ['hamstrings', 'quads', 'calves']],
  // Calves
  ['calves', ['calves']],
  ['calf', ['calves']],
  ['calfs', ['calves']],
  ['achilles', ['calves']],
  ['ankles', ['calves']],
  ['ankle', ['calves']],
  ['shins', ['calves']],
  ['shin', ['calves']],
  ['feet', ['calves']],
  ['foot', ['calves']],
  // Wrists / forearms
  ['wrists', ['wristsForearms']],
  ['wrist', ['wristsForearms']],
  ['forearms', ['wristsForearms']],
  ['forearm', ['wristsForearms']],
  ['typing', ['wristsForearms']],
  ['mouse', ['wristsForearms']],
  ['grip', ['wristsForearms']],
  ['hands', ['wristsForearms']],
  ['hand', ['wristsForearms']],
];

/**
 * Everyday phrases that contain an area word but are not about the body.
 * Blanked before matching. Kept to verb + "back" and fixed expressions so
 * real requests ("stretch my back") are untouched.
 */
const IDIOMS: readonly string[] = [
  ...[
    'come',
    'comes',
    'came',
    'coming',
    'get',
    'gets',
    'got',
    'getting',
    'go',
    'goes',
    'going',
    'went',
    'lean',
    'leans',
    'leaning',
    'leaned',
    'lay',
    'laid',
    'sit',
    'sat',
    'step',
    'stepped',
    'look',
    'be',
    'bring',
    'call',
    'give',
    'hold',
    'holding',
    'held',
  ].map((v) => `${v} back`),
  'setback',
  'back later',
  'back into it',
  'back on track',
  'back then',
  'way back',
  'back and forth',
  'back to back',
  'head out',
  'head home',
  'heads up',
  'head start',
  'hip hop',
  'trap bar',
  'speed trap',
  'off the back foot',
  'on the back foot',
  'give me a hand',
  'on hand',
  'by hand',
  'hand in',
  'first hand',
  'second hand',
  'break a leg',
];

/** Words that start an exclusion (single and multi word, normalised). */
const NEGATIONS: readonly string[] = [
  'not',
  'no',
  'nothing for',
  'avoid',
  'avoiding',
  'skip',
  'skipping',
  'except',
  'except for',
  'excluding',
  'exclude',
  'without',
  'minus',
  'never',
  'other than',
  'apart from',
  'aside from',
  'leave out',
  'instead of',
  'rather than',
  'dont',
  'stay away from',
];

const byLength = (a: string, b: string) =>
  b.split(' ').length - a.split(' ').length || b.length - a.length;

/** Phrases sorted longest first (by word count, then characters). */
const ORDERED = [...SYNONYMS].sort((a, b) => byLength(a[0], b[0]));
const IDIOMS_ORDERED = [...IDIOMS].sort(byLength);
const NEGATIONS_ORDERED = [...NEGATIONS].sort(byLength);

/** Lower-case and collapse every non-alphanumeric run to a single space. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Expand "upper and lower back" style shorthand. Input is normalised. */
function expandPairs(s: string): string {
  return s.replace(
    /\b(upper|lower|low|mid|middle)( and| or|)( my| the|) (upper|lower|low|mid|middle) (back|spine|body)\b/g,
    (_m, a: string, _and: string, _det: string, b: string, noun: string) =>
      `${a} ${noun} ${b} ${noun}`,
  );
}

/** Blank `phrase` (whole words) out of the padded text. */
function blank(padded: string, phrase: string): { text: string; hit: boolean } {
  const needle = ` ${phrase} `;
  if (!padded.includes(needle)) return { text: padded, hit: false };
  // Keep the separating spaces so neighbours stay whole words.
  let text = padded;
  while (text.includes(needle)) text = text.split(needle).join('  ');
  return { text, hit: true };
}

/** Areas (and the whole-body marker) named in a normalised fragment. */
function scan(fragment: string): Set<Hit> {
  let padded = ` ${fragment} `;
  for (const idiom of IDIOMS_ORDERED) padded = blank(padded, idiom).text;
  const found = new Set<Hit>();
  for (const [phrase, hits] of ORDERED) {
    const r = blank(padded, phrase);
    if (!r.hit) continue;
    padded = r.text;
    for (const h of hits) found.add(h);
  }
  return found;
}

/** Split a normalised clause at its first negation word: [positive, negated]. */
function splitNegation(clause: string): [string, string] {
  const padded = ` ${clause} `;
  let at = -1;
  let len = 0;
  for (const neg of NEGATIONS_ORDERED) {
    const i = padded.indexOf(` ${neg} `);
    if (i >= 0 && (at < 0 || i < at || (i === at && neg.length > len))) {
      at = i;
      len = neg.length;
    }
  }
  if (at < 0) return [clause, ''];
  return [padded.slice(0, at), padded.slice(at + len + 2)];
}

export interface ParsedAreas {
  /** What {@link matchAreas} returns. */
  areas: BodyArea[];
  /** Areas the text explicitly excluded (canonical order). */
  excluded: BodyArea[];
  /** The text asked for the whole body ("full body", "everything", ...). */
  fullBody: boolean;
}

/** {@link matchAreas} plus what was excluded and whether "full body" was asked. */
export function parseAreas(text: string): ParsedAreas {
  const raw = (typeof text === 'string' ? text : '')
    .toLowerCase()
    .replace(/n['’]t\b/g, ' not')
    .replace(/[&/+]/g, ' and ');
  const pos = new Set<Hit>();
  const neg = new Set<Hit>();
  // Negation scope ends at punctuation, then at "and" / "but" / "or".
  for (const chunk of raw.split(/[,;.!?:()\n]+/)) {
    let norm = expandPairs(normalizeText(chunk));
    // "everything but X" means "except X".
    norm = norm.replace(
      /\b(everything|all|anything|full body|whole body|entire body) but\b/g,
      '$1 except',
    );
    // "but not X" is just "not X" in its own clause.
    for (const clause of norm.split(/\b(?:and|but|or|plus|also|then)\b/)) {
      const [p, n] = splitNegation(clause.trim());
      for (const h of scan(p.trim())) pos.add(h);
      for (const h of scan(n.trim())) neg.add(h);
    }
  }
  const excluded = BODY_AREAS.filter((a) => neg.has(a));
  const fullBody = pos.has(FULL);
  const named = BODY_AREAS.filter((a) => pos.has(a));
  let areas: BodyArea[];
  if (excluded.length > 0 && (fullBody || named.length === 0)) {
    areas = BODY_AREAS.filter((a) => !neg.has(a));
  } else if (fullBody) {
    areas = [];
  } else {
    areas = named.filter((a) => !neg.has(a));
  }
  return { areas, excluded, fullBody };
}

/**
 * Map free text ("stiff neck, low back and hammies") to body areas, returned
 * in canonical BODY_AREAS order with no duplicates. Returns [] when nothing
 * is recognised, and also for "full body" / "everything" (both mean a
 * well-rounded routine). See the module doc for exclusions.
 */
export function matchAreas(text: string): BodyArea[] {
  return parseAreas(text).areas;
}
