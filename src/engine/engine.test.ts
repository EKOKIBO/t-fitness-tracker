import { describe, expect, it } from 'vitest';
import {
  calculateDots,
  calculateHybridE1RM,
  computeCompositeStrengthScore,
  computeMuscleVolume,
  generateWarmupRamp,
  getAgeAdjustmentFactor,
  getRpeStimulusFactor,
  solveGreedyBarbellPlates,
} from './formulas';
import {
  computeDeloadWeight,
  computeIntraSessionRpeAdjustment,
  evaluateDoubleProgression,
  evaluateGzclp,
  evaluateTmAmrap,
  initTrainingMax,
  isDeloadWeek,
} from './progression';
import { buildSeedExercises } from './exercisesSeed';
import { importExternalWorkoutsCsv } from './portability';
import type { Client, Workout, WorkoutSet } from '../types/models';

describe('3.1 Hybrid e1RM', () => {
  it('matches Brzycki at low reps and is continuous at r = 10', () => {
    expect(calculateHybridE1RM(100, 1)).toBe(100);
    expect(calculateHybridE1RM(100, 5)).toBe(112.5);
    // At r=10: 36/27 = 1.3333 -> 133.3; at r=11: 1/(0.75 - 0.0125) = 1/0.7375 -> 135.6
    expect(calculateHybridE1RM(100, 10)).toBe(133.3);
    expect(calculateHybridE1RM(100, 11)).toBe(135.6);
    expect(calculateHybridE1RM(100, 30)).toBe(200);
    expect(calculateHybridE1RM(100, 40)).toBe(200);
  });
});

describe('3.2 DOTS, Age Factor & Strength Score', () => {
  it('computes accurate male and female DOTS coefficients', () => {
    const maleDots = calculateDots(200, 83, 'male');
    const femaleDots = calculateDots(140, 63, 'female');
    expect(maleDots).toBeGreaterThan(130);
    expect(maleDots).toBeLessThan(145);
    expect(femaleDots).toBeGreaterThan(145);
    expect(femaleDots).toBeLessThan(165);
  });

  it('applies IPF prime age factor 1.00 for ages 23-39 and scales for Masters/Teens', () => {
    expect(getAgeAdjustmentFactor(28)).toBe(1.0);
    expect(getAgeAdjustmentFactor(18)).toBeGreaterThan(1.0);
    expect(getAgeAdjustmentFactor(50)).toBeGreaterThan(1.1);
  });

  it('computes composite 5-axis Strength Score and Balance Index', () => {
    const exMap = new Map(buildSeedExercises().map((e) => [e.id, e]));
    const client: Client = {
      id: 'c1',
      name: 'Test Lifter',
      avatarInitials: 'TL',
      avatarColor: '#007AFF',
      sex: 'male',
      age: 30,
      bodyweightKg: 82,
      unit: 'kg',
      injuries: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const workout: Workout = {
      id: 'w1',
      clientId: 'c1',
      name: 'SBD + OHP + Pull',
      startedAt: Date.now() - 1000,
      finishedAt: Date.now(),
      status: 'completed',
      exercises: [
        { id: '1', exerciseId: 'ex-barbell-back-squat', restSeconds: 180, sets: [{ id: 's1', setNumber: 1, type: 'normal', weightKg: 140, reps: 5, completed: true }] },
        { id: '2', exerciseId: 'ex-conventional-deadlift', restSeconds: 180, sets: [{ id: 's2', setNumber: 1, type: 'normal', weightKg: 170, reps: 5, completed: true }] },
        { id: '3', exerciseId: 'ex-barbell-bench-press', restSeconds: 180, sets: [{ id: 's3', setNumber: 1, type: 'normal', weightKg: 100, reps: 5, completed: true }] },
        { id: '4', exerciseId: 'ex-overhead-press', restSeconds: 180, sets: [{ id: 's4', setNumber: 1, type: 'normal', weightKg: 65, reps: 5, completed: true }] },
        { id: '5', exerciseId: 'ex-weighted-pull-up', restSeconds: 180, sets: [{ id: 's5', setNumber: 1, type: 'normal', weightKg: 20, reps: 5, completed: true }] },
      ],
      totalVolumeKg: 0,
      effectiveSets: 5,
      prCount: 0,
      updatedAt: Date.now(),
    };

    const summary = computeCompositeStrengthScore(client, [workout], exMap, 90);
    expect(summary.strengthScore).toBeGreaterThan(45);
    expect(summary.strengthScore).toBeLessThan(85);
    expect(summary.balanceIndex).toBeGreaterThan(75);
  });
});

describe('3.3 Fractional & Effective Muscle Volume', () => {
  it('discounts RPE < 8 and ignores warm-up sets', () => {
    expect(getRpeStimulusFactor(8)).toBe(1);
    expect(getRpeStimulusFactor(9.5)).toBe(1);
    expect(Math.round(getRpeStimulusFactor(7) * 100) / 100).toBe(0.67);
    expect(getRpeStimulusFactor(5)).toBe(0);

    const exMap = new Map(buildSeedExercises().map((e) => [e.id, e]));
    const w: Workout = {
      id: 'w-vol',
      clientId: 'c1',
      name: 'Bench Day',
      startedAt: 0,
      finishedAt: 1000,
      status: 'completed',
      exercises: [
        {
          id: 'e1',
          exerciseId: 'ex-barbell-bench-press',
          restSeconds: 120,
          sets: [
            { id: 's1', setNumber: 1, type: 'W', weightKg: 50, reps: 8, completed: true },
            { id: 's2', setNumber: 2, type: 'normal', weightKg: 100, reps: 8, rpe: 8, completed: true },
            { id: 's3', setNumber: 3, type: 'normal', weightKg: 100, reps: 8, rpe: 7, completed: true },
          ],
        },
      ],
      totalVolumeKg: 1600,
      effectiveSets: 1.67,
      prCount: 0,
      updatedAt: 0,
    };

    const vol = computeMuscleVolume([w], exMap);
    expect(vol.chest.rawSets).toBe(2);
    expect(vol.chest.effectiveSets).toBe(1.7);
    expect(vol.triceps.rawSets).toBe(1); // 2 sets * 0.5 secondary
  });
});

describe('3.4 Warm-Up Generator & Greedy Plate Solver', () => {
  it('generates deduplicated warm-up ramps above empty bar', () => {
    const ramp = generateWarmupRamp(100, 20, 2.5);
    expect(ramp.map((r) => r.weightKg)).toEqual([20, 40, 60, 80]);
    const lightRamp = generateWarmupRamp(30, 20, 2.5);
    expect(lightRamp.every((r) => r.weightKg >= 20 && r.weightKg < 30)).toBe(true);
  });

  it('solves IPF barbell plate loading accurately', () => {
    const sol = solveGreedyBarbellPlates(142.5, 20);
    // (142.5 - 20) / 2 = 61.25 kg per side -> 2x25 (50) + 1x10 (60) + 1x1.25 (61.25)
    expect(sol.achievedWeightKg).toBe(142.5);
    expect(sol.remainderPerSideKg).toBe(0);
    expect(sol.platesPerSide.map((p) => [p.weightKg, p.countPerSide])).toEqual([
      [25, 2],
      [10, 1],
      [1.25, 1],
    ]);
  });
});

describe('2. Progression Engines (Modes A, B, C, D)', () => {
  it('Mode A: Double Progression holds until all sets hit maxReps cleanly, then steps up', () => {
    const cfg = {
      mode: 'double_progression' as const,
      minReps: 8,
      maxReps: 12,
      targetSets: 3,
      weightIncrementKg: 2.5,
      rpeCap: 8.5,
    };
    const partialSets: WorkoutSet[] = [
      { id: '1', setNumber: 1, type: 'normal', weightKg: 60, reps: 12, rpe: 8, completed: true },
      { id: '2', setNumber: 2, type: 'normal', weightKg: 60, reps: 11, rpe: 8.5, completed: true },
      { id: '3', setNumber: 3, type: 'normal', weightKg: 60, reps: 10, rpe: 8.5, completed: true },
    ];
    const holdRes = evaluateDoubleProgression(cfg, partialSets);
    expect(holdRes.sets[0].weightKg).toBe(60);
    expect(holdRes.sets[1].reps).toBe(12);
    expect(holdRes.sets[2].reps).toBe(11);

    const readySets: WorkoutSet[] = [
      { id: '1', setNumber: 1, type: 'normal', weightKg: 60, reps: 12, rpe: 8, completed: true },
      { id: '2', setNumber: 2, type: 'normal', weightKg: 60, reps: 12, rpe: 8, completed: true },
      { id: '3', setNumber: 3, type: 'normal', weightKg: 60, reps: 12, rpe: 8.5, completed: true },
    ];
    const stepRes = evaluateDoubleProgression(cfg, readySets);
    expect(stepRes.sets[0].weightKg).toBe(62.5);
    expect(stepRes.sets[0].reps).toBe(8);
  });

  it('Mode B: TM + AMRAP scales TM based on AMRAP delta', () => {
    expect(initTrainingMax(100)).toBe(90);
    const baseCfg = {
      mode: 'tm_amrap' as const,
      trainingMaxKg: 100,
      baseIncrementKg: 2.5,
      weekIndex: 1, // req = 5 reps on top set
    };
    // Stall (<5) -> -10%
    const stall = evaluateTmAmrap(baseCfg, [
      { id: 'a', setNumber: 3, type: 'normal', weightKg: 85, reps: 3, completed: true, isAmrap: true },
    ]);
    expect(stall.updatedConfig.mode === 'tm_amrap' && stall.updatedConfig.trainingMaxKg).toBe(90);

    // Strong (+3 or more -> 8 reps) -> +2 * baseIncrement (+5kg)
    const fast = evaluateTmAmrap(baseCfg, [
      { id: 'a', setNumber: 3, type: 'normal', weightKg: 85, reps: 8, completed: true, isAmrap: true },
    ]);
    expect(fast.updatedConfig.mode === 'tm_amrap' && fast.updatedConfig.trainingMaxKg).toBe(105);
  });

  it('Mode C: GZCLP cascades 5x3 -> 6x2 -> 10x1 -> 85% reset', () => {
    const s1 = evaluateGzclp(
      { mode: 'gzclp', stage: 1, currentWeightKg: 100, peakWeightKg: 100, weightIncrementKg: 5 },
      [
        { id: '1', setNumber: 1, type: 'normal', weightKg: 100, reps: 3, completed: true },
        { id: '2', setNumber: 2, type: 'normal', weightKg: 100, reps: 3, completed: true },
        { id: '3', setNumber: 3, type: 'normal', weightKg: 100, reps: 2, completed: true },
      ]
    );
    expect(s1.updatedConfig.mode === 'gzclp' && s1.updatedConfig.stage).toBe(2);
    expect(s1.sets.length).toBe(6);

    const s3Fail = evaluateGzclp(
      { mode: 'gzclp', stage: 3, currentWeightKg: 120, peakWeightKg: 120, weightIncrementKg: 5 },
      [{ id: '1', setNumber: 1, type: 'normal', weightKg: 120, reps: 7, completed: true }]
    );
    expect(s3Fail.updatedConfig.mode === 'gzclp' && s3Fail.updatedConfig.stage).toBe(1);
    expect(s3Fail.updatedConfig.mode === 'gzclp' && s3Fail.updatedConfig.currentWeightKg).toBe(102.5);
  });

  it('Mode D: RPE autoregulation scales downward by ~3.5%/RPE and schedules 60% deloads', () => {
    const adj = computeIntraSessionRpeAdjustment(100, 8.0, 9.5, 2.5);
    expect(adj.adjustedWeightKg).toBe(95);
    expect(isDeloadWeek(7, 7)).toBe(true);
    expect(computeDeloadWeight(100, 2.5)).toBe(60);
  });
});

describe('Universal CSV Importer (Strong / Hevy)', () => {
  it('parses Strong CSV rows into completed workouts', () => {
    const csv = [
      'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,RPE',
      '2026-10-01 09:00:00,Push Day,Barbell Bench Press,1,100,5,8',
      '2026-10-01 09:00:00,Push Day,Barbell Bench Press,2,100,5,8.5',
    ].join('\n');
    const res = importExternalWorkoutsCsv(csv, 'client-personal', buildSeedExercises());
    expect(res.format).toBe('strong');
    expect(res.workouts.length).toBe(1);
    expect(res.importedSets).toBe(2);
    expect(res.workouts[0].totalVolumeKg).toBe(1000);
  });
});
