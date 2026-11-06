# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-06

First stable release. Supported browsers: Chrome, Microsoft Edge and Brave (Chromium 111+).

### Fixed
- Usage at 1% or below was shown as 100% (values were wrongly scaled).
- Pro accounts that also have an API organization saw no usage bars: the API org was picked and returned 403.
- Session and weekly reset countdowns never ticked (a duplicate `tick()` overrode the real one).
- The page bridge could load after claude.ai cached `fetch`; it now runs in the page at document start.
- Time-to-first-token now measures the first text token, not the first network byte.
- Buttons and header text were unreadable on claude.ai's light theme; the Settings Close button was invisible.
- The bar, header pill and panels now follow claude.ai's light or dark theme automatically.
- With no usage data the bars showed full; they now start empty, and the bar says why usage is unavailable (details in Status).

### Added
- Plan badge for paid plans (Pro, Max 5x, Max 20x, Team/Enterprise; hidden on Free), Max per-model weekly caps, extra-usage credits, weekly usage by product.
- Appearance setting: Auto (match claude.ai), Light or Dark; "Color Theme Preset" renamed Accent Colour.
- Settings sync across PCs with the browser account (Chrome/Edge/Brave sync), applied live in every tab.
- Model-aware context window and API-equivalent cost (clearly labelled as an estimate).
- Breakdown card lists what the token estimate does not include.

### Changed
- Much lower overhead while Claude is typing: page updates are batched (≤ one pass per 200 ms), no work in background tabs, and the conversation claude.ai already downloaded is reused.
- Usage refreshes from the authoritative endpoint after each reply.
- Project restructured: `manifest.json` at the repository root (load the project folder directly), `icons/`, `src/background`, `src/page`, `src/content`; `LICENSE` at the root; `package.json`, `CHANGELOG.md`, `.editorconfig`.

### Removed
- Firefox build, userscript build, stale `dist/` artifacts, duplicate root `assets/`, unused hashing code and verbose console logging.

[1.0.0]: https://github.com/rishavm003/claude-counter/releases/tag/v1.0.0
