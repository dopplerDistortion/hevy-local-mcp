#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HevyClient } from "./client.js";
import { registerTools } from "./tools.js";

const apiKey = process.env.HEVY_API_KEY?.trim();
if (!apiKey) {
  console.error(
    "hevy-local-mcp: HEVY_API_KEY is not set. Get a key at https://hevy.com/settings?developer and pass it via the environment.",
  );
  process.exit(1);
}

const client = new HevyClient({ apiKey, baseUrl: process.env.HEVY_BASE_URL });

const server = new McpServer(
  { name: "hevy", version: "0.1.0" },
  {
    instructions:
      "Tools for the user's Hevy workout tracker. Weights are always kilograms in the API; call get_user_info to learn whether the user prefers kg or lbs and convert when talking to them. " +
      "Before creating or editing workouts or routines, resolve exercise names to ids with search_exercise_templates. " +
      "update_workout and update_routine replace the whole object, so read it first and resend everything to keep. There are no delete endpoints.",
  },
);

registerTools(server, client);

await server.connect(new StdioServerTransport());
console.error("hevy-local-mcp: running on stdio");
