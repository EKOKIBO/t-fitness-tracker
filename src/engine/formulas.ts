import type {
  Client,
  Exercise,
  MovementCategory,
  MuscleGroup,
  Sex,
  Workout,
} from '../types/models';

/**
 * 3.1 Hybrid Estimated One-Rep Max (e1RM)
 * Piecewise continuous model:
 *  - 1..10 reps: Brzycki curve W * 36 / (37 - r)
 *  - 11..30 reps: Empirical decay W / (0.75 - 0.0125 * (r - 10))
 *  - >30 reps: W / 0.50
 * Continuous at r = 10: 36/27 = 4/3 === 1/0.75.
 */
export function calculateHybridE1RM(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || weightKg <= 0 || reps <= 0) {
    return 0;
  }
  const r = Math.max(1, reps);
  let e1rm: number;
  if (r <= 10) {
    e1rm = weightKg * (36 / (37 - r));
  } else if (r <= 30) {
    e1rm = weightKg / (0.75 - 0.0125 * (r - 10));
  } else {
    e1rm = weightKg / 0.5;
  }
  return Math.round(e1rm * 10) / 10;
}

/**
 * 3.2 Bodyweight Normalization (DOTS Coefficient)
 * Exact sex-specific 4th-degree polynomial DOTS constants.
 */
const DOTS_CONSTANTS: Record<Sex, { A: number; C: number; D: number; E: number; F: number }> = {
  male: {
    A: -0.000001093,
    C: 0.0007391293,
    D: -0.1918759221,
    E: 24.0900756,
    F: -307.75076,
  },
  female: {
    A: -0.0000010706,
    C: 0.0005158568,
    D: -0.1126655495,
    E: 13.6175032,
    F: -57.96288,
  },
};

export function calculateDots(liftKg: number, bodyweightKg: number, sex: Sex): number {
  if (liftKg <= 0 || bodyweightKg <= 0) return 0;
  // Clamp bodyweight to valid DOTS polynomial domain (40kg - 210kg)
  const B = Math.min(210, Math.max(40, bodyweightKg));
  const { A, C, D, E, F } = DOTS_CONSTANTS[sex];
  const denom = A * B ** 4 + C * B ** 3 + D * B ** 2 + E * B + F;
  if (denom <= 0) return 0;
  return (500 * liftKg) / denom;
}

/**
 * IPF Masters / Teen Age Adjustment Factor (k_age)
 * 1.00 for prime ages 23-39, scaling upward for teens and 40+.
 */
export function getAgeAdjustmentFactor(age: number): number {
  const a = Math.round(age);
  if (a >= 23 && a <= 39) return 1.0;
  if (a < 23) {
    // Sub-junior / Junior scaling (approx 1.00 at 23 -> 1.18 at 14)
    const clamped = Math.max(14, a);
    return Math.round((1 + (23 - clamped) * 0.02) * 1000) / 1000;
  }
  // Masters scaling (40+: progressive curve matching IPF Masters coefficient trends)
  const yearsOver = Math.min(45, a - 39);
  const factor = 1 + yearsOver * 0.009 + yearsOver * yearsOver * 0.00045;
  return Math.round(factor * 1000) / 1000;
}

/**
 * Category-specific Elite (score=100) single-lift DOTS benchmarks.
 * Derived from IPF/competitive population percentiles per movement pattern:
 *  - Squat: ~190 DOTS (~2.6x BW squat for 80kg male) -> Super Elite 95-100
 *  - Hinge (Deadlift): ~225 DOTS
 *  - Horizontal Push (Bench): ~140 DOTS
 *  - Vertical Push (OHP): ~92 DOTS
 *  - Pull (Weighted Pull-Up / Barbell Row): ~118 DOTS
 */
const CATEGORY_MAX_DOTS: Record<MovementCategory, number> = {
  squat: 190,
  hinge: 225,
  horizontal_push: 140,
  vertical_push: 92,
  pull: 118,
};

export type StrengthTier =
  | 'Beginner'
  | 'Novice'
  | 'Intermediate'
  | 'Advanced'
  | 'Elite'
  | 'Super Elite';

export function getStrengthTier(score: number): StrengthTier {
  if (score < 25) return 'Beginner';
  if (score < 45) return 'Novice';
  if (score < 65) return 'Intermediate';
  if (score < 82) return 'Advanced';
  if (score < 95) return 'Elite';
  return 'Super Elite';
}

export interface CategoryStrengthResult {
  category: MovementCategory;
  score: number; // 0..100
  bestLiftName: string | null;
  bestE1rmKg: number;
  normalizedDots: number;
  tier: StrengthTier;
}

export interface CompositeStrengthSummary {
  strengthScore: number; // 0..100
  balanceIndex: number; // 0..100
  tier: StrengthTier;
  categories: Record<MovementCategory, CategoryStrengthResult>;
}

const ALL_CATEGORIES: MovementCategory[] = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'pull',
];

export function computeCompositeStrengthScore(
  client: Client,
  workouts: Workout[],
  exerciseMap: Map<string, Exercise>,
  rollingDays = 90,
  nowMs = Date.now()
): CompositeStrengthSummary {
  const cutoff = rollingDays > 0 ? nowMs - rollingDays * 86_400_000 : 0;
  const ageFactor = getAgeAdjustmentFactor(client.age);

  const bestByCategory: Record<
    MovementCategory,
    { e1rmKg: number; dots: number; liftName: string | null }
  > = {
    squat: { e1rmKg: 0, dots: 0, liftName: null },
    hinge: { e1rmKg: 0, dots: 0, liftName: null },
    horizontal_push: { e1rmKg: 0, dots: 0, liftName: null },
    vertical_push: { e1rmKg: 0, dots: 0, liftName: null },
    pull: { e1rmKg: 0, dots: 0, liftName: null },
  };

  for (const w of workouts) {
    if (w.status !== 'completed' || w.deletedAt) continue;
    const ts = w.finishedAt ?? w.startedAt;
    if (ts < cutoff) continue;

    for (const exEntry of w.exercises) {
      const ex = exerciseMap.get(exEntry.exerciseId);
      if (!ex) continue;
      const cat: MovementCategory | undefined =
        ex.canonicalCategory ??
        (ex.movementPattern !== 'isolation' && ex.movementPattern !== 'core'
          ? ex.movementPattern
          : undefined);
      if (!cat) continue;

      for (const s of exEntry.sets) {
        if (!s.completed || s.type === 'W' || !s.reps || s.reps <= 0) continue;
        // For bodyweight pull-ups / dips, include client bodyweight + added load
        const isBodyweightCompound = ex.equipment === 'Bodyweight';
        const effectiveWeight = isBodyweightCompound
          ? client.bodyweightKg + (s.weightKg ?? 0)
          : s.weightKg ?? 0;
        if (effectiveWeight <= 0) continue;

        const e1rm = calculateHybridE1RM(effectiveWeight, s.reps);
        // Slightly discount non-canonical variations (e.g. dumbbell vs barbell) if canonical lifts exist,
        // while still valuing strong non-canonical lifts if no barbell lift was logged.
        const variationWeight = ex.isCanonicalStrengthLift ? 1.0 : 0.92;
        const rawDots = calculateDots(e1rm * variationWeight, client.bodyweightKg, client.sex);
        const adjustedDots = rawDots * ageFactor;

        if (adjustedDots > bestByCategory[cat].dots) {
          bestByCategory[cat] = {
            e1rmKg: e1rm,
            dots: adjustedDots,
            liftName: ex.name,
          };
        }
      }
    }
  }

  const categories = {} as Record<MovementCategory, CategoryStrengthResult>;
  const scores: number[] = [];

  for (const cat of ALL_CATEGORIES) {
    const best = bestByCategory[cat];
    const score = Math.min(100, Math.round((best.dots / CATEGORY_MAX_DOTS[cat]) * 100 * 10) / 10);
    scores.push(score);
    categories[cat] = {
      category: cat,
      score,
      bestLiftName: best.liftName,
      bestE1rmKg: best.e1rmKg,
      normalizedDots: Math.round(best.dots * 10) / 10,
      tier: getStrengthTier(score),
    };
  }

  const mean = scores.reduce((acc, v) => acc + v, 0) / 5;
  const variance = scores.reduce((acc, v) => acc + (v - mean) ** 2, 0) / 5;
  const stdDev = Math.sqrt(variance);
  const balanceIndex =
    mean > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - stdDev / mean)))) : 0;

  const strengthScore = Math.round(mean * 10) / 10;

  return {
    strengthScore,
    balanceIndex,
    tier: getStrengthTier(strengthScore),
    categories,
  };
}

/**
 * 3.3 Fractional & Stimulus-Adjusted Effective Muscle Set Volume
 *  - Primary Mover: alpha = 1.0
 *  - Secondary Synergist: alpha = 0.5
 *  - Warm-Up (W): alpha = 0
 *  - Effective multiplier when RPE logged: clamp((RPE - 5.0) / 3.0, 0, 1)
 */
export function getRpeStimulusFactor(rpe: number | null | undefined): number {
  if (rpe == null || !Number.isFinite(rpe)) return 1.0;
  return Math.min(1.0, Math.max(0.0, (rpe - 5.0) / 3.0));
}

export interface MuscleVolumeEntry {
  rawSets: number;
  effectiveSets: number;
}

export type MuscleVolumeMap = Record<MuscleGroup, MuscleVolumeEntry>;

export function createEmptyMuscleVolumeMap(): MuscleVolumeMap {
  return {
    chest: { rawSets: 0, effectiveSets: 0 },
    front_delts: { rawSets: 0, effectiveSets: 0 },
    side_delts: { rawSets: 0, effectiveSets: 0 },
    rear_delts: { rawSets: 0, effectiveSets: 0 },
    lats: { rawSets: 0, effectiveSets: 0 },
    upper_back: { rawSets: 0, effectiveSets: 0 },
    traps: { rawSets: 0, effectiveSets: 0 },
    biceps: { rawSets: 0, effectiveSets: 0 },
    triceps: { rawSets: 0, effectiveSets: 0 },
    forearms: { rawSets: 0, effectiveSets: 0 },
    abs: { rawSets: 0, effectiveSets: 0 },
    lower_back: { rawSets: 0, effectiveSets: 0 },
    glutes: { rawSets: 0, effectiveSets: 0 },
    quads: { rawSets: 0, effectiveSets: 0 },
    hamstrings: { rawSets: 0, effectiveSets: 0 },
    calves: { rawSets: 0, effectiveSets: 0 },
  };
}

export function computeMuscleVolume(
  workouts: Workout[],
  exerciseMap: Map<string, Exercise>,
  includeIncomplete = false
): MuscleVolumeMap {
  const map = createEmptyMuscleVolumeMap();

  for (const w of workouts) {
    if (w.deletedAt) continue;
    for (const exEntry of w.exercises) {
      const ex = exerciseMap.get(exEntry.exerciseId);
      if (!ex) continue;

      for (const s of exEntry.sets) {
        if (!includeIncomplete && !s.completed) continue;
        if (s.type === 'W') continue;

        const rpeFactor = getRpeStimulusFactor(s.rpe);

        for (const m of ex.primaryMuscles) {
          map[m].rawSets += 1.0;
          map[m].effectiveSets += 1.0 * rpeFactor;
        }
        for (const m of ex.secondaryMuscles) {
          map[m].rawSets += 0.5;
          map[m].effectiveSets += 0.5 * rpeFactor;
        }
      }
    }
  }

  for (const key of Object.keys(map) as MuscleGroup[]) {
    map[key].rawSets = Math.round(map[key].rawSets * 10) / 10;
    map[key].effectiveSets = Math.round(map[key].effectiveSets * 10) / 10;
  }

  return map;
}

/**
 * 3.4 Warm-Up Set Generator
 * Given working target weight and empty bar mass, computes 40%, 60%, 80% rounded
 * to minIncrement with automatic deduplication & bar-floor enforcement.
 */
export interface WarmupSetPrescription {
  percent: number;
  weightKg: number;
  reps: number;
  label: string;
}

export function roundToIncrement(value: number, increment: number): number {
  if (increment <= 0) return value;
  return Math.round(value / increment) * increment;
}

export function generateWarmupRamp(
  workingWeightKg: number,
  barWeightKg = 20,
  minIncrementKg = 2.5
): WarmupSetPrescription[] {
  if (workingWeightKg <= barWeightKg) {
    return [
      {
        percent: 100,
        weightKg: barWeightKg,
        reps: 8,
        label: 'Empty Bar',
      },
    ];
  }

  const steps = [
    { percent: 40, reps: 8 },
    { percent: 60, reps: 5 },
    { percent: 80, reps: 2 },
  ];

  const results: WarmupSetPrescription[] = [];
  const seenWeights = new Set<number>();

  // Start with empty bar if working weight is meaningfully heavier
  if (workingWeightKg >= barWeightKg * 2) {
    results.push({
      percent: Math.round((barWeightKg / workingWeightKg) * 100),
      weightKg: barWeightKg,
      reps: 10,
      label: 'Empty Bar',
    });
    seenWeights.add(barWeightKg);
  }

  for (const step of steps) {
    const raw = (step.percent / 100) * workingWeightKg;
    const rounded = roundToIncrement(raw, minIncrementKg);
    if (rounded < barWeightKg) continue;
    if (rounded >= workingWeightKg) continue;
    if (seenWeights.has(rounded)) continue;

    seenWeights.add(rounded);
    results.push({
      percent: step.percent,
      weightKg: rounded,
      reps: step.reps,
      label: `${step.percent}%`,
    });
  }

  return results;
}

/**
 * 3.4 Greedy Barbell Plate-Loading Solver
 * IPF Competition Colors: Red 25kg, Blue 20kg, Yellow 15kg, Green 10kg, White 5kg, Black 2.5kg, Silver 1.25kg
 */
export interface PlateSlot {
  weightKg: number;
  countPerSide: number;
  color: string;
  heightPct: number;
}

export interface PlateLoadSolution {
  targetWeightKg: number;
  achievedWeightKg: number;
  barWeightKg: number;
  perSideWeightKg: number;
  remainderPerSideKg: number;
  platesPerSide: PlateSlot[];
}

export const DEFAULT_PLATE_INVENTORY_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

export function getIpfPlateVisual(weightKg: number): { color: string; heightPct: number } {
  if (weightKg >= 25) return { color: '#DC2626', heightPct: 100 }; // Red
  if (weightKg >= 20) return { color: '#2563EB', heightPct: 96 }; // Blue
  if (weightKg >= 15) return { color: '#EAB308', heightPct: 86 }; // Yellow
  if (weightKg >= 10) return { color: '#16A34A', heightPct: 76 }; // Green
  if (weightKg >= 5) return { color: '#E5E7EB', heightPct: 62 }; // White
  if (weightKg >= 2.5) return { color: '#3F3F46', heightPct: 50 }; // Dark / Black
  return { color: '#9CA3AF', heightPct: 40 }; // Silver 1.25 / micro
}

export function solveGreedyBarbellPlates(
  targetWeightKg: number,
  barWeightKg = 20,
  plateInventoryKg: number[] = DEFAULT_PLATE_INVENTORY_KG
): PlateLoadSolution {
  const sortedPlates = [...plateInventoryKg].filter((p) => p > 0).sort((a, b) => b - a);
  if (targetWeightKg <= barWeightKg) {
    return {
      targetWeightKg,
      achievedWeightKg: barWeightKg,
      barWeightKg,
      perSideWeightKg: 0,
      remainderPerSideKg: 0,
      platesPerSide: [],
    };
  }

  const perSideTarget = (targetWeightKg - barWeightKg) / 2;
  let remaining = Math.round(perSideTarget * 1000) / 1000;
  const platesPerSide: PlateSlot[] = [];

  for (const plate of sortedPlates) {
    const count = Math.floor((remaining + 1e-6) / plate);
    if (count > 0) {
      const visual = getIpfPlateVisual(plate);
      platesPerSide.push({
        weightKg: plate,
        countPerSide: count,
        color: visual.color,
        heightPct: visual.heightPct,
      });
      remaining = Math.round((remaining - count * plate) * 1000) / 1000;
    }
  }

  const loadedPerSide = platesPerSide.reduce((sum, p) => sum + p.weightKg * p.countPerSide, 0);
  const achievedWeightKg = Math.round((barWeightKg + loadedPerSide * 2) * 100) / 100;

  return {
    targetWeightKg,
    achievedWeightKg,
    barWeightKg,
    perSideWeightKg: Math.round(loadedPerSide * 100) / 100,
    remainderPerSideKg: Math.max(0, Math.round(remaining * 100) / 100),
    platesPerSide,
  };
}
