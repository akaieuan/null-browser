// Audit — and optionally repair — the contrast relationships in every
// palette block of src/index.css.
//
//   npm run dev                       # in another terminal
//   node scripts/ui/tokens.mjs        # report
//   node scripts/ui/tokens.mjs --write  # solve and rewrite src/index.css
//
// Colours are resolved by painting them into a 1x1 canvas in a real
// browser and reading the pixel back. Parsing the stylesheet cannot do
// this: some palettes are authored in hex and some in oklch, `--border`
// carries alpha that must be composited before it means anything, and
// modern Chrome round-trips `oklch()` through getComputedStyle verbatim.
// Whatever the canvas paints is what the screen gets.
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, REPO } from './cdp.mjs';

const CSS = path.join(REPO, 'src/index.css');
const APP = process.env.NULL_DEV_URL ?? 'http://localhost:1420/';
const WRITE = process.argv.includes('--write');

/**
 * Targets carry headroom over the WCAG line. Tokens are authored in
 * oklch and rendered to 8-bit sRGB, so a value solved to exactly 4.50
 * can quantise to 4.48 on screen.
 */
const TARGET = {
  /** Body and secondary text. */
  text: 4.6,
  /**
   * Control boundaries — the edge of an input, an outline button, a
   * popover. WCAG 1.4.11 asks 3:1 for these; held a little above so
   * they survive on both grounds.
   *
   * This target is why the interface once drew a 3:1 rule between every
   * pair of list rows: `--border` was the only division token, so the
   * number meant for a text field's edge ended up under every row of a
   * list. 1.4.11 does not cover a separator between two rows of text.
   * Row division is `--seam` now, which is not audited — see the note
   * beside it in src/index.css. Do not add it here.
   */
  border: 2.55,
  /** How far a surface may sit from the ground it rests on. A --muted
      further away than this is a mid-tone, not a surface: it reads as a
      painted slab, and everything layered on it has to be re-solved. */
  surface: 1.6,
  /** Body text against its own ground. */
  body: 7,
};

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) =>
  0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);

/** Composite a possibly-translucent colour over an opaque ground. */
const over = ([r, g, b, a], bg) => {
  const f = (a ?? 255) / 255;
  return [
    r * f + bg[0] * (1 - f),
    g * f + bg[1] * (1 - f),
    b * f + bg[2] * (1 - f),
  ];
};

function ratio(fg, bg) {
  const f = lum(over(fg, bg));
  const b = lum(bg);
  const [hi, lo] = f > b ? [f, b] : [b, f];
  return (hi + 0.05) / (lo + 0.05);
}

const TOKENS = [
  'background', 'foreground', 'muted', 'muted-foreground',
  'border', 'select', 'subtle',
];

const { kill, browserWs } = await launch();
let css = fs.readFileSync(CSS, 'utf8');
const edits = [];
const problems = [];

try {
  const page = await Page.create(browserWs, { width: 800, height: 600 });
  await page.goto(APP);
  await page.waitFor(`document.querySelector('[aria-label="Sidebar"]')`);

  /** Paint colour strings and read the pixels back. */
  const paint = (colors) =>
    page.eval(`(() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      return ${JSON.stringify(colors)}.map(c => {
        ctx.clearRect(0,0,1,1);
        ctx.fillStyle = c;
        ctx.fillRect(0,0,1,1);
        return [...ctx.getImageData(0,0,1,1).data];
      });
    })()`);

  const blocks = [
    ...css.matchAll(
      /(:root(?:,\s*:root)?\[data-palette="([^"]+)"\]\[data-mode="([^"]+)"\]\s*\{)([\s\S]*?)(\n\})/g,
    ),
  ];

  console.log(
    'palette'.padEnd(12), 'mode'.padEnd(6),
    '  bg/mut  border  subtle  select  sel/mut  fg/bg   mutfg',
  );
  console.log('-'.repeat(78));

  for (const b of blocks) {
    const [, , palette, mode, body] = b;
    const id = `${palette} ${mode}`;
    const read = (n) => {
      const m = body.match(new RegExp(`--${n}:\\s*([^;]+);`));
      return m ? m[1].trim() : null;
    };

    // A missing token must be an error, not a silent misreport. Per the
    // canvas spec an unparseable `fillStyle` leaves the previous value
    // in place, and `clearRect` does not reset it — so `null` here would
    // read back the *previous* token's colour and print a plausible
    // ratio for a token that does not exist.
    const missing = TOKENS.filter((t) => read(t) === null);
    if (missing.length) {
      problems.push(`${id}: missing ${missing.map((t) => `--${t}`).join(', ')}`);
      continue;
    }

    const px = Object.fromEntries(
      (await paint(TOKENS.map(read))).map((v, i) => [TOKENS[i], v]),
    );
    const bg = px.background.slice(0, 3);
    const mut = over(px.muted, bg);

    const m = {
      bgMut: ratio(px.muted, bg),
      border: ratio(px.border, bg),
      subtle: ratio(px.subtle, bg),
      select: ratio(px.select, bg),
      selMut: ratio(px.select, mut),
      fgBg: ratio(px.foreground, bg),
      mutFg: ratio(px['muted-foreground'], bg),
    };
    const n = (v, w = 6) => v.toFixed(2).padStart(w);
    console.log(
      palette.padEnd(12), mode.padEnd(6),
      n(m.bgMut), n(m.border), n(m.subtle), n(m.select), n(m.selMut, 7),
      n(m.fgBg), n(m.mutFg),
    );

    // Faults that need a human: changing these changes the palette's
    // identity, so they are reported rather than solved.
    if (m.bgMut > TARGET.surface) {
      problems.push(
        `${id}: --muted is ${m.bgMut.toFixed(2)}:1 off --background — that is a ` +
        `mid-tone, not a surface. Move it within ~${TARGET.surface}:1 of the ground ` +
        `and match the ground's hue at low chroma.`,
      );
    }
    if (m.border < TARGET.border) {
      problems.push(`${id}: --border only ${m.border.toFixed(2)}:1 (raise its alpha or lightness)`);
    }
    if (m.fgBg < TARGET.body) {
      problems.push(`${id}: --foreground only ${m.fgBg.toFixed(2)}:1`);
    }

    /**
     * Binary-search the L channel of an oklch() token until `score`
     * clears `target`. Which way is uphill is measured, not assumed —
     * half these palettes are light, where raising lightness lowers
     * contrast.
     */
    async function solve(name, value, score, target) {
      const parsed = value?.match(/^oklch\(\s*([\d.]+)([\s\S]*)\)$/);
      if (!parsed) return null;
      const [, L0, rest] = parsed;
      const at = async (L) => score((await paint([`oklch(${L.toFixed(3)}${rest})`]))[0]);

      const start = parseFloat(L0);
      if ((await at(start)) >= target) return null;

      const up = await at(Math.min(1, start + 0.1));
      const down = await at(Math.max(0, start - 0.1));
      if (Math.max(up, down) < target) {
        problems.push(`${id}: --${name} cannot reach ${target}:1 by lightness alone`);
        return null;
      }

      let lo = start;
      let hi = up > down ? 1 : 0;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if ((await at(mid)) >= target) hi = mid;
        else lo = mid;
      }
      console.log(`  ↳ --${name} ${start.toFixed(3)} → ${hi.toFixed(3)} (${(await at(hi)).toFixed(2)}:1)`);
      return `oklch(${hi.toFixed(3)}${rest})`;
    }

    const next = {};
    const subtle = await solve('subtle', read('subtle'), (p) => ratio(p, bg), TARGET.text);
    if (subtle) next.subtle = subtle;

    // --select lands on the background and on --muted. Score the harder
    // of the two, so fixing one cannot quietly break the other.
    const select = await solve(
      'select',
      read('select'),
      (p) => Math.min(ratio(p, bg), ratio(p, mut)),
      TARGET.text,
    );
    if (select) {
      // --ring tracks --select only where the author already kept them
      // identical. Overwriting it unconditionally would silently destroy
      // a deliberate divergence — a --ring carrying alpha, say.
      next.select = select;
      if (read('ring') === read('select')) next.ring = select;
      else problems.push(`${id}: --select moved; --ring differs and was left alone`);
    }

    const mutedFg = await solve(
      'muted-foreground',
      read('muted-foreground'),
      (p) => ratio(p, bg),
      TARGET.text,
    );
    if (mutedFg) next['muted-foreground'] = mutedFg;

    if (Object.keys(next).length) {
      let out = body;
      for (const [k, v] of Object.entries(next)) {
        out = out.replace(new RegExp(`(--${k}:\\s*)([^;]+)(;)`), `$1${v}$3`);
      }
      edits.push({ from: b[0], to: b[1] + out + b[5] });
    }
  }
  page.s.close();
} finally {
  kill();
}

console.log();
if (problems.length) {
  console.log('needs a decision:\n' + problems.map((p) => '  ' + p).join('\n') + '\n');
}
let wrote = false;
if (!edits.length) {
  console.log(problems.length ? 'no automatic fixes available' : 'all checks pass');
} else if (WRITE) {
  // Re-read before writing. `css` was captured before the browser
  // launched and before a few hundred solver round-trips; the documented
  // workflow has a dev server running in another terminal, so the author
  // may well have edited the file in between. Writing the stale snapshot
  // back would discard that silently.
  if (fs.readFileSync(CSS, 'utf8') !== css) {
    console.error(
      `${path.relative(REPO, CSS)} changed while the audit was running — ` +
        'nothing written. Re-run to solve against the current file.',
    );
    process.exit(1);
  }
  for (const e of edits) css = css.replace(e.from, e.to);
  fs.writeFileSync(CSS, css);
  wrote = true;
  console.log(`rewrote ${edits.length} block(s) in ${path.relative(REPO, CSS)}`);
} else {
  console.log(`${edits.length} block(s) would change — re-run with --write`);
}

// A successful --write is a success even when unsolvable problems remain
// to be decided by hand; those were already printed above.
process.exit(wrote ? 0 : problems.length || edits.length ? 1 : 0);
