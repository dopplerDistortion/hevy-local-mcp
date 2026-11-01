import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HevyApiError, HevyClient, seg } from "./client.js";
import {
  CustomExerciseType,
  DateOnly,
  EquipmentCategory,
  measurementFields,
  MuscleGroup,
  RoutineInput,
  WorkoutInput,
} from "./schemas.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

const page = z.number().int().min(1).default(1).describe("Page number, starting at 1");
const pageSize10 = z.number().int().min(1).max(10).default(10).describe("Items per page (max 10)");
const pageSize100 = z.number().int().min(1).max(100).default(100).describe("Items per page (max 100)");
const id = (what: string) => z.string().min(1).describe(`${what} id`);

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof HevyApiError) {
    text = err.message;
    if (err.status === 401) text += "\nCheck that HEVY_API_KEY is set to a valid key (Hevy Pro is required).";
    if (err.status === 429) text += "\nRate limited by Hevy; wait a bit before retrying.";
  } else if (err instanceof Error) {
    text = `${err.name}: ${err.message}`;
  } else {
    text = String(err);
  }
  return { isError: true, content: [{ type: "text", text }] };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

interface ExerciseTemplate {
  id: string;
  title: string;
  type?: string;
  primary_muscle_group?: string;
  secondary_muscle_groups?: string[];
  equipment?: string;
  is_custom?: boolean;
}

/** Caches the full exercise template library so lookups by name are cheap. */
class TemplateCache {
  private items: ExerciseTemplate[] | null = null;
  private loadedAt = 0;
  constructor(private readonly client: HevyClient, private readonly ttlMs = 60 * 60 * 1000) {}

  invalidate() {
    this.items = null;
  }

  async all(): Promise<ExerciseTemplate[]> {
    if (this.items && Date.now() - this.loadedAt < this.ttlMs) return this.items;
    const out: ExerciseTemplate[] = [];
    let p = 1;
    let pageCount = 1;
    do {
      const res = await this.client.get<{ page_count: number; exercise_templates: ExerciseTemplate[] }>(
        "/v1/exercise_templates",
        { page: p, pageSize: 100 },
      );
      out.push(...(res.exercise_templates ?? []));
      pageCount = res.page_count ?? 1;
      p++;
    } while (p <= pageCount && p <= 100);
    this.items = out;
    this.loadedAt = Date.now();
    return out;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

export function registerTools(server: McpServer, client: HevyClient): void {
  const templates = new TemplateCache(client);

  // ---------------------------------------------------------------- user
  server.registerTool(
    "get_user_info",
    {
      title: "Get Hevy user info",
      description: "Get the authenticated user's profile, including preferred weight and distance units.",
      annotations: READ,
    },
    () => run(() => client.get("/v1/user/info")),
  );

  // ---------------------------------------------------------------- workouts
  server.registerTool(
    "list_workouts",
    {
      title: "List workouts",
      description: "List logged workouts, newest first, paginated (max 10 per page).",
      inputSchema: { page, pageSize: pageSize10 },
      annotations: READ,
    },
    ({ page, pageSize }) => run(() => client.get("/v1/workouts", { page, pageSize })),
  );

  server.registerTool(
    "get_workout",
    {
      title: "Get workout",
      description: "Get a single workout with all exercises and sets.",
      inputSchema: { workoutId: id("Workout") },
      annotations: READ,
    },
    ({ workoutId }) => run(() => client.get(`/v1/workouts/${seg(workoutId)}`)),
  );

  server.registerTool(
    "get_workout_count",
    {
      title: "Count workouts",
      description: "Get the total number of workouts the user has logged.",
      annotations: READ,
    },
    () => run(() => client.get("/v1/workouts/count")),
  );

  server.registerTool(
    "get_workout_events",
    {
      title: "List workout events",
      description:
        "List workout updates and deletions since a given time, newest first. Useful to see what changed recently.",
      inputSchema: {
        since: z.string().default("1970-01-01T00:00:00Z").describe("ISO 8601 date-time"),
        page,
        pageSize: pageSize10,
      },
      annotations: READ,
    },
    ({ since, page, pageSize }) => run(() => client.get("/v1/workouts/events", { since, page, pageSize })),
  );

  server.registerTool(
    "create_workout",
    {
      title: "Log a workout",
      description:
        "Log a completed workout. Weights are always in kg. Look up exercise_template_id values with search_exercise_templates first.",
      inputSchema: { workout: WorkoutInput },
      annotations: CREATE,
    },
    ({ workout }) => run(() => client.post("/v1/workouts", { workout })),
  );

  server.registerTool(
    "update_workout",
    {
      title: "Update a workout",
      description:
        "Replace an existing workout. This overwrites the whole workout, so fetch it with get_workout first and send back every exercise and set you want to keep.",
      inputSchema: { workoutId: id("Workout"), workout: WorkoutInput },
      annotations: UPDATE,
    },
    ({ workoutId, workout }) => run(() => client.put(`/v1/workouts/${seg(workoutId)}`, { workout })),
  );

  // ---------------------------------------------------------------- routines
  server.registerTool(
    "list_routines",
    {
      title: "List routines",
      description: "List saved routines (workout templates), paginated (max 10 per page).",
      inputSchema: { page, pageSize: pageSize10 },
      annotations: READ,
    },
    ({ page, pageSize }) => run(() => client.get("/v1/routines", { page, pageSize })),
  );

  server.registerTool(
    "get_routine",
    {
      title: "Get routine",
      description: "Get a single routine with its exercises, sets, rep ranges and rest timers.",
      inputSchema: { routineId: id("Routine") },
      annotations: READ,
    },
    ({ routineId }) => run(() => client.get(`/v1/routines/${seg(routineId)}`)),
  );

  server.registerTool(
    "create_routine",
    {
      title: "Create routine",
      description:
        "Create a new routine. Weights are in kg. Look up exercise_template_id values with search_exercise_templates first.",
      inputSchema: { routine: RoutineInput },
      annotations: CREATE,
    },
    ({ routine }) => run(() => client.post("/v1/routines", { routine })),
  );

  server.registerTool(
    "update_routine",
    {
      title: "Update routine",
      description:
        "Replace an existing routine. This overwrites the whole routine, so fetch it with get_routine first and send back every exercise and set you want to keep.",
      inputSchema: { routineId: id("Routine"), routine: RoutineInput },
      annotations: UPDATE,
    },
    ({ routineId, routine }) => run(() => client.put(`/v1/routines/${seg(routineId)}`, { routine })),
  );

  // ---------------------------------------------------------------- routine folders
  server.registerTool(
    "list_routine_folders",
    {
      title: "List routine folders",
      description: "List routine folders, paginated (max 10 per page).",
      inputSchema: { page, pageSize: pageSize10 },
      annotations: READ,
    },
    ({ page, pageSize }) => run(() => client.get("/v1/routine_folders", { page, pageSize })),
  );

  server.registerTool(
    "get_routine_folder",
    {
      title: "Get routine folder",
      description: "Get a single routine folder.",
      inputSchema: { folderId: id("Routine folder") },
      annotations: READ,
    },
    ({ folderId }) => run(() => client.get(`/v1/routine_folders/${seg(folderId)}`)),
  );

  server.registerTool(
    "create_routine_folder",
    {
      title: "Create routine folder",
      description: "Create a routine folder. New folders are placed first in the list.",
      inputSchema: { title: z.string().min(1) },
      annotations: CREATE,
    },
    ({ title }) => run(() => client.post("/v1/routine_folders", { routine_folder: { title } })),
  );

  // ---------------------------------------------------------------- exercise templates
  server.registerTool(
    "search_exercise_templates",
    {
      title: "Search exercises",
      description:
        "Find exercise templates (built-in and custom) by name, muscle group or equipment. Use this to get exercise_template_id values for workouts and routines.",
      inputSchema: {
        query: z.string().optional().describe("Words to match in the exercise title, e.g. 'bench press'"),
        muscle_group: MuscleGroup.optional().describe("Primary or secondary muscle group"),
        equipment: EquipmentCategory.optional(),
        custom_only: z.boolean().optional().describe("Only return the user's custom exercises"),
        limit: z.number().int().min(1).max(200).default(25),
      },
      annotations: READ,
    },
    ({ query, muscle_group, equipment, custom_only, limit }) =>
      run(async () => {
        const words = query ? normalize(query).split(" ").filter(Boolean) : [];
        const all = await templates.all();
        const matches = all.filter((t) => {
          const title = normalize(t.title ?? "");
          if (words.length && !words.every((w) => title.includes(w))) return false;
          if (muscle_group && t.primary_muscle_group !== muscle_group && !t.secondary_muscle_groups?.includes(muscle_group))
            return false;
          if (equipment && t.equipment !== equipment) return false;
          if (custom_only && !t.is_custom) return false;
          return true;
        });
        // Prefer exact, then prefix title matches.
        const q = query ? normalize(query) : "";
        const rank = (t: ExerciseTemplate) => {
          const title = normalize(t.title ?? "");
          return title === q ? 0 : title.startsWith(q) ? 1 : 2;
        };
        // Within a rank, shorter titles first, so "Bench Press (Barbell)" beats "Bench Press - Close Grip (Barbell)".
        matches.sort(
          (a, b) => rank(a) - rank(b) || a.title.length - b.title.length || a.title.localeCompare(b.title),
        );
        return { total_matches: matches.length, exercise_templates: matches.slice(0, limit) };
      }),
  );

  server.registerTool(
    "list_exercise_templates",
    {
      title: "List exercise templates",
      description: "List exercise templates page by page (max 100 per page). Prefer search_exercise_templates to find specific exercises.",
      inputSchema: { page, pageSize: pageSize100 },
      annotations: READ,
    },
    ({ page, pageSize }) => run(() => client.get("/v1/exercise_templates", { page, pageSize })),
  );

  server.registerTool(
    "get_exercise_template",
    {
      title: "Get exercise template",
      description: "Get a single exercise template by id.",
      inputSchema: { exerciseTemplateId: id("Exercise template") },
      annotations: READ,
    },
    ({ exerciseTemplateId }) => run(() => client.get(`/v1/exercise_templates/${seg(exerciseTemplateId)}`)),
  );

  server.registerTool(
    "create_exercise_template",
    {
      title: "Create custom exercise",
      description: "Create a custom exercise template. Check search_exercise_templates first to avoid duplicates.",
      inputSchema: {
        title: z.string().min(1),
        exercise_type: CustomExerciseType,
        equipment_category: EquipmentCategory,
        muscle_group: MuscleGroup.describe("Primary muscle group"),
        other_muscles: z.array(MuscleGroup).default([]).describe("Secondary muscle groups"),
      },
      annotations: CREATE,
    },
    (exercise) =>
      run(async () => {
        const res = await client.post("/v1/exercise_templates", { exercise });
        templates.invalidate();
        return res;
      }),
  );

  server.registerTool(
    "get_exercise_history",
    {
      title: "Get exercise history",
      description:
        "Get every logged set of one exercise across workouts, optionally within a date range. Good for tracking progress and PRs.",
      inputSchema: {
        exerciseTemplateId: id("Exercise template"),
        start_date: z.string().optional().describe("ISO 8601 date-time lower bound"),
        end_date: z.string().optional().describe("ISO 8601 date-time upper bound"),
      },
      annotations: READ,
    },
    ({ exerciseTemplateId, start_date, end_date }) =>
      run(() => client.get(`/v1/exercise_history/${seg(exerciseTemplateId)}`, { start_date, end_date })),
  );

  // ---------------------------------------------------------------- body measurements
  server.registerTool(
    "list_body_measurements",
    {
      title: "List body measurements",
      description: "List body measurement entries, paginated (max 10 per page).",
      inputSchema: { page, pageSize: pageSize10 },
      annotations: READ,
    },
    ({ page, pageSize }) => run(() => client.get("/v1/body_measurements", { page, pageSize })),
  );

  server.registerTool(
    "get_body_measurement",
    {
      title: "Get body measurement",
      description: "Get the body measurement entry for a date.",
      inputSchema: { date: DateOnly },
      annotations: READ,
    },
    ({ date }) => run(() => client.get(`/v1/body_measurements/${seg(date)}`)),
  );

  server.registerTool(
    "create_body_measurement",
    {
      title: "Log body measurement",
      description: "Log body measurements for a date. Fails with 409 if that date already has an entry; use update_body_measurement then.",
      inputSchema: { date: DateOnly, ...measurementFields },
      annotations: CREATE,
    },
    (body) => run(() => client.post("/v1/body_measurements", body)),
  );

  server.registerTool(
    "update_body_measurement",
    {
      title: "Update body measurement",
      description:
        "Replace the body measurement entry for a date. Fields you omit are cleared, so fetch the entry first and resend values to keep.",
      inputSchema: { date: DateOnly, ...measurementFields },
      annotations: UPDATE,
    },
    ({ date, ...rest }) => run(() => client.put(`/v1/body_measurements/${seg(date)}`, rest)),
  );
}
