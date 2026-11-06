# Architecture

```
claude-counter/
├── manifest.json                    # Manifest V3, Chrome/Edge/Brave 111+ (load this folder unpacked)
├── icons/                           # icon-16 … icon-256
├── src/
│   ├── background/
│   │   └── service-worker.js        # Alt+Shift+C overlay toggle
│   ├── page/
│   │   └── page-bridge.js           # Runs inside claude.ai's page: reads its API traffic
│   └── content/                     # Runs in the extension's isolated world
│       ├── constants.js             # Selectors, model table (context window, API prices), themes
│       ├── bridge-client.js         # Messaging with page-bridge.js
│       ├── tokens.js                # Token estimate for the current conversation branch
│       ├── ui.js                    # Header pill, usage bars, panels
│       ├── main.js                  # Wiring: navigation, refresh timing, settings
│       └── content.css
├── tests/
│   ├── regression.html              # UI harness with mocked claude.ai data
│   └── run-regression.js            # Runs the harness in headless Chromium (npm test)
├── scripts/
│   ├── build.ps1                    # dist/claude-counter-<version>.zip (npm run build)
│   └── check-release.ps1            # Version and file checks (npm run check)
├── docs/                            # This file and the documentation page
├── .github/workflows/release.yml    # Builds and publishes the ZIP on a v* tag
├── CHANGELOG.md
├── LICENSE
├── package.json
└── README.md
```

## Data flow

1. `page-bridge.js` runs in claude.ai's own page (`"world": "MAIN"`) and wraps `fetch` to see the conversation tree, the reply stream and `/api/organizations/{org}/usage`.
2. It hands that data to the content scripts with `window.postMessage`.
3. `main.js` turns it into usage bars (exact figures) and a token estimate (`tokens.js`); `ui.js` draws them.

## Versioning and releases

- Semantic Versioning (`MAJOR.MINOR.PATCH`); the version lives in `manifest.json` and `package.json`.
- Add the release to `CHANGELOG.md`, bump both files, then tag `vX.Y.Z` and push: the workflow builds and publishes the ZIP.
