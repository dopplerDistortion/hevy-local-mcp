import { z } from "zod";

// Enums from the Hevy OpenAPI spec.
export const SetType = z.enum(["warmup", "normal", "failure", "dropset"]);
export const Rpe = z.union([
  z.literal(6),
  z.literal(7),
  z.literal(7.5),
  z.literal(8),
  z.literal(8.5),
  z.literal(9),
  z.literal(9.5),
  z.literal(10),
]);
export const MuscleGroup = z.enum([
  "abdominals", "shoulders", "biceps", "triceps", "forearms", "quadriceps",
  "hamstrings", "calves", "glutes", "abductors", "adductors", "lats",
  "upper_back", "traps", "lower_back", "chest", "cardio", "neck", "full_body", "other",
]);
export const EquipmentCategory = z.enum([
  "none", "barbell", "dumbbell", "kettlebell", "machine", "plate",
  "resistance_band", "suspension", "other",
]);
export const CustomExerciseType = z.enum([
  "weight_reps", "reps_only", "bodyweight_reps", "bodyweight_assisted_reps",
  "duration", "weight_duration", "distance_duration", "short_distance_weight",
]);

const optNum = z.number().nullable().optional();
const optInt = z.number().int().nullable().optional();

const setMetrics = {
  type: SetType.default("normal").describe("Set type"),
  weight_kg: optNum.describe("Weight in kilograms (convert from lbs if needed)"),
  reps: optInt,
  distance_meters: optInt,
  duration_seconds: optInt,
  custom_metric: optNum.describe("Custom metric, e.g. steps or floors for some cardio"),
};

export const WorkoutSet = z.object({
  ...setMetrics,
  rpe: Rpe.nullable().optional().describe("Rate of perceived exertion: 6, 7, 7.5, 8, 8.5, 9, 9.5 or 10"),
});

export const RoutineSet = z.object({
  ...setMetrics,
  rep_range: z
    .object({ start: z.number().nullable(), end: z.number().nullable() })
    .nullable()
    .optional()
    .describe("Target rep range, e.g. {start: 8, end: 12}"),
});

const exerciseBase = {
  exercise_template_id: z
    .string()
    .describe("Exercise template id (find it with search_exercise_templates)"),
  superset_id: z.number().int().nullable().optional().describe("Exercises sharing a superset_id are a superset"),
  notes: z.string().nullable().optional(),
};

export const WorkoutExercise = z.object({
  ...exerciseBase,
  sets: z.array(WorkoutSet),
});

export const RoutineExercise = z.object({
  ...exerciseBase,
  rest_seconds: z.number().int().nullable().optional().describe("Rest timer in seconds"),
  sets: z.array(RoutineSet),
});

export const WorkoutInput = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  start_time: z.string().describe("ISO 8601 date-time, e.g. 2024-08-14T12:00:00Z"),
  end_time: z.string().describe("ISO 8601 date-time"),
  is_private: z.boolean().optional(),
  exercises: z.array(WorkoutExercise),
});

export const RoutineInput = z.object({
  title: z.string(),
  folder_id: z
    .number()
    .nullable()
    .optional()
    .describe("Routine folder id; null/omitted puts it in the default 'My Routines' folder"),
  notes: z.string().nullable().optional(),
  exercises: z.array(RoutineExercise),
});


export const measurementFields = {
  weight_kg: optNum,
  lean_mass_kg: optNum,
  fat_percent: optNum,
  neck_cm: optNum,
  shoulder_cm: optNum,
  chest_cm: optNum,
  left_bicep_cm: optNum,
  right_bicep_cm: optNum,
  left_forearm_cm: optNum,
  right_forearm_cm: optNum,
  abdomen: optNum,
  waist: optNum,
  hips: optNum,
  left_thigh: optNum,
  right_thigh: optNum,
  left_calf: optNum,
  right_calf: optNum,
};

export const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date as YYYY-MM-DD");
