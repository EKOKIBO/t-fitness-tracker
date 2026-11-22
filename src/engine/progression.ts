import type {
  DoubleProgressionConfig,
  GzclpConfig,
  ProgressionConfig,
  RpeAutoregConfig,
  TmAmrapConfig,
  WorkoutSet,
} from '../types/models';
import { roundToIncrement } from './formulas';

export interface NextSessionPrescription {
  summaryBadge: string;
  rationale: string;
  sets: Array<{
    weightKg: number;
    reps: number;
    isAmrap?: boolean;
    targetRpe?: number;
  }>;
  updatedConfig: ProgressionConfig;
}

/**
 * Mode A: Deterministic Double Progression (Hypertrophy Default)
 * - Hold & Accumulate: while any working set < R_max (at or below RPE cap), keep W and nudge +1 rep up to R_max.
 * - Load Step-Up: once ALL S working sets >= R_max cleanly (<= rpeCap), step W += deltaW, reset target reps to R_min.
 */
export function evaluateDoubleProgression(
  config: DoubleProgressionConfig,
  lastWorkingSets: WorkoutSet[]
): NextSessionPrescription {
  const working = lastWorkingSets.filter((s) => s.completed && s.type !== 'W');
  const lastWeight =
    working.length > 0 ? Math.max(...working.map((s) => s.weightKg ?? 0)) : 0;

  if (working.length === 0 || lastWeight <= 0) {
    return {
      summaryBadge: `Double Prog · ${config.targetSets}×${config.minReps}–${config.maxReps}`,
      rationale: `Start at ${config.minReps} reps and accumulate to ${config.maxReps} across all ${config.targetSets} sets.`,
      sets: Array.from({ length: config.targetSets }, () => ({
        weightKg: lastWeight,
        reps: config.minReps,
        targetRpe: config.rpeCap,
      })),
      updatedConfig: config,
    };
  }

  const hasEnoughSets = working.length >= config.targetSets;
  const allHitMaxClean =
    hasEnoughSets &&
    working.slice(0, config.targetSets).every((s) => {
      const repsOk = (s.reps ?? 0) >= config.maxReps;
      const rpeOk = s.rpe == null || s.rpe <= config.rpeCap;
      return repsOk && rpeOk;
    });

  if (allHitMaxClean) {
    const nextWeight = Math.round((lastWeight + config.weightIncrementKg) * 100) / 100;
    return {
      summaryBadge: `Step-Up +${config.weightIncrementKg}kg → ${nextWeight}kg × ${config.minReps}`,
      rationale: `All ${config.targetSets} working sets reached ${config.maxReps} reps cleanly (≤ RPE ${config.rpeCap}). Increasing load by +${config.weightIncrementKg}kg and resetting to ${config.minReps} reps.`,
      sets: Array.from({ length: config.targetSets }, () => ({
        weightKg: nextWeight,
        reps: config.minReps,
        targetRpe: config.rpeCap,
      })),
      updatedConfig: config,
    };
  }

  // Hold & Accumulate: nudge each set +1 rep up to maxReps
  const nextSets = Array.from({ length: config.targetSets }, (_, idx) => {
    const prior = working[idx];
    const priorReps = prior?.reps ?? config.minReps;
    const targetReps = Math.min(config.maxReps, Math.max(config.minReps, priorReps + 1));
    return {
      weightKg: lastWeight,
      reps: targetReps,
      targetRpe: config.rpeCap,
    };
  });

  return {
    summaryBadge: `Hold ${lastWeight}kg · Push toward ${config.maxReps} reps`,
    rationale: `Holding ${lastWeight}kg and nudging +1 rep per set until all ${config.targetSets} sets hit ${config.maxReps} reps at ≤ RPE ${config.rpeCap}.`,
    sets: nextSets,
    updatedConfig: config,
  };
}

/**
 * Mode B: Percentage & Training Max (TM) with AMRAP Auto-Scaling (5/3/1 Wave)
 * Week 1: 65%×5, 75%×5, 85%×5+
 * Week 2: 70%×3, 80%×3, 90%×3+
 * Week 3: 75%×5, 85%×3, 95%×1+
 * Week 4 (Deload): 40%×5, 50%×5, 60%×5
 */
const TM_WAVES: Record<number, Array<{ pct: number; reps: number; isAmrap?: boolean }>> = {
  1: [
    { pct: 0.65, reps: 5 },
    { pct: 0.75, reps: 5 },
    { pct: 0.85, reps: 5, isAmrap: true },
  ],
  2: [
    { pct: 0.7, reps: 3 },
    { pct: 0.8, reps: 3 },
    { pct: 0.9, reps: 3, isAmrap: true },
  ],
  3: [
    { pct: 0.75, reps: 5 },
    { pct: 0.85, reps: 3 },
    { pct: 0.95, reps: 1, isAmrap: true },
  ],
  4: [
    { pct: 0.4, reps: 5 },
    { pct: 0.5, reps: 5 },
    { pct: 0.6, reps: 5 },
  ],
};

export function initTrainingMax(tested1rmKg: number): number {
  return roundToIncrement(0.9 * tested1rmKg, 2.5);
}

export function prescribeTmWave(
  config: TmAmrapConfig,
  incrementKg = 2.5
): NextSessionPrescription['sets'] {
  const wave = TM_WAVES[config.weekIndex] ?? TM_WAVES[1];
  return wave.map((w) => ({
    weightKg: roundToIncrement(config.trainingMaxKg * w.pct, incrementKg),
    reps: w.reps,
    isAmrap: w.isAmrap,
  }));
}

export function evaluateTmAmrap(
  config: TmAmrapConfig,
  lastWorkingSets: WorkoutSet[]
): NextSessionPrescription {
  const wave = TM_WAVES[config.weekIndex] ?? TM_WAVES[1];
  const amrapSpec = wave.find((w) => w.isAmrap);
  const working = lastWorkingSets.filter((s) => s.completed && s.type !== 'W');

  let nextTm = config.trainingMaxKg;
  let rationale = '';

  if (amrapSpec && working.length > 0) {
    const amrapLogged = working.find((s) => s.isAmrap) ?? working[working.length - 1];
    const actualReps = amrapLogged.reps ?? 0;
    const reqReps = amrapSpec.reps;

    if (actualReps < reqReps) {
      nextTm = roundToIncrement(config.trainingMaxKg * 0.9, 2.5);
      rationale = `AMRAP missed target (${actualReps}/${reqReps}). Stall reset applied: TM −10% → ${nextTm}kg.`;
    } else if (actualReps === reqReps) {
      nextTm = config.trainingMaxKg;
      rationale = `AMRAP matched minimum (${actualReps}/${reqReps}). Holding TM at ${nextTm}kg.`;
    } else if (actualReps <= reqReps + 2) {
      nextTm = roundToIncrement(config.trainingMaxKg + config.baseIncrementKg, 2.5);
      rationale = `AMRAP exceeded target (+${actualReps - reqReps} reps). Advancing TM +${config.baseIncrementKg}kg → ${nextTm}kg.`;
    } else {
      nextTm = roundToIncrement(config.trainingMaxKg + 2 * config.baseIncrementKg, 2.5);
      rationale = `Strong AMRAP (+${actualReps - reqReps} reps)! Fast-tracking TM +${2 * config.baseIncrementKg}kg → ${nextTm}kg.`;
    }
  } else {
    rationale = `Week ${config.weekIndex} wave prescribed from TM ${config.trainingMaxKg}kg.`;
  }

  const nextWeek = config.weekIndex >= 4 ? 1 : config.weekIndex + 1;
  const updatedConfig: TmAmrapConfig = {
    ...config,
    trainingMaxKg: nextTm,
    weekIndex: working.length > 0 ? nextWeek : config.weekIndex,
  };

  const sets = prescribeTmWave(updatedConfig);
  const topSet = sets[sets.length - 1];

  return {
    summaryBadge: `TM ${updatedConfig.trainingMaxKg}kg · Wk ${updatedConfig.weekIndex} (${topSet.weightKg}kg × ${topSet.reps}${topSet.isAmrap ? '+' : ''})`,
    rationale,
    sets,
    updatedConfig,
  };
}

/**
 * Mode C: Linear Failure-Cascade Periodization (GZCLP)
 * Stage 1: 5×3 (total req = 15) -> fail -> Stage 2: 6×2 (total req = 12) -> fail -> Stage 3: 10×1 (total req = 10)
 * -> fail -> Reset to Stage 1 at 85% of peak weight achieved.
 */
const GZCLP_STAGES: Record<1 | 2 | 3, { sets: number; reps: number; totalRequired: number }> = {
  1: { sets: 5, reps: 3, totalRequired: 15 },
  2: { sets: 6, reps: 2, totalRequired: 12 },
  3: { sets: 10, reps: 1, totalRequired: 10 },
};

export function evaluateGzclp(
  config: GzclpConfig,
  lastWorkingSets: WorkoutSet[]
): NextSessionPrescription {
  const working = lastWorkingSets.filter((s) => s.completed && s.type !== 'W');
  const spec = GZCLP_STAGES[config.stage];

  if (working.length === 0) {
    return {
      summaryBadge: `GZCLP Stage ${config.stage} (${spec.sets}×${spec.reps} @ ${config.currentWeightKg}kg)`,
      rationale: `Complete ${spec.totalRequired} total reps to add +${config.weightIncrementKg}kg next session.`,
      sets: Array.from({ length: spec.sets }, () => ({
        weightKg: config.currentWeightKg,
        reps: spec.reps,
      })),
      updatedConfig: config,
    };
  }

  const totalReps = working.reduce((sum, s) => sum + (s.reps ?? 0), 0);
  const sessionWeight = Math.max(
    config.currentWeightKg,
    ...working.map((s) => s.weightKg ?? 0)
  );
  const peakWeight = Math.max(config.peakWeightKg, sessionWeight);

  let nextStage: 1 | 2 | 3 = config.stage;
  let nextWeight = sessionWeight;
  let rationale = '';

  if (totalReps >= spec.totalRequired) {
    nextWeight = roundToIncrement(sessionWeight + config.weightIncrementKg, 1.25);
    rationale = `Hit ${totalReps}/${spec.totalRequired} reps in Stage ${config.stage}. Advancing +${config.weightIncrementKg}kg → ${nextWeight}kg.`;
  } else if (config.stage === 1) {
    nextStage = 2;
    nextWeight = sessionWeight;
    rationale = `Completed ${totalReps}/15 reps in Stage 1. Holding ${nextWeight}kg and shifting to Stage 2 (6×2).`;
  } else if (config.stage === 2) {
    nextStage = 3;
    nextWeight = sessionWeight;
    rationale = `Completed ${totalReps}/12 reps in Stage 2. Holding ${nextWeight}kg and shifting to Stage 3 (10×1).`;
  } else {
    nextStage = 1;
    nextWeight = roundToIncrement(peakWeight * 0.85, 2.5);
    rationale = `Completed ${totalReps}/10 reps in Stage 3. Resetting to Stage 1 (5×3) at 85% of peak (${peakWeight}kg) → ${nextWeight}kg.`;
  }

  const nextSpec = GZCLP_STAGES[nextStage];
  const updatedConfig: GzclpConfig = {
    ...config,
    stage: nextStage,
    currentWeightKg: nextWeight,
    peakWeightKg: Math.max(peakWeight, nextWeight),
  };

  return {
    summaryBadge: `GZCLP Stage ${nextStage} (${nextSpec.sets}×${nextSpec.reps} @ ${nextWeight}kg)`,
    rationale,
    sets: Array.from({ length: nextSpec.sets }, () => ({
      weightKg: nextWeight,
      reps: nextSpec.reps,
    })),
    updatedConfig,
  };
}

/**
 * Mode D: RPE / RIR Intra-Session Autoregulation & Scheduled Deloads
 * - Real-time load adjustment: ~3.5% per 1.0 RPE point delta from target.
 * - Scheduled Deload: every Nth week -> W_deload = 0.60 * W_working (sets held constant).
 */
export function computeIntraSessionRpeAdjustment(
  currentWeightKg: number,
  targetRpe: number,
  actualRpe: number,
  incrementKg = 2.5
): { adjustedWeightKg: number; deltaPct: number; message: string | null } {
  if (currentWeightKg <= 0 || !Number.isFinite(actualRpe) || !Number.isFinite(targetRpe)) {
    return { adjustedWeightKg: currentWeightKg, deltaPct: 0, message: null };
  }
  const rpeDiff = actualRpe - targetRpe;
  if (Math.abs(rpeDiff) < 0.5) {
    return { adjustedWeightKg: currentWeightKg, deltaPct: 0, message: null };
  }

  // Positive rpeDiff means harder than target -> scale load DOWN by 3.5% per RPE point
  const deltaPct = -rpeDiff * 0.035;
  const rawAdjusted = currentWeightKg * (1 + deltaPct);
  const adjustedWeightKg = Math.max(incrementKg, roundToIncrement(rawAdjusted, incrementKg));
  const pctDisplay = Math.round(deltaPct * 1000) / 10;

  return {
    adjustedWeightKg,
    deltaPct: pctDisplay,
    message:
      rpeDiff > 0
        ? `Logged RPE ${actualRpe} vs target ${targetRpe} → scaled next set ${pctDisplay}% to ${adjustedWeightKg}kg to manage fatigue.`
        : `Logged RPE ${actualRpe} vs target ${targetRpe} → nudged next set +${pctDisplay}% to ${adjustedWeightKg}kg.`,
  };
}

export function isDeloadWeek(currentWeek: number, deloadEveryNWeeks = 7): boolean {
  if (deloadEveryNWeeks <= 1) return false;
  return currentWeek > 0 && currentWeek % deloadEveryNWeeks === 0;
}

export function computeDeloadWeight(workingWeightKg: number, incrementKg = 2.5): number {
  return roundToIncrement(0.6 * workingWeightKg, incrementKg);
}

export function evaluateRpeAutoreg(
  config: RpeAutoregConfig,
  lastWorkingSets: WorkoutSet[]
): NextSessionPrescription {
  const working = lastWorkingSets.filter((s) => s.completed && s.type !== 'W');
  const setCount = Math.max(3, working.length || 3);
  const avgWeight =
    working.length > 0
      ? working.reduce((sum, s) => sum + (s.weightKg ?? 0), 0) / working.length
      : 0;
  const deload = isDeloadWeek(config.currentWeek, config.deloadEveryNWeeks);

  if (deload && avgWeight > 0) {
    const deloadWeight = computeDeloadWeight(avgWeight);
    return {
      summaryBadge: `Deload Wk ${config.currentWeek} · 60% (${deloadWeight}kg)`,
      rationale: `Scheduled mesocycle deload (Week ${config.currentWeek}/${config.deloadEveryNWeeks}). Keeping ${setCount} sets at 60% working load.`,
      sets: Array.from({ length: setCount }, () => ({
        weightKg: deloadWeight,
        reps: config.targetReps,
        targetRpe: 6,
      })),
      updatedConfig: { ...config, currentWeek: config.currentWeek + 1 },
    };
  }

  return {
    summaryBadge: `RPE ${config.targetRpe} Autoreg · Wk ${config.currentWeek}`,
    rationale: `Target RPE ${config.targetRpe} (RIR ${Math.max(0, 10 - config.targetRpe)}). Next sets auto-adjust ±3.5% per 1.0 RPE deviation.`,
    sets: Array.from({ length: setCount }, () => ({
      weightKg: roundToIncrement(avgWeight, 2.5),
      reps: config.targetReps,
      targetRpe: config.targetRpe,
    })),
    updatedConfig: {
      ...config,
      currentWeek: working.length > 0 ? config.currentWeek + 1 : config.currentWeek,
    },
  };
}

/**
 * Unified dispatcher for any configured progression mode.
 */
export function evaluateProgression(
  config: ProgressionConfig,
  lastWorkingSets: WorkoutSet[]
): NextSessionPrescription | null {
  switch (config.mode) {
    case 'double_progression':
      return evaluateDoubleProgression(config, lastWorkingSets);
    case 'tm_amrap':
      return evaluateTmAmrap(config, lastWorkingSets);
    case 'gzclp':
      return evaluateGzclp(config, lastWorkingSets);
    case 'rpe_autoreg':
      return evaluateRpeAutoreg(config, lastWorkingSets);
    case 'none':
    default:
      return null;
  }
}
