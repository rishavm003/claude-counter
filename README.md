# 📊 Claude Counter

[![GitHub](https://img.shields.io/badge/GitHub-rishavm003/claude--counter-blue?logo=github)](https://github.com/rishavm003/claude-counter)
[![Version](https://img.shields.io/badge/version-0.4.2-green)](https://github.com/rishavm003/claude-counter/releases)

**Claude Counter** is a premium, lightweight browser extension designed to provide real-time usage insights and token analytics directly within the **claude.ai** interface. It empowers power users to track their limits with precision and a sleek, integrated aesthetic.

---

## ✨ Key Features

### 🚀 Real-Time Usage Tracking
- **Smart Usage Bars**: View your exact Session (5-hour) and Weekly (7-day) utilization percentages with high-fidelity progress bars.
- **Reset Timers**: Know exactly when your limits will refresh with live countdowns integrated into the UI.

### 🧠 Advanced Token Analytics
- **Live Token Counting**: Track conversation length against the 200k context limit using an accurate, on-device tokenizer.
- **Historical Dashboard**: Access a systematic analytics panel (📊) to visualize your peak usage trends over the last 7 days.

### 💎 Premium Design
- **Glassmorphism UI**: A modern interface featuring smooth gradients and translucent backgrounds that blend seamlessly with Claude's native design.
- **Performance Optimized**: Built for speed with zero impact on page load times or responsiveness.

---

## 🛠️ Installation

### Chrome / Edge / Chromium

1.  **Download**: Get the latest release [`claude-counter-v0.4.2-latest.zip`](https://github.com/rishavm003/claude-counter/releases/download/v0.4.2/claude-counter-v0.4.2-latest.zip).
2.  **Developer Mode**: Navigate to `chrome://extensions` and toggle **Developer mode** (top right).
3.  **Install**: Simply drag and drop the downloaded ZIP file anywhere onto the extensions page.

---

## 🔍 Technical Overview

- **Smart Interception**: Uses a sophisticated bridge to intercept Claude's internal API responses, providing unrounded, exact usage data.
- **Universal Compatibility**: Features a resilient detection engine that works across all Claude organizational and conversation URL structures.
- **Local-First Architecture**: All calculations and storage happen locally. Your conversation data never leaves your browser.

---

## 🛡️ Privacy & Security

- **Zero Tracking**: No external analytics, trackers, or remote servers.
- **Secure Access**: Interacts only with `claude.ai` endpoints using your existing session authentication.
- **Open Source**: Fully transparent codebase for community audit and contribution.

---

## 🤝 Acknowledgments

- **Tokenization**: Powered by [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer).
- **Inspiration**: Inspired by community-driven efforts to enhance the Claude user experience.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
