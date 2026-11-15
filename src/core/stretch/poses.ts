import { buildPose, type LimbSpec, type Pose, type PoseSpec, type Prop } from './pose.ts';

/**
 * Illustration data: one pose per stretch, keyed by the stretch's `pose`.
 * Authored as {@link PoseSpec}s (see pose.ts for the angle convention:
 * 0 = up, 90 = right, 180 = down, 270 = left) and resolved once at load.
 *
 * Side views face right; the figure's LEFT limbs are the near (bright) side,
 * and a bilateral stretch's illustration shows the LEFT side being stretched
 * (the player mirrors it for the right side).
 */

// --- Shared building blocks ------------------------------------------------

/** Standing pelvis height: feet land on the floor with straight legs. */
const STAND_HIP_Y = 80;
const straightLegs = {
  ll: { a: [182, 179] } as LimbSpec,
  rl: { a: [177, 181] } as LimbSpec,
};
const hangingFar: LimbSpec = { a: [184, 178] };

/** Side-view chair sitter: thighs level on the seat, shins down to the floor. */
const SEAT_HIP: readonly [number, number] = [70, 116];
const seatedLegs = {
  ll: { a: [90, 180] } as LimbSpec,
  rl: { a: [87, 178] } as LimbSpec,
};
const chair = (x = 56): Prop => ({ kind: 'chair', x, seatY: 124 });
/** Hands resting on the thighs (side seated). */
const handsOnThighs = {
  la: { to: { ref: 'lKnee', dx: -8, dy: -6 }, bend: -1 } as LimbSpec,
  ra: { to: { ref: 'rKnee', dx: -12, dy: -6 }, bend: -1 } as LimbSpec,
};

/** Front-view chair sitter: thighs point at the viewer, so they are foreshortened. */
const FRONT_SEAT_HIP: readonly [number, number] = [100, 104];
const frontSeatedLegs = {
  ll: { a: [160, 180], fs: [0.35, 1] } as LimbSpec,
  rl: { a: [200, 180], fs: [0.35, 1] } as LimbSpec,
};
const frontChair: Prop = { kind: 'chairFront', x: 100, seatY: 110 };

/** Hands-and-knees: knees and shins on the floor, thighs vertical. */
const QUAD_HIP: readonly [number, number] = [70, 110];
const quadLegs = {
  ll: { a: [180, 270] } as LimbSpec,
  rl: { a: [176, 270] } as LimbSpec,
};

/** Lying on the back, side view, head to the left. */
const SUPINE_HIP: readonly [number, number] = [120, 140];
const supineStraightFar: LimbSpec = { a: [90, 90] };

/** Lying face down, side view, head to the right. */
const PRONE_HIP: readonly [number, number] = [78, 141];
const proneLegs = {
  ll: { a: [270, 270] } as LimbSpec,
  rl: { a: [268, 271] } as LimbSpec,
};

// --- Specs -----------------------------------------------------------------

const SPECS: Record<string, PoseSpec> = {
  // Neck --------------------------------------------------------------------
  'chin-tuck': {
    hip: SEAT_HIP,
    torso: 0,
    head: -7,
    face: 90,
    ...seatedLegs,
    ...handsOnThighs,
    props: [chair()],
    arrows: [{ from: [112, 49], to: [94, 49] }],
    hl: ['neck'],
  },
  'upper-trap': {
    view: 'front',
    hip: FRONT_SEAT_HIP,
    torso: 0,
    head: 32,
    ...frontSeatedLegs,
    la: { to: { ref: 'head', dx: -3, dy: -9 }, bend: -1 },
    ra: { a: [186, 180] },
    props: [frontChair],
    arrows: [{ from: [94, 18], to: [118, 26], bend: -8 }],
    hl: ['neck'],
  },
  'levator-scap': {
    view: 'front',
    hip: FRONT_SEAT_HIP,
    torso: 0,
    head: 40,
    face: 150,
    ...frontSeatedLegs,
    la: { to: { ref: 'head', dx: -6, dy: -8 }, bend: -1 },
    ra: { a: [186, 180] },
    props: [frontChair],
    arrows: [{ from: [96, 20], to: [120, 34], bend: -8 }],
    hl: ['neck'],
  },
  'neck-rotation': {
    view: 'front',
    hip: FRONT_SEAT_HIP,
    torso: 0,
    head: 0,
    face: 90,
    ...frontSeatedLegs,
    la: { to: { ref: 'lKnee', dx: 2, dy: -6 }, bend: -1 },
    ra: { to: { ref: 'rKnee', dx: -2, dy: -6 }, bend: 1 },
    props: [frontChair],
    arrows: [{ from: [86, 24], to: [116, 24], bend: 10 }],
    hl: ['neck'],
  },
  scalene: {
    view: 'front',
    hip: FRONT_SEAT_HIP,
    torso: 0,
    head: -24,
    face: null,
    ...frontSeatedLegs,
    la: { to: { ref: 'neck', dx: 6, dy: 8 }, bend: 1 },
    ra: { a: [184, 180] },
    props: [frontChair],
    arrows: [{ from: [100, 22], to: [80, 22], bend: 8 }],
    hl: ['neck'],
  },
  'neck-flexion': {
    hip: SEAT_HIP,
    torso: 0,
    head: 62,
    ...seatedLegs,
    ...handsOnThighs,
    props: [chair()],
    arrows: [{ from: [92, 34], to: [100, 50], bend: -6 }],
    hl: ['neck'],
  },

  // Upper back ---------------------------------------------------------------
  'thread-needle': {
    hip: QUAD_HIP,
    torso: [80, 110],
    head: 160,
    face: 220,
    ...quadLegs,
    la: { to: [86, 146], bend: 1 },
    ra: { to: [122, 146], bend: -1 },
    arrows: [{ from: [84, 88], to: [112, 96], bend: 10 }],
    hl: ['upperTorso'],
  },
  'cat-cow': {
    hip: QUAD_HIP,
    torso: [50, 96],
    head: 165,
    ...quadLegs,
    la: { to: [108, 146], bend: -1 },
    ra: { to: [112, 146], bend: -1 },
    arrows: [{ from: [90, 84], to: [90, 68] }],
    hl: ['upperTorso', 'lowerTorso'],
  },
  'open-book': {
    hip: [130, 90],
    torso: 270,
    face: 180,
    ll: { a: [2, 90] },
    rl: { a: [6, 94] },
    la: { a: [180, 180] },
    ra: { a: [4, 2] },
    arrows: [{ from: [100, 40], to: [100, 140], bend: -34 }],
    hl: ['upperTorso', 'lUpperArm'],
    floor: false,
    props: [{ kind: 'mat' }],
  },
  'thoracic-ext-chair': {
    hip: SEAT_HIP,
    torso: [0, -28],
    head: -10,
    face: 88,
    ...seatedLegs,
    la: { to: { ref: 'head', dx: -7, dy: -2 }, bend: -1 },
    ra: { to: { ref: 'head', dx: -8, dy: 0 }, bend: -1 },
    props: [chair(62)],
    arrows: [{ from: [84, 70], to: [70, 40], bend: 10 }],
    hl: ['upperTorso'],
  },
  'puppy-pose': {
    hip: QUAD_HIP,
    torso: [112, 116],
    head: 120,
    ...quadLegs,
    la: { to: [155, 147], bend: 1 },
    ra: { to: [153, 146], bend: 1 },
    arrows: [{ from: [104, 108], to: [104, 122] }],
    hl: ['upperTorso'],
  },
  'upper-back-reach': {
    hip: [92, STAND_HIP_Y],
    torso: [2, 24],
    head: 40,
    ...straightLegs,
    la: { a: [96, 92] },
    ra: { a: [94, 90] },
    arrows: [{ from: [96, 44], to: [84, 36], bend: 4 }],
    hl: ['upperTorso'],
  },
  'seated-side-bend': {
    view: 'front',
    hip: FRONT_SEAT_HIP,
    torso: [-6, -22],
    head: -26,
    ...frontSeatedLegs,
    la: { a: [-20, -62] },
    ra: { a: [192, 182] },
    props: [frontChair],
    arrows: [{ from: [118, 6], to: [62, 26], bend: 10 }],
    hl: ['lowerTorso', 'upperTorso'],
  },

  // Lower back -----------------------------------------------------------------
  'child-pose': {
    hip: [80, 126],
    torso: 100,
    head: 105,
    ll: { a: [123.7, 270] },
    rl: { a: [121, 270] },
    la: { to: [170, 146], bend: 1 },
    ra: { to: [168, 145], bend: 1 },
    hl: ['lowerTorso'],
  },
  'knee-to-chest': {
    hip: SUPINE_HIP,
    torso: 270,
    ll: { a: [335, 115] },
    rl: supineStraightFar,
    la: { to: { ref: 'lKnee', dx: 4, dy: 8 }, bend: 1 },
    ra: { to: { ref: 'lKnee', dx: 6, dy: 10 }, bend: 1 },
    hl: ['lowerTorso', 'lThigh'],
  },
  'double-knee-chest': {
    hip: SUPINE_HIP,
    torso: 270,
    ll: { a: [335, 115] },
    rl: { a: [330, 112] },
    la: { to: { ref: 'lKnee', dx: 4, dy: 8 }, bend: 1 },
    ra: { to: { ref: 'rKnee', dx: 4, dy: 8 }, bend: 1 },
    hl: ['lowerTorso'],
  },
  'supine-twist': {
    view: 'top',
    hip: [125, 80],
    torso: 270,
    face: 180,
    ll: { a: [15, 100] },
    rl: { a: [25, 105] },
    la: { a: [0, 0] },
    ra: { a: [180, 180] },
    arrows: [{ from: [158, 104], to: [158, 66], bend: -12 }],
    hl: ['lowerTorso'],
    floor: false,
    props: [{ kind: 'mat' }],
  },
  sphinx: {
    hip: PRONE_HIP,
    torso: [72, 58],
    head: 74,
    face: 110,
    ...proneLegs,
    la: { a: [180, 90] },
    ra: { a: [178, 92] },
    hl: ['lowerTorso'],
  },
  cobra: {
    hip: PRONE_HIP,
    torso: [64, 44],
    head: 36,
    face: 108,
    ...proneLegs,
    la: { to: [114, 147], bend: -1 },
    ra: { to: [118, 147], bend: -1 },
    hl: ['lowerTorso'],
  },

  // Chest / shoulders ------------------------------------------------------------
  'doorway-pec': {
    hip: [104, STAND_HIP_Y],
    torso: 6,
    ll: { a: [190, 180] },
    rl: { a: [166, 182] },
    la: { a: [268, 0] },
    ra: hangingFar,
    props: [{ kind: 'doorway', x: 76 }],
    arrows: [{ from: [122, 46], to: [140, 46] }],
    hl: ['lUpperArm', 'upperTorso'],
  },
  'wall-pec': {
    hip: [104, STAND_HIP_Y],
    torso: 2,
    ...straightLegs,
    la: { a: [266, 268] },
    ra: hangingFar,
    props: [{ kind: 'wall', x: 52 }],
    arrows: [{ from: [118, 50], to: [132, 44], bend: 4 }],
    hl: ['lUpperArm', 'upperTorso'],
  },
  'clasped-chest-opener': {
    hip: [100, STAND_HIP_Y],
    torso: [0, -6],
    head: -6,
    ...straightLegs,
    la: { a: [204, 214] },
    ra: { a: [206, 216] },
    arrows: [{ from: [80, 96], to: [70, 106] }],
    hl: ['upperTorso'],
  },
  'floor-goalpost': {
    view: 'top',
    hip: [125, 80],
    torso: 270,
    ll: { a: [92, 90] },
    rl: { a: [88, 90] },
    la: { a: [0, 270] },
    ra: { a: [180, 270] },
    hl: ['upperTorso'],
    floor: false,
    props: [{ kind: 'mat' }],
  },
  'cross-body-shoulder': {
    view: 'front',
    hip: [100, STAND_HIP_Y],
    torso: 0,
    ll: { a: [180, 180] },
    rl: { a: [180, 180] },
    la: { a: [262, 270] },
    ra: { to: { ref: 'lElbow', dx: 2, dy: 2 }, bend: 1 },
    hl: ['lUpperArm'],
  },
  'overhead-triceps': {
    view: 'front',
    hip: [100, STAND_HIP_Y],
    torso: 0,
    ll: { a: [180, 180] },
    rl: { a: [180, 180] },
    la: { a: [-12, 200] },
    ra: { to: { ref: 'lElbow', dx: -3, dy: 1 }, bend: 1 },
    hl: ['lUpperArm'],
  },

  // Hips / glutes ----------------------------------------------------------------
  'hip-flexor-lunge': {
    hip: [92, 112],
    torso: -2,
    ll: { a: [202, 270] },
    rl: { a: [90, 180] },
    la: { to: { ref: 'rKnee', dx: -8, dy: -7 }, bend: -1 },
    ra: { to: { ref: 'rKnee', dx: -5, dy: -9 }, bend: -1 },
    arrows: [{ from: [80, 96], to: [98, 96] }],
    hl: ['lThigh'],
  },
  'ninety-ninety': {
    view: 'front',
    hip: [100, 128],
    torso: 8,
    head: 4,
    ll: { a: [125, 268], fs: [0.55, 1] },
    rl: { a: [246, 110], fs: [1, 0.4] },
    la: { to: { ref: 'lKnee', dx: -6, dy: -10 }, bend: -1 },
    ra: { to: { ref: 'rHip', dx: -8, dy: 2 }, bend: 1 },
    hl: ['lThigh'],
  },
  butterfly: {
    view: 'front',
    hip: [100, 132],
    torso: 0,
    ll: { a: [112, 270] },
    rl: { a: [248, 90] },
    la: { to: { ref: 'lFoot', dx: 0, dy: -9 }, bend: -1 },
    ra: { to: { ref: 'rFoot', dx: 0, dy: -9 }, bend: 1 },
    hl: ['lThigh', 'rThigh'],
  },
  'figure-four-supine': {
    hip: SUPINE_HIP,
    torso: 270,
    rl: { a: [340, 100] },
    ll: { to: { ref: 'rKnee', dx: -2, dy: -3 }, bend: -1, fs: [0.65, 1] },
    la: { to: { ref: 'rKnee', dx: 4, dy: 10 }, bend: 1 },
    ra: { to: { ref: 'rKnee', dx: 6, dy: 12 }, bend: 1 },
    hl: ['lThigh'],
  },
  'figure-four-seated': {
    hip: SEAT_HIP,
    torso: 22,
    head: 34,
    rl: { a: [88, 180] },
    ll: { to: { ref: 'rKnee', dx: -2, dy: -7 }, bend: 1, fs: [0.6, 1] },
    la: { to: { ref: 'lKnee', dx: 2, dy: -2 }, bend: -1 },
    ra: { to: { ref: 'lFoot', dx: -4, dy: -2 }, bend: -1 },
    props: [chair()],
    hl: ['lThigh'],
  },
  'happy-baby': {
    hip: [124, 140],
    torso: 270,
    ll: { a: [295, 0] },
    rl: { a: [300, 4] },
    la: { to: { ref: 'lFoot', dx: 0, dy: 5 }, bend: 1 },
    ra: { to: { ref: 'rFoot', dx: 0, dy: 5 }, bend: 1 },
    hl: ['lThigh', 'rThigh'],
  },

  // Hamstrings ---------------------------------------------------------------------
  'standing-hamstring': {
    hip: [92, 89],
    torso: 50,
    head: 66,
    ll: { a: [150, 150] },
    rl: { to: [84, 150], bend: 1 },
    la: { to: { ref: 'lKnee', dx: -12, dy: -19 }, bend: -1 },
    ra: { to: { ref: 'lKnee', dx: -14, dy: -20 }, bend: -1 },
    hl: ['lThigh'],
  },
  'seated-hamstring': {
    hip: [60, 140],
    torso: [56, 66],
    head: 76,
    ll: { a: [90, 90] },
    rl: { a: [100, 262], fs: [0.5, 0.5] },
    la: { to: { ref: 'lFoot', dx: -16, dy: -4 }, bend: 1 },
    ra: { to: { ref: 'lFoot', dx: -20, dy: -2 }, bend: 1 },
    hl: ['lThigh'],
  },
  'supine-hamstring': {
    hip: SUPINE_HIP,
    torso: 270,
    ll: { a: [356, 356] },
    rl: supineStraightFar,
    la: { to: { ref: 'lKnee', dx: -3, dy: 4 }, bend: 1 },
    ra: { to: { ref: 'lKnee', dx: -2, dy: 8 }, bend: 1 },
    hl: ['lThigh'],
  },
  'forward-fold': {
    hip: [90, 82],
    torso: [130, 155],
    head: 165,
    ll: { to: [98, 150], bend: 1 },
    rl: { to: [96, 150], bend: 1 },
    la: { to: [118, 146], bend: -1 },
    ra: { to: [114, 146], bend: -1 },
    hl: ['lThigh', 'lowerTorso'],
  },
  'downward-dog': {
    hip: [88, 86],
    torso: 125,
    head: 150,
    ll: { to: [53, 146], bend: 1 },
    rl: { to: [56, 147], bend: 1 },
    la: { to: [150, 147], bend: -1 },
    ra: { to: [154, 147], bend: -1 },
    arrows: [{ from: [80, 70], to: [70, 58] }],
    hl: ['lThigh', 'lShin'],
  },
  'chair-hamstring': {
    hip: [74, 116],
    torso: 34,
    head: 48,
    ll: { to: [134, 150], bend: 1 },
    rl: { a: [87, 178] },
    la: { to: { ref: 'lKnee', dx: -4, dy: -5 }, bend: -1 },
    ra: { to: { ref: 'lKnee', dx: -8, dy: -4 }, bend: -1 },
    props: [chair(60)],
    hl: ['lThigh'],
  },

  // Quads ------------------------------------------------------------------------
  'standing-quad': {
    hip: [99, STAND_HIP_Y],
    torso: 2,
    ll: { a: [194, 350] },
    rl: { a: [180, 180] },
    la: { to: { ref: 'lFoot', dx: 0, dy: 1 }, bend: -1 },
    ra: { to: [146, 54], bend: 1 },
    props: [{ kind: 'wall', x: 148 }],
    hl: ['lThigh'],
  },
  'side-lying-quad': {
    hip: [125, 80],
    torso: 270,
    face: 0,
    ll: { a: [96, 254] },
    rl: { a: [90, 90] },
    la: { to: { ref: 'lFoot', dx: 0, dy: 1 }, bend: -1 },
    ra: { a: [270, 270] },
    hl: ['lThigh'],
    floor: false,
    props: [{ kind: 'mat' }],
  },

  // Calves -------------------------------------------------------------------------
  'wall-calf': {
    hip: [104, 90],
    torso: 20,
    ll: { to: [69, 150], bend: 1 },
    rl: { to: [120, 150], bend: 1 },
    la: { to: [156, 58], bend: -1 },
    ra: { to: [156, 62], bend: -1 },
    props: [{ kind: 'wall', x: 158 }],
    hl: ['lShin'],
  },
  'soleus-calf': {
    hip: [100, 96],
    torso: 14,
    ll: { to: [74, 150], bend: 1 },
    rl: { to: [120, 150], bend: 1 },
    la: { to: [156, 64], bend: -1 },
    ra: { to: [156, 68], bend: -1 },
    props: [{ kind: 'wall', x: 158 }],
    hl: ['lShin'],
  },

  // Wrists ---------------------------------------------------------------------------
  'wrist-flexor': {
    hip: SEAT_HIP,
    torso: 0,
    ...seatedLegs,
    la: { a: [90, 90], fs: [0.9, 0.9] },
    ra: { to: { ref: 'lHand', dx: 1, dy: -6 }, bend: -1 },
    fingers: { l: 0 },
    props: [chair()],
    arrows: [{ from: [127, 54], to: [119, 44], bend: -4 }],
    hl: ['lForearm'],
  },
  'wrist-extensor': {
    hip: SEAT_HIP,
    torso: 0,
    ...seatedLegs,
    la: { a: [90, 90], fs: [0.9, 0.9] },
    ra: { to: { ref: 'lHand', dx: 2, dy: 6 }, bend: -1 },
    fingers: { l: 180 },
    props: [chair()],
    arrows: [{ from: [127, 90], to: [119, 100], bend: 4 }],
    hl: ['lForearm'],
  },
  'prayer-stretch': {
    view: 'front',
    hip: [100, STAND_HIP_Y],
    torso: 0,
    ll: { a: [180, 180] },
    rl: { a: [180, 180] },
    la: { to: [101, 56], bend: -1 },
    ra: { to: [99, 56], bend: 1 },
    fingers: { l: 0, r: 0 },
    arrows: [{ from: [112, 40], to: [112, 60] }],
    hl: ['lForearm', 'rForearm'],
  },
};

/** Every resolved pose, keyed by pose id. */
export const POSES: Readonly<Record<string, Pose>> = Object.fromEntries(
  Object.entries(SPECS).map(([id, spec]) => [id, buildPose(spec)]),
);

/** The raw authored specs (exposed for tests). */
export const POSE_SPECS: Readonly<Record<string, PoseSpec>> = SPECS;
