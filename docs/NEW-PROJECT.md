# New project, new hub

Every project gets its own hub page: its own cards, agents, tasks and database, so nothing mixes
with other projects. The hub's **Add project** button (and the "Start it as a new project" offer)
gives you a request to paste into Claude Code. Claude then follows the steps below.

## Steps for Claude

1. Build the page: in this repo, `npm run build`.
2. Make the page file: copy `cloud/agent-hub.html` and change its `<title>` to the project's
   name in words plus "Hub", for example "Recipe Box Hub".
3. Publish it as a new artifact with these capabilities:
   `{"db": {}, "assets": {}, "mcp": {"servers": [{"server": "Claude Code Remote", "tools": ["list_environments", "create_session", "get_session", "create_trigger", "fire_trigger"]}]}}`.
4. Replace `HUB_URL_PLACEHOLDER` in the file with the new artifact's URL and publish again to the
   same URL. Agents read this URL in their start lines.
5. Seed the new hub's database (ArtifactData): copy `config/protocol`, `config/roles`,
   `config/alerts` and `config/alert-relay`, and every document in `lessons`, from the hub named
   in the request. Then `set` `projects/<name>` (name, goal, brief, repo, kind, live_url, branch,
   priority, phase `planning`, lead, agents, created_at) and one `agents/<agent>-<name>` doc per
   agent with `state: "registered"`.
6. Start the agents, lead first, with `create_session` (the start line from the page's
   `startLine`, with the new hub URL), then write each `session_id` and `started_at` to its agents
   doc. If the page is blocked from starting sessions, this step is how agents start.
7. Connect it to the overview page: in the new hub `set` `config/overview` with
   `{"url": "<overview page url>", "hub_url": "<new hub url>"}` (copy the overview url from the
   hub named in the request), and on the overview page `set` `hubs/<project>` with
   `{project, hub_url, phase: "planning", needs_you: 0, updated_at}`. The watchdog reads the
   overview's hub list every hour, so it now wakes this project's agents too.
8. Reply with the new hub link. The CEO opens it once and allows the database and the Claude Code
   Remote connector.

