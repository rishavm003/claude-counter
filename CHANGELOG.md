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

### Added
- Plan badge for paid plans (Pro, Max 5x, Max 20x, Team/Enterprise; hidden on Free), Max per-model weekly caps, extra-usage credits, weekly usage by product.
- Model-aware context window and API-equivalent cost (clearly labelled as an estimate).
- Breakdown card lists what the token estimate does not include.

### Changed
- Much lower overhead while Claude is typing: page updates are batched (≤ one pass per 200 ms), no work in background tabs, and the conversation claude.ai already downloaded is reused.
- Usage refreshes from the authoritative endpoint after each reply.
- Project restructured: `extension/icons`, `src/background`, `src/page`, `src/content`; `LICENSE` at the root; `package.json`, `CHANGELOG.md`, `.editorconfig`.

### Removed
- Firefox build, userscript build, stale `dist/` artifacts, duplicate root `assets/`, unused hashing code and verbose console logging.

[1.0.0]: https://github.com/rishavm003/claude-counter/releases/tag/v1.0.0
