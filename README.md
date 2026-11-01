# hevy-local-mcp

A local [MCP](https://modelcontextprotocol.io) server that wraps the [Hevy public API](https://api.hevyapp.com/docs/), so Claude can read and manage your workouts, routines, exercises and body measurements.

It runs on your machine over stdio. Your API key stays in your local environment and is only ever sent to `api.hevyapp.com`.

> The Hevy API is only available to **Hevy Pro** users.

## 1. Get your Hevy API key

Open [hevy.com/settings?developer](https://hevy.com/settings?developer), sign in, and generate a key. Treat it like a password: don't paste it into chats or commit it.

## 2. Install and build

Requires Node.js 18.17 or newer.

```bash
git clone https://github.com/dopplerDistortion/hevy-local-mcp.git
cd hevy-local-mcp
npm install        # also builds into dist/
```

Quick check (should print `running on stdio`, then wait; press Ctrl+C):

```bash
HEVY_API_KEY=your-key node dist/index.js
```

## 3. Register it with Claude Code

### Option A: user scope, key stored in your local Claude config (simplest)

Run this from the repo folder. It makes the server available in every project on this machine.

```bash
claude mcp add hevy --scope user \
  --env HEVY_API_KEY=your-key \
  -- node "$(pwd)/dist/index.js"
```

The key is saved in `~/.claude.json` on your machine only. To keep it out of your shell history, start the line with a space (in bash/zsh with `HISTCONTROL=ignorespace` / `setopt HIST_IGNORE_SPACE`) or use option B.

### Option B: read the key from your shell environment

Put the key in your shell profile (e.g. `~/.zshrc`):

```bash
export HEVY_API_KEY=your-key
```

Then add a `.mcp.json` to any project (or use `claude mcp add-json`). Claude Code expands `${HEVY_API_KEY}` when it starts the server, so the file itself contains no secret:

```json
{
  "mcpServers": {
    "hevy": {
      "command": "node",
      "args": ["/absolute/path/to/hevy-local-mcp/dist/index.js"],
      "env": { "HEVY_API_KEY": "${HEVY_API_KEY}" }
    }
  }
}
```

### Verify

```bash
claude mcp list          # hevy should show as connected
```

Inside Claude Code, `/mcp` shows the server and its tools. Try: *"What did I train this week?"* or *"Build me a 4-day upper/lower routine in a new folder called Winter Block."*

### Claude Desktop

Add the same block to `claude_desktop_config.json` (Settings → Developer → Edit Config), with the real key in `env` since Desktop does not expand shell variables, then restart Claude Desktop.

## Tools

| Area | Tools |
| --- | --- |
| User | `get_user_info` |
| Workouts | `list_workouts`, `get_workout`, `get_workout_count`, `get_workout_events`, `create_workout`, `update_workout` |
| Routines | `list_routines`, `get_routine`, `create_routine`, `update_routine` |
| Routine folders | `list_routine_folders`, `get_routine_folder`, `create_routine_folder` |
| Exercises | `search_exercise_templates`, `list_exercise_templates`, `get_exercise_template`, `create_exercise_template`, `get_exercise_history` |
| Body measurements | `list_body_measurements`, `get_body_measurement`, `create_body_measurement`, `update_body_measurement` |

Things worth knowing:

- **Weights are always kilograms** in the API. The server tells Claude to check your unit preference with `get_user_info` and convert.
- **Updates replace the whole object.** `update_workout`, `update_routine` and `update_body_measurement` overwrite everything, so Claude is instructed to read first and resend what should stay.
- **No deletes.** The Hevy API has no delete endpoints, so nothing here can delete your data.
- `search_exercise_templates` is a convenience tool not in the Hevy API: it downloads the exercise library once (cached for an hour) and filters by name, muscle group and equipment, so Claude can turn "incline dumbbell press" into a template id.
- Pages are capped at 10 items for most list endpoints (100 for exercise templates), as Hevy enforces.

## Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `HEVY_API_KEY` | yes | |
| `HEVY_BASE_URL` | no | `https://api.hevyapp.com` |

## Development

```bash
npm run build      # compile TypeScript to dist/
npm test           # build, then run end-to-end tests against a local mock API
```

The tests start the real server over stdio and point it at a mock HTTP server, so they never touch your Hevy account.
