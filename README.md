# 📊 Claude Counter

[![GitHub](https://img.shields.io/badge/GitHub-rishavm003/claude--counter-blue?logo=github)](https://github.com/rishavm003/claude-counter)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/rishavm003/claude-counter/releases)

A lightweight extension for **Chrome, Microsoft Edge and Brave** that shows your real claude.ai usage limits and an estimated token count for the current chat, right inside claude.ai. Works on Free, Pro and Max plans.

## What it shows

| Item | Source | Accuracy |
| --- | --- | --- |
| **Session (5-hour) and Weekly (7-day) usage %**, with reset countdowns | claude.ai's own usage endpoint | Exact |
| **Plan badge** (Pro / Max; hidden on Free) and Max per-model weekly caps, extra-usage credits | your organization's settings | Exact |
| **Tokens in this chat** and context bar | counted locally from the conversation | Estimate (~±15%); excludes system prompt, project knowledge, images/PDFs |
| **API-equivalent cost** | estimated tokens × API list price | Rough; Pro/Max plans are not billed per token |
| **Cache timer** | 5 minutes from the last reply | Assumed window |

## Install (Chrome, Edge, Brave)

1. Download `claude-counter-1.0.0.zip` from the latest release and unzip it (or use the `extension/` folder of this repo).
2. Open `chrome://extensions` (Chrome), `edge://extensions` (Edge) or `brave://extensions` (Brave).
3. Turn on **Developer mode**, click **Load unpacked**, and pick the unzipped folder.

Requires Chrome / Edge / Brave 111 or newer. Toggle the overlay with **Alt+Shift+C**. Choose **Appearance** (Auto / Light / Dark) and **Accent Colour** under Settings.

## Using it on another PC

Nothing in the extension is tied to a machine, account or folder path: it finds your claude.ai organization and plan by itself.

- **Install from a release ZIP**, not the repository: unzip `claude-counter-<version>.zip` and choose that folder in **Load unpacked**. When loading from the repository, choose the `extension` folder (the one containing `manifest.json`), not the project root.
- **Settings follow you.** They are stored with your browser account (Chrome/Edge/Brave sync), so the same appearance, accent colour and options appear on every PC where you're signed in to the browser with sync on.
- **Usage history and the error log stay on each PC** (they are too large for sync). Use **Settings → Export / Import Data** to carry them over.
- **For one-click installs and automatic updates**, publish to the Chrome Web Store (works for Chrome and Brave) and Microsoft Edge Add-ons; then every PC installs it from the store with no files to copy.

## Performance

- No extra tokens: it never calls the model, and reading usage doesn't count against your limits.
- Reuses the conversation claude.ai already downloaded; fetches it only if the page didn't.
- One small usage request after each reply; nothing runs in background tabs.
- Page changes while Claude is typing are batched (at most one update every 200 ms).

## Privacy

No remote servers, analytics or trackers. It talks only to `claude.ai` with your existing session, and everything is stored locally in your browser.

## Development

- Load `extension/` unpacked as above; there is no build step.
- Tests: `npm install` once, then `npm test`.
- Release ZIP: `npm run build` (PowerShell 7), or push a `v*` tag to build it on GitHub.
- Version lives in `extension/manifest.json` and `package.json`; `npm run check` verifies they match. See `CHANGELOG.md`.

## License

MIT. See [`LICENSE`](LICENSE).
