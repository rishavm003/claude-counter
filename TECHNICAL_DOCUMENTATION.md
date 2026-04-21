# Claude Counter Pro: Technical Documentation

## Overview
Claude Counter Pro is a sophisticated browser extension for `claude.ai` that transforms the native token counter into a comprehensive performance and usage monitoring suite. It provides real-time metrics, historical analytics, and per-message token tracking without noticeably impacting browser performance.

---

## 🏗️ Architecture

The extension follows a multi-layered architecture to safely interact with Claude's React-based frontend and SSE (Server-Sent Events) backends.

### 1. Injected Script (`src/injected/bridge.js`)
*   **Purpose**: Runs in the execution context of the page to intercept native `fetch` requests.
*   **Responsibility**:
    *   Wraps the `fetch` API to detect conversation message streams.
    *   Monitors SSE chunks to calculate **TTFT (Time to First Token)** and total generation duration.
    *   Detects "thinking" segments and tool calls in real-time.
    *   Communicates with the Content Script via `window.postMessage`.

### 2. Content Scripts
*   **`main.js`**: Orchestrates the extension logic. Manages state (Usage History, Settings) and bridges the UI with the Background Worker.
*   **`tokens.js`**: Pure logic for token calculation. Uses a heuristic model to categorize tokens into:
    *   **Text**: Standard prompt and response content.
    *   **Attachments**: PDF/Code/Image context.
    *   **Tools**: "Thinking" blocks and tool execution overhead.
*   **`ui.js`**: Renders the symmetrical horizontal overlay, per-message badges, and the Analytics Dashboard.
*   **`constants.js`**: Centralized configuration for DOM selectors and visual design tokens.

### 3. Background Service Worker (`src/background.js`)
*   **Purpose**: Runs persistently in the browser background.
*   **Responsibility**:
    *   Monitors usage thresholds (80% and 95%).
    *   Triggers native OS notifications when usage is high.
    *   Manages background synchronization of settings across browser sessions.

---

## 🚀 Advanced Features

### Real-Time Performance Tracking
By intercepting the SSE stream at the network level, the extension provides:
- **TTFT (Time to First Token)**: Instant feedback on model latency.
- **Generation Speed**: Visualized as "Time: X.s" in the header.

### Usage History & Analytics
- **Data Persistence**: usage snapshots are recorded every 15 minutes in `chrome.storage.local`.
- **Analytics Dashboard**: A custom-built chart UI (accessible via 📊) that visualizes peak utilization trends over the last 7 days.

### Per-Message Cost Tracking
- Heuristically identifies message bubbles in the DOM and injects badges showing the specific token weight of each interaction.

---

## 🎨 Design System
The UI is built with vanilla CSS + Glassmorphism:
- **Responsive Symmetry**: Horizontal usage row that adapts to container width.
- **Visual Contrast**: High-contrast blue fills with animated markers showing time progress vs. utilization.
- **Theme Awareness**: Dynamically detects Claude's Dark/Light mode via MutationObservers and updates SVG/Stroke colors instantly.

---

## 🛠️ Tooling & Stack
- **Languages**: HTML5, CSS3, ES6+ Javascript.
- **Permissions**: `storage`, `notifications`, `host_permissions: ["https://claude.ai/*"]`.
- **Deployment**: Manifest V3 compliant.
