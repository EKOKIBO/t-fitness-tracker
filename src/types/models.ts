export type WeightUnit = 'kg' | 'lbs';
export type Sex = 'male' | 'female';

export type MuscleGroup =
  | 'chest'
  | 'front_delts'
  | 'side_delts'
  | 'rear_delts'
  | 'lats'
  | 'upper_back'
  | 'traps'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'lower_back'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'calves';

export type BodyRegion =
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'lower_back'
  | 'hip'
  | 'knee'
  | 'ankle'
  | 'neck';

export type MovementCategory =
  | 'squat'
  | 'hinge'
  | 'horizontal_push'
  | 'vertical_push'
  | 'pull';

export type EquipmentType =
  | 'Barbell'
  | 'Dumbbell'
  | 'Machine'
  | 'Cable'
  | 'Bodyweight'
  | 'Kettlebell'
  | 'Smith Machine'
  | 'EZ Bar'
  | 'Trap Bar';

export type SetType = 'normal' | 'W' | 'D' | 'F' | 'M';

export type ProgressionMode = 'none' | 'double_progression' | 'tm_amrap' | 'gzclp' | 'rpe_autoreg';

export interface ClientInjury {
  id: string;
  region: BodyRegion;
  label: string;
  severity: 'mild' | 'moderate' | 'severe';
  notes?: string;
}

export interface Client {
  id: string;
  name: string;
  avatarInitials: string;
  avatarColor: string;
  isPersonal?: boolean;
  sex: Sex;
  age: number;
  bodyweightKg: number;
  unit: WeightUnit;
  injuries: ClientInjury[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  equipment: EquipmentType;
  movementPattern: MovementCategory | 'isolation' | 'core';
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  bodyRegions: BodyRegion[];
  isCanonicalStrengthLift?: boolean;
  canonicalCategory?: MovementCategory;
  instructions: string[];
  isCustom?: boolean;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface DoubleProgressionConfig {
  mode: 'double_progression';
  minReps: number;
  maxReps: number;
  targetSets: number;
  weightIncrementKg: number;
  rpeCap: number;
}

export interface TmAmrapConfig {
  mode: 'tm_amrap';
  trainingMaxKg: number;
  baseIncrementKg: number;
  weekIndex: number; // 1, 2, 3, or 4 (deload)
}

export interface GzclpConfig {
  mode: 'gzclp';
  stage: 1 | 2 | 3; // 1: 5x3, 2: 6x2, 3: 10x1
  currentWeightKg: number;
  peakWeightKg: number;
  weightIncrementKg: number;
}

export interface RpeAutoregConfig {
  mode: 'rpe_autoreg';
  targetRpe: number;
  targetReps: number;
  deloadEveryNWeeks: number;
  currentWeek: number;
}

export interface NoneProgressionConfig {
  mode: 'none';
}

export type ProgressionConfig =
  | NoneProgressionConfig
  | DoubleProgressionConfig
  | TmAmrapConfig
  | GzclpConfig
  | RpeAutoregConfig;

export interface ClientExerciseNote {
  id: string; // `${clientId}:${exerciseId}`
  clientId: string;
  exerciseId: string;
  setupCue: string;
  progressionConfig: ProgressionConfig;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface RoutineFolder {
  id: string;
  name: string;
  order: number;
  collapsed?: boolean;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface RoutineExercise {
  id: string;
  exerciseId: string;
  defaultSets: number;
  defaultReps: number;
  restSeconds: number;
  supersetGroupId?: string | null;
  progressionConfig?: ProgressionConfig;
  notes?: string;
}

export interface Routine {
  id: string;
  folderId?: string | null;
  name: string;
  description?: string;
  isTemplate: boolean;
  assignedClientId?: string | null;
  exercises: RoutineExercise[];
  updatedAt: number;
  deletedAt?: number | null;
}

export interface ProgramDay {
  id: string;
  name: string;
  exercises: RoutineExercise[];
}

export interface Program {
  id: string;
  name: string;
  description: string;
  weeksCount: number;
  deloadEveryNWeeks: number;
  isMasterTemplate: boolean;
  days: ProgramDay[];
  updatedAt: number;
  deletedAt?: number | null;
}

export interface ClientProgramEnrollment {
  id: string;
  clientId: string;
  programId: string;
  currentWeek: number;
  currentDayIndex: number;
  completedDays: number;
  active: boolean;
  startedAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface WorkoutSet {
  id: string;
  setNumber: number;
  type: SetType;
  weightKg: number | null;
  reps: number | null;
  rpe?: number | null;
  completed: boolean;
  completedAt?: number | null;
  isPR?: boolean;
  isAmrap?: boolean;
  targetWeightKg?: number | null;
  targetReps?: number | null;
  targetRpe?: number | null;
  prevWeightKg?: number | null;
  prevReps?: number | null;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  supersetGroupId?: string | null;
  restSeconds: number;
  sets: WorkoutSet[];
  progressionNote?: string;
}

export interface ReadinessCheckIn {
  sleep: number; // 1-5
  energy: number; // 1-5
  soreness: number; // 1-5
}

export interface Workout {
  id: string;
  clientId: string;
  routineId?: string | null;
  programEnrollmentId?: string | null;
  name: string;
  startedAt: number;
  finishedAt?: number | null;
  status: 'active' | 'completed';
  readiness?: ReadinessCheckIn;
  notes?: string;
  exercises: WorkoutExercise[];
  totalVolumeKg: number;
  effectiveSets: number;
  prCount: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface BodyMeasurement {
  id: string;
  clientId: string;
  date: string; // YYYY-MM-DD
  bodyweightKg?: number | null;
  bodyFatPct?: number | null;
  neckCm?: number | null;
  shouldersCm?: number | null;
  chestCm?: number | null;
  waistCm?: number | null;
  hipsCm?: number | null;
  leftBicepCm?: number | null;
  rightBicepCm?: number | null;
  leftForearmCm?: number | null;
  rightForearmCm?: number | null;
  leftThighCm?: number | null;
  rightThighCm?: number | null;
  leftCalfCm?: number | null;
  rightCalfCm?: number | null;
  photoDataUrl?: string | null;
  notes?: string;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface AppSettings {
  activeClientId: string;
  activeWorkoutIds: string[];
  quietMode: boolean;
  barbellWeightKg: number;
  plateInventoryKg: number[];
  cloudSyncEnabled: boolean;
  cloudSyncUrl: string;
  cloudSyncKey: string;
  lastSyncAt: number;
  lastBackupExportAt: number;
  workoutsSinceLastBackup: number;
}

export type AppTab = 'home' | 'programs' | 'log' | 'analytics' | 'exercises';

export const KG_TO_LBS = 2.2046226218;

export function formatWeight(weightKg: number | null | undefined, unit: WeightUnit): string {
  if (weightKg == null || Number.isNaN(weightKg)) return '—';
  const val = unit === 'lbs' ? weightKg * KG_TO_LBS : weightKg;
  return Number.isInteger(Math.round(val * 10) / 10)
    ? `${Math.round(val)}`
    : `${(Math.round(val * 10) / 10).toFixed(1)}`;
}

export function displayToKg(val: number, unit: WeightUnit): number {
  return unit === 'lbs' ? Math.round((val / KG_TO_LBS) * 100) / 100 : val;
}

export function kgToDisplay(weightKg: number, unit: WeightUnit): number {
  const raw = unit === 'lbs' ? weightKg * KG_TO_LBS : weightKg;
  return Math.round(raw * 10) / 10;
}

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  front_delts: 'Front Delts',
  side_delts: 'Side Delts',
  rear_delts: 'Rear Delts',
  lats: 'Lats',
  upper_back: 'Upper Back',
  traps: 'Traps',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs & Core',
  lower_back: 'Lower Back',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
};

export const BODY_REGION_LABELS: Record<BodyRegion, string> = {
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  lower_back: 'Lower Back',
  hip: 'Hip',
  knee: 'Knee',
  ankle: 'Ankle',
  neck: 'Neck',
};

export const CATEGORY_LABELS: Record<MovementCategory, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  horizontal_push: 'Horiz. Push',
  vertical_push: 'Vert. Push',
  pull: 'Pull',
};
