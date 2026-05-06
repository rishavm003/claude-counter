# Project Structure

This document explains the organization of the Claude Counter project.

## Folder Layout

```
claude-counter-0.4.2/
├── extension/           # Browser extension source code
│   ├── manifest.json    # Extension manifest (entry point)
│   ├── background.js    # Service worker (notifications, commands)
│   ├── styles.css       # Extension styles
│   ├── content/         # Content scripts (runs on claude.ai pages)
│   │   ├── constants.js     # DOM selectors and constants
│   │   ├── bridge-client.js # Communication with injected script
│   │   ├── tokens.js        # Token counting logic
│   │   ├── ui.js            # UI component creation and updates
│   │   └── main.js          # Main content script orchestration
│   ├── injected/        # Injected scripts (runs in page context)
│   │   └── bridge.js        # Intercepts Claude's API calls
│   └── vendor/          # Third-party code
│       └── o200k_base.js    # Tokenizer (from gpt-tokenizer)
├── assets/             # Static assets (icons, images)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon96.png
│   ├── icon128.png
│   ├── icon256.png
│   └── icon.png
├── userscript/         # Userscript version
│   └── claude-counter.user.js
├── docs/               # Documentation and legal files
│   ├── index.html      # Documentation page
│   ├── LICENSE         # MIT License
│   └── THIRD_PARTY_NOTICES.md
├── README.md           # Main project documentation
├── PROJECT_STRUCTURE.md # This file
└── .gitignore          # Git ignore rules
```

## How It Works

### Extension Architecture

1. **Content Scripts** (`extension/content/`)
   - Run in the context of claude.ai pages
   - Have limited access to page JavaScript
   - Communicate with the background script and injected script

2. **Injected Scripts** (`extension/injected/`)
   - Run directly in the page's JavaScript context
   - Can intercept and modify page APIs (like `fetch`)
   - `bridge.js` captures Claude's API responses for usage data

3. **Background Script** (`extension/background.js`)
   - Service worker that runs independently of web pages
   - Handles browser notifications and keyboard shortcuts

4. **Vendor Code** (`extension/vendor/`)
   - Third-party libraries (tokenizer for counting tokens)

## Development

### Loading the Extension

**Chrome/Edge:**
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` folder

**Firefox:**
1. Go to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select `extension/manifest.json`

### Building

No build step required for the extension - it's vanilla JavaScript.

For the userscript version, see future build instructions.
