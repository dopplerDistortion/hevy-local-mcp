// End-to-end test: runs the built server over stdio against a local mock of the Hevy API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "00000000-0000-0000-0000-000000000000";
const requests = [];
let mock;
let client;

const templates = Array.from({ length: 150 }, (_, i) => ({
  id: `T${i}`,
  title: i === 42 ? "Bench Press (Barbell)" : i === 43 ? "Incline Bench Press (Dumbbell)" : `Exercise ${i}`,
  primary_muscle_group: i === 42 || i === 43 ? "chest" : "other",
  secondary_muscle_groups: [],
  equipment: i === 43 ? "dumbbell" : "barbell",
  is_custom: false,
}));

function respond(req, body) {
  const url = new URL(req.url, "http://x");
  if (req.headers["api-key"] !== KEY) return [401, { error: "Unauthorized" }];
  if (req.method === "GET" && url.pathname === "/v1/user/info")
    return [200, { data: { id: "u1", name: "Test", weight_unit: "kg" } }];
  if (req.method === "GET" && url.pathname === "/v1/exercise_templates") {
    const page = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("pageSize"));
    return [200, { page, page_count: Math.ceil(templates.length / size), exercise_templates: templates.slice((page - 1) * size, page * size) }];
  }
  if (req.method === "POST" && url.pathname === "/v1/routines") return [201, { routine: [{ id: "r1", ...body.routine }] }];
  if (req.method === "PUT" && url.pathname.startsWith("/v1/body_measurements/")) return [200, ""];
  if (req.method === "GET" && url.pathname === "/v1/workouts/missing") return [404, { error: "Workout not found" }];
  return [404, { error: "no mock" }];
}

before(async () => {
  mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const [status, out] = respond(req, body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(out === "" ? "" : JSON.stringify(out));
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const { port } = mock.address();
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: { ...process.env, HEVY_API_KEY: KEY, HEVY_BASE_URL: `http://127.0.0.1:${port}` },
    }),
  );
});

after(async () => {
  await client?.close();
  mock?.close();
});

const json = (res) => JSON.parse(res.content[0].text);

test("lists all tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const n of ["get_user_info", "list_workouts", "create_workout", "update_routine", "search_exercise_templates", "get_exercise_history", "update_body_measurement"])
    assert.ok(names.includes(n), n);
  assert.equal(tools.length, 23);
});

test("sends api-key header", async () => {
  const res = await client.callTool({ name: "get_user_info", arguments: {} });
  assert.equal(json(res).data.name, "Test");
  assert.equal(requests.at(-1).headers["api-key"], KEY);
});

test("search_exercise_templates pages through the library and ranks matches", async () => {
  const res = json(await client.callTool({ name: "search_exercise_templates", arguments: { query: "bench press" } }));
  assert.equal(res.total_matches, 2);
  assert.equal(res.exercise_templates[0].id, "T42");
  const dumbbell = json(await client.callTool({ name: "search_exercise_templates", arguments: { query: "bench", equipment: "dumbbell" } }));
  assert.deepEqual(dumbbell.exercise_templates.map((t) => t.id), ["T43"]);
  // second search served from cache: 2 pages fetched once
  assert.equal(requests.filter((r) => r.url.startsWith("/v1/exercise_templates")).length, 2);
});

test("create_routine wraps body and applies set defaults", async () => {
  const res = await client.callTool({
    name: "create_routine",
    arguments: {
      routine: {
        title: "Push",
        exercises: [{ exercise_template_id: "T42", rest_seconds: 120, sets: [{ weight_kg: 60, reps: 8, rep_range: { start: 6, end: 10 } }] }],
      },
    },
  });
  assert.ok(!res.isError, res.content[0].text);
  const sent = requests.at(-1);
  assert.equal(sent.method, "POST");
  assert.equal(sent.body.routine.title, "Push");
  assert.equal(sent.body.routine.exercises[0].sets[0].type, "normal");
});

test("invalid RPE is rejected before hitting the API", async () => {
  const before = requests.length;
  const res = await client.callTool({
    name: "create_workout",
    arguments: { workout: { title: "x", start_time: "2024-01-01T10:00:00Z", end_time: "2024-01-01T11:00:00Z", exercises: [{ exercise_template_id: "T42", sets: [{ reps: 5, rpe: 11 }] }] } },
  });
  assert.equal(res.isError, true);
  assert.equal(requests.length, before);
});

test("update_body_measurement puts date in path, not body; handles empty response", async () => {
  const res = await client.callTool({ name: "update_body_measurement", arguments: { date: "2024-05-01", weight_kg: 80 } });
  assert.ok(!res.isError, res.content[0].text);
  const sent = requests.at(-1);
  assert.equal(sent.url, "/v1/body_measurements/2024-05-01");
  assert.deepEqual(sent.body, { weight_kg: 80 });
});

test("API errors come back as tool errors", async () => {
  const res = await client.callTool({ name: "get_workout", arguments: { workoutId: "missing" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /404/);
});

test("ids are path-encoded", async () => {
  await client.callTool({ name: "get_workout", arguments: { workoutId: "../user/info" } });
  assert.equal(requests.at(-1).url, "/v1/workouts/..%2Fuser%2Finfo");
});
