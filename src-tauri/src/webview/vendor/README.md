# Vendored JS for tab-side extraction

These files are injected into a tab's WebView via `webview.eval(...)` to
extract the main article content of the current page and convert it to
markdown for the AI pipeline. They are embedded into the Rust binary at
compile time via `include_str!`.

| File | Package | Version | License |
|---|---|---|---|
| `readability.js` | [@mozilla/readability](https://github.com/mozilla/readability) | 0.6.0 | Apache-2.0 |
| `turndown.js` | [turndown](https://github.com/mixmark-io/turndown) | 7.2.4 | MIT |

## Updating

```bash
npm install @mozilla/readability turndown
cp node_modules/@mozilla/readability/Readability.js   src-tauri/src/webview/vendor/readability.js
cp node_modules/turndown/dist/turndown.js             src-tauri/src/webview/vendor/turndown.js
```

Then bump versions in this README and commit.

## Why unminified

The binary cost is ~110 KB total. Keeping the source readable means we can
review every line of code we inject into untrusted tab contexts — the
extraction runs in the page's own JS environment, so any bug in these
libraries reflects on us. Audit > size at this scale.
