# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Pre-v0.1. M0 → M4 shipped: scaffolding, browsing basics (tabs, nav, URL bar, bookmarks, history), themes + profile menu, top-bar action cluster, Network Inspector (main-frame + subresource capture, per-origin blocking), BYO-AI providers (Anthropic via OS keychain), and the AI drawer (chat / summarize / search / save artifacts). In progress: **M2 Phase 3** — native subresource blocking via `WKContentRuleList` + `WKScriptMessageHandler`; and **M5** — Ollama wired as the default for chat/summarize, conversation history, Brave Search as alt provider. See `README.md` for the full milestone table.

Stack: Tauri 2.0 + Vite + React + TypeScript. Bundle identifier `sh.null.browser`, Cargo package `null`, lib `null_lib`. Build matrix targets macOS, Linux, Windows (macOS is the primary target today).

## Commands

| Task | Command |
|---|---|
| Install JS deps | `npm install` |
| Dev signing setup (macOS, one-time) | `npm run dev:setup` |
| Dev (launches desktop window) | `npm run tauri dev` |
| Build release bundles | `npm run tauri build` |
| Rust type-check only | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust lint (clippy) | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` |
| Frontend build | `npm run build` |
| Frontend dev server only | `npm run dev` |

Rust toolchain: stable, installed via `rustup`. If `cargo` isn't on `PATH`, run `source ~/.cargo/env` first.

Dev signing (macOS): `npm run dev:setup` creates a self-signed `null-dev` code-signing cert in the login keychain. `tauri dev` then routes through `scripts/cargo-signed.sh`, which codesigns every dev build with a stable designated requirement — so Keychain ACLs for stored provider keys survive rebuilds instead of re-prompting. Skip setup and you'll get a keychain prompt on every Rust rebuild; the wrapper falls through to plain cargo if no cert is present. No-op on Linux/Windows.

There are no tests yet. When they land, update the table. Do not invent commands that don't exist yet — if asked to "run the tests", check the state of the code first.

## The six invariants

Read `docs/PHILOSOPHY.md` before proposing anything that touches networking, storage, or AI routing. The six invariants in that document are not defaults — they are invariants. Code that violates them is a bug. Summarized:

1. Zero telemetry.
2. No default cloud connections. The browser must start and browse without contacting any service operated by this project or any third party other than the site the user is visiting.
3. All AI inference is local by default (Ollama). Cloud providers are opt-in, per-provider, per-call, and shown in the UI before the call leaves the device.
4. Every outbound connection is visible through the network inspector — the inspector is a first-class surface, not a devtool.
5. Data lives with the user: SQLite and JSON on disk, no mandatory sync, no account system.
6. No dark patterns: no forced onboarding, no engagement retention, no "Skip for now".

Do not soften these when writing code, comments, PR descriptions, or user-facing strings.

## The three questions

Any change that touches networking, storage, or AI routing must be able to answer, from the diff alone:

- What does this **store**?
- What does this **transmit**?
- What does this **remember**?

If a reviewer cannot answer those three from the diff, the change is not ready. When drafting a PR description for such a change, answer them explicitly.

## "Assist, don't complete"

The AI sidebar is a collaborator, not an agent. It does not click, type, or navigate on the user's behalf without per-action user approval. Treat any proposal for autonomous agent behavior as a feature that must be earned through explicit consent UX — never a default.

## Scope boundaries

- Null is **not a Chromium fork**. Do not propose vendoring Chromium or Gecko. The shell is Tauri; the web engine is the system WebView.
- Null has **no account system, no sync service, no telemetry endpoint**. Do not add one, even "optional", without an explicit decision recorded in `docs/PHILOSOPHY.md`.
- Target platforms for v0.1: macOS, Linux, Windows.

## Voice

User-facing copy and docs should match the register of `README.md` and `docs/PHILOSOPHY.md`: direct, declarative, no marketing cadence, no AI-sounding prose ("dive into", "seamlessly", "empower", em-dash-heavy rhythm). When in doubt, re-read those two files and match them.
