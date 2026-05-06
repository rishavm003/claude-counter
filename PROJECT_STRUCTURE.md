# Project Structure

This document explains the organization of the Claude Counter project.

## Folder Layout

```
claude-counter-0.4.2/
├── extension/           # Browser extension source code
│   ├── manifest.json    # Extension manifest (entry point)
│   ├── background.js    # Service worker (notifications, commands)
│   ├── styles.css       # Extension styles
│   ├── assets/          # Static assets (icons)
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
├── assets/             # Global static assets (source)
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
├── scripts/            # Build and utility scripts
│   └── build-release.ps1   # PowerShell script to create release files
├── dist/               # Built release files (not in git)
│   ├── claude-counter-0.4.2.zip      # Chrome/Edge extension
│   ├── claude-counter-0.4.2.xpi      # Firefox extension (unsigned)
│   └── claude-counter-0.4.2-source.zip # Full source code
├── .github/            # GitHub configuration
│   └── workflows/      # GitHub Actions
│       └── release.yml     # Auto-release on tag push
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

#### Creating Release Files

**Option 1: PowerShell Script (Windows)**
```powershell
.\scripts\build-release.ps1 -Version "0.4.2"
```

**Option 2: Manual ZIP Creation**
```bash
# Chrome/Edge extension
cd extension
zip -r ../dist/claude-counter-0.4.2.zip .

# Firefox XPI (unsigned)
zip -r ../dist/claude-counter-0.4.2.xpi .
```

**Option 3: Automatic (GitHub Actions)**
```bash
# Push a tag to trigger automatic release
git tag v0.4.2
git push origin v0.4.2
```

#### Uploading to GitHub Releases

1. Go to https://github.com/rishavm003/claude-counter/releases/new
2. Enter tag version (e.g., `v0.4.2`)
3. Title: `Claude Counter v0.4.2`
4. Upload files from `dist/` folder:
   - `claude-counter-0.4.2.zip` (Chrome/Edge)
   - `claude-counter-0.4.2.xpi` (Firefox)
   - `claude-counter-0.4.2-source.zip` (Source code)
5. Click "Publish release"
