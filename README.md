# Claude Counter

[![GitHub](https://img.shields.io/badge/GitHub-rishavm003/claude--counter-blue?logo=github)](https://github.com/rishavm003/claude-counter)
[![Version](https://img.shields.io/badge/version-0.4.2-green)](https://github.com/rishavm003/claude-counter/releases)

A premium browser extension that shows token count, cache timer, and advanced usage analytics on **claude.ai**.

## Features

- **Premium UI Redesign** — Modern glassmorphism interface with vibrant gradients that blend perfectly with Claude's theme.
- **Smart Token Count** — Real-time token tracking with a sleek progress bar against the 200k context limit.
- **Usage Analytics** — Advanced dashboard (📊) showing peak session utilization over the last 7 days.
- **Reset Countdown** — Live timers showing exactly when your session and weekly limits will refresh.
- **Integrated Stats** — Session (5-hour) and weekly (7-day) usage bars right inside your chat box.
- **Latency Tracking** — Monitors "Time to First Token" (TTFT) and total generation speed.

## Installation

**Chrome / Edge / Chromium**

1. Download [`claude-counter-v0.4.2-latest.zip`](https://github.com/rishavm003/claude-counter/releases/download/v0.4.2/claude-counter-v0.4.2-latest.zip) from [GitHub Releases](https://github.com/rishavm003/claude-counter/releases)
2. Go to `chrome://extensions` and enable **Developer mode**
3. Drag and drop the downloaded ZIP file onto the page

**Firefox**

1. Download the latest `.xpi` from [GitHub Releases](https://github.com/rishavm003/claude-counter/releases)
2. Drag it into any Firefox window and click **Add**

## How it works

- **Smart Detection**: Automatically finds your account ID and usage data even on the latest Claude URL layouts.
- **API Interception**: Safely reads Claude's internal responses to provide unrounded, exact usage percentages.
- **Privacy First**: No external servers. All tokenization and data processing happen entirely within your browser.

## Credits

- Token counting via [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer)
- Inspired by the community effort to track LLM usage limits.

## Development

See [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for folder organization.

### Quick Start

```bash
# Clone the repo
git clone https://github.com/rishavm003/claude-counter.git

# Load unpacked in Chrome:
# 1. Go to chrome://extensions (Developer mode ON)
# 2. Click "Load unpacked" and select the /extension folder
```

## License

MIT
