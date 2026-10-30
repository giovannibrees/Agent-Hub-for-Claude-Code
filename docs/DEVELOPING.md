# Changing the hub

The hub is one page, `cloud/agent-hub.html`, built from the sources in `cloud/src/`:

| File | What is in it |
|---|---|
| `head.html` | Title and font links |
| `style.css` | All styles, light and dark |
| `body.html` | The page layout |
| `js/01-core.js` | Settings, helpers, text cleaning, protocol checks |
| `js/02-agents.js` | Agents list, one-click start, usage limits, brief helper |
| `js/03-projects.js` | Project cards, profiles, GitHub status, digest, cost and budget |
| `js/04-cards.js` | Cards and the main render |
| `js/05-actions.js` | Answers, Undo, Snooze, attachments, saving, messages |
| `js/06-events.js` | Clicks, typing and other page events |
| `js/07-data.js` | Database subscriptions and start-up |

The script files are joined in name order into one script, so they share one scope.

## Workflow

```bash
npm install        # once: installs Playwright for the tests
npm run build      # rebuilds cloud/agent-hub.html and the demo page
npm test           # fails if the built page is out of date, then runs the browser tests
```

Edit `cloud/src/`, never `cloud/agent-hub.html` directly. `npm test` runs 20 browser checks
against the demo's in-memory database: saving and its failures, Undo, Snooze, attachments, hidden
characters, search, one-click start, costs and budget, usage limits, the brief helper and the
layout at phone width and 200% zoom, in light and dark. Every change must pass them.

In a Claude Code cloud session Chromium is already installed. Elsewhere, run
`npx playwright install chromium` once.
