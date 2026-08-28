// Capture the interface from the running dev server and compose the
// sheets in docs/screenshots/.
//
//   npm run dev          # in another terminal
//   node scripts/ui/shoot.mjs
//
// The chrome runs in an ordinary browser because `src/lib/fixtures.ts`
// stands in for the Rust backend when Tauri is absent, so every list and
// panel has plausible content without launching the app.
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, REPO } from './cdp.mjs';

const DOCS = path.join(REPO, 'docs/screenshots');
const SHOTS = path.join(DOCS, 'shots');
const APP = process.env.NULL_DEV_URL ?? 'http://localhost:1420/';
const W = 1280;
const H = 800;

const PALETTES = [
  ['aka', 'aka'],
  ['slate', 'Slate'],
  ['sand', 'Sand'],
  ['0400am', '0400AM'],
  ['mudd', 'Mudd'],
  ['cyberspace', 'Cyberspace'],
];

const STATES = [
  ['01-home', 'Home', 'A calendar of trackers seen sits above the recent notes: one cell per day, shaded by how many tracker requests the browser observed — a record of exposure, not a scoreboard of blocks.'],
  ['02-notes', 'Notes', 'A card dropped in from the toolbar: the page yields the width, the gutter separates them, and one control widens it to a half-window split.'],
  ['02b-note-viewer', 'Note', 'Markdown, rendered. The heading is dropped from the body because the header already carries it.'],
  ['03-history', 'History', 'Header and body share one measure, so the panel has a single left edge and a single right edge.'],
  ['04-network', 'Network', 'Every outbound connection, grouped by origin. Blocked origins are struck through.'],
  ['05-settings', 'Settings', 'A left rail names the sections and the content column takes its own measure beside them. The selected palette is haloed rather than tinted — a colour swatch cannot be marked with a colour.'],
  ['05b-settings-blocking', 'Blocking', 'The bundled rule list is one switch. Origins blocked by hand from the Network panel are listed beneath it, each with its own way back.'],
];

/**
 * What a new install looks like. `?empty=1` makes the fixtures resolve
 * every list empty — see `src/lib/fixtures.ts`. These are the first
 * screens a user sees and the last ones anyone opens on purpose.
 */
const EMPTY = [
  ['e1-home-empty', 'Home', 'Named directory, not a shrug. The path is where the files will actually be.'],
  ['e2-notes-empty', 'Notes', 'The capture buttons stay put, dimmed, so the surface does not rearrange once a clip exists.'],
  ['e3-history-empty', 'History', 'Left-aligned on the panel measure, like the populated state.'],
  ['e4-network-empty', 'Network', 'Says what the panel will contain and how blocking works, rather than only that it is empty.'],
];

const helpers = `
window.__click = (text) => {
  const el = [...document.querySelectorAll('button')]
    .find(b => (b.textContent || '').trim() === text);
  if (!el) throw new Error('no button: ' + text);
  el.click();
  return true;
};
window.__clickLabel = (label) => {
  const el = document.querySelector('[aria-label="' + label + '"]');
  if (!el) throw new Error('no aria-label: ' + label);
  el.click();
  return true;
};
`;

const settle = () => new Promise((r) => setTimeout(r, 350));

async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

if (!(await reachable(APP))) {
  console.error(`No dev server at ${APP}. Start one with \`npm run dev\`.`);
  process.exit(1);
}

// Launch before wiping. `shots/` is gitignored, so it is the only copy
// of the previous run — clearing it first means any failure after this
// point (no Chrome, a selector that stopped matching) leaves an empty
// directory and stale sheets.
const { kill, browserWs } = await launch();
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

try {
  const page = await Page.create(browserWs, { width: W, height: H });
  await page.addInitScript(helpers);

  async function load(palette, mode) {
    await page.addInitScript(
      `try{localStorage.setItem('null.palette',${JSON.stringify(palette)});` +
        `localStorage.setItem('null.mode',${JSON.stringify(mode)});}catch(e){}`,
    );
    await page.goto(APP);
    await page.waitFor(`document.querySelector('[aria-label="Sidebar"]')`);
    await settle();
  }

  async function shot(name) {
    await settle();
    // The app focuses the URL bar on a new tab, and a focused field wears
    // the accent ring. Correct behaviour, but not the resting state — and
    // it would put an accent stroke in every frame.
    await page.eval(`document.activeElement && document.activeElement.blur(), 1`);
    await settle();
    await page.screenshot(path.join(SHOTS, `${name}.png`));
    console.log('  ' + name);
  }

  console.log('surfaces (aka dark)');
  await load('aka', 'dark');
  await shot('01-home');

  await page.eval(`__clickLabel('Notes')`);
  await shot('02-notes');

  // Named against a fixture title, so say so when the fixture changes
  // rather than throwing "Cannot read properties of undefined".
  await page.eval(
    `(() => {
       const t = 'Kraa · Digitally Shaped';
       const el = [...document.querySelectorAll('aside[aria-label="Notes"] button')]
         .find(b => b.textContent.includes(t));
       if (!el) throw new Error('no note row matching ' + JSON.stringify(t) +
         ' — has src/lib/fixtures.ts changed?');
       el.click();
       return 1;
     })()`,
  );
  await shot('02b-note-viewer');
  await page.eval(`__clickLabel('Back to notes')`);
  await page.eval(`__clickLabel('Notes')`);

  await page.eval(`__clickLabel('History')`);
  await shot('03-history');

  await page.eval(`__clickLabel('Network')`);
  await shot('04-network');

  await page.eval(`__clickLabel('Settings')`);
  await shot('05-settings');

  await page.eval(`__click('Blocking')`);
  await shot('05b-settings-blocking');

  console.log('empty states');
  await page.goto(APP + '?empty=1');
  await page.waitFor(`document.querySelector('[aria-label="Sidebar"]')`);
  await settle();
  await shot('e1-home-empty');
  await page.eval(`__clickLabel('Notes')`);
  await shot('e2-notes-empty');
  await page.eval(`__clickLabel('Notes')`);
  await page.eval(`__clickLabel('History')`);
  await shot('e3-history-empty');
  await page.eval(`__clickLabel('Network')`);
  await shot('e4-network-empty');

  for (const [id, label] of PALETTES) {
    for (const mode of ['dark', 'light']) {
      console.log(`${label} ${mode}`);
      await load(id, mode);
      // Light frames show a panel open, so the unfocused selection state
      // (grey bar, on the tab) is visible beside the focused one.
      if (mode === 'light') await page.eval(`__clickLabel('Notes')`);
      await shot(`palette-${id}-${mode}`);
    }
  }

  page.s.close();
} finally {
  kill();
}

// ── sheets ───────────────────────────────────────────────────────────

const b64 = (f) => fs.readFileSync(path.join(SHOTS, f + '.png')).toString('base64');

const STYLE = `
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 40px 40px 48px; background: #0a0a0a; color: #ededed;
    font: 400 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  h1 {
    margin: 0 0 6px; font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11px; font-weight: 500; letter-spacing: .14em;
    text-transform: uppercase; color: #a1a1a1;
  }
  p.lede { margin: 0 0 32px; max-width: 66ch; color: #a1a1a1; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px 24px; }
  figure { margin: 0; }
  img {
    display: block; width: 100%; height: auto;
    border: 1px solid rgba(255,255,255,.16); border-radius: 8px;
  }
  figcaption { margin-top: 10px; }
  .k {
    display: block; margin-bottom: 3px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10px;
    font-weight: 500; letter-spacing: .14em; text-transform: uppercase;
    color: #8a8a8a;
  }
  .d { color: #a1a1a1; }
`;

/**
 * Render an HTML sheet to a single PNG.
 *
 * Sheets are laid out in two columns deliberately: a single column of
 * six 1600px-tall frames produces a ~9400px image, which several upload
 * paths reject outright.
 */
async function sheet({ file, width, title, lede, body }) {
  const html = `<!doctype html><meta charset="utf-8"><style>${STYLE}</style>
<h1>${title}</h1><p class="lede">${lede}</p><div class="grid">${body}</div>`;
  const tmp = path.join(DOCS, '.sheet.html');
  fs.writeFileSync(tmp, html);

  const { kill: killSheet, browserWs: ws } = await launch();
  try {
    const page = await Page.create(ws, { width, height: 900 });
    await page.goto('file://' + tmp);
    await page.waitFor(`[...document.images].every(i => i.complete)`);
    const { contentSize } = await page.send('Page.getLayoutMetrics');
    await page.setViewport(
      Math.ceil(contentSize.width),
      Math.ceil(contentSize.height),
      1,
    );
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot(file);
    page.s.close();
  } finally {
    killSheet();
    fs.rmSync(tmp, { force: true });
  }
  console.log(`${path.relative(REPO, file)}  ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}

await sheet({
  file: path.join(DOCS, 'states.png'),
  width: 1180,
  title: 'Null · surfaces',
  lede:
    'Captured from the running interface in the default palette. Every panel ' +
    'takes the same measure as its own header, so titles line up with the ' +
    'rows beneath them instead of sitting alone at the window edge.',
  body: STATES.map(
    ([f, k, d]) => `<figure>
      <img src="data:image/png;base64,${b64(f)}" alt="${k}">
      <figcaption><span class="k">${k}</span><span class="d">${d}</span></figcaption>
    </figure>`,
  ).join('\n'),
});

await sheet({
  file: path.join(DOCS, 'empty-states.png'),
  width: 1180,
  title: 'Null · empty states',
  lede:
    'What a new install shows. Every panel keeps the same left edge empty ' +
    'as full, so nothing rearranges when the first item arrives, and each ' +
    'message says what the surface will hold rather than only that it is ' +
    'currently empty.',
  body: EMPTY.map(
    ([f, k, d]) => `<figure>
      <img src="data:image/png;base64,${b64(f)}" alt="${k}">
      <figcaption><span class="k">${k}</span><span class="d">${d}</span></figcaption>
    </figure>`,
  ).join('\n'),
});

await sheet({
  file: path.join(DOCS, 'palettes.png'),
  width: 1500,
  title: 'Null · palettes',
  lede:
    'Six palettes, both modes, captured from the running interface. Dark ' +
    'frames show Home; light frames have the Notes card open, so the ' +
    'unfocused selection state (grey bar, on the tab) sits next to the ' +
    'focused one (accent bar, on Notes).',
  body: PALETTES.flatMap(([id, label]) =>
    ['dark', 'light'].map(
      (m) => `<figure>
        <img src="data:image/png;base64,${b64(`palette-${id}-${m}`)}" alt="${label} ${m}">
        <figcaption><span class="k">${label} · ${m}</span></figcaption>
      </figure>`,
    ),
  ).join('\n'),
});
