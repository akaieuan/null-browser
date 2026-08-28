// SPDX-License-Identifier: MPL-2.0
//
// null-list.txt -> src-tauri/src/blocklist/ads.json   (WebKit rules)
//                  src-tauri/src/blocklist/domains.json (runtime classifier)
//
// Zero dependencies, like scripts/ui/cdp.mjs: Node's own standard
// library is enough, so nothing is added to package.json and nothing
// has to be kept in step with an upstream project.
//
// The output is committed. Builds never run this script and never
// reach the network — regenerating is something a person does after
// editing the list, and the diff goes into the same commit.
//
// Usage: node scripts/blocklist/generate.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SOURCE = path.join(HERE, 'null-list.txt');
const OUT = path.join(REPO, 'src-tauri/src/blocklist/ads.json');
// The same hosts as a plain sorted array. The rule JSON is for WebKit;
// this is for the observer, which classifies an already-loaded request
// against the list to count trackers seen (Home's data-movement graph).
const DOMAINS_OUT = path.join(REPO, 'src-tauri/src/blocklist/domains.json');

// Resource types the bundled list refuses. `document` is deliberately
// absent: a main-frame navigation must stay on the visible
// on_navigation path, where the Network Inspector records it and the
// user can see what was refused. A rule list that swallowed
// navigations would block them invisibly.
const RESOURCE_TYPES = [
  'script',
  'image',
  'style-sheet',
  'raw',
  'font',
  'media',
  'popup',
];

// WebKit itself caps a compiled rule list at 150,000 rules.
const MAX_RULES = 150000;

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Literal text for WebKit's url-filter, which is a regex. */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function parseList(text) {
  const seen = new Map();
  const problems = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const lineNo = i + 1;
    if (line !== line.toLowerCase()) {
      problems.push(`${lineNo}: not lowercase: ${line}`);
      return;
    }
    if (line.includes('://') || line.includes('/')) {
      problems.push(`${lineNo}: hostname only, no scheme or path: ${line}`);
      return;
    }
    if (!HOSTNAME.test(line)) {
      problems.push(`${lineNo}: not a hostname: ${line}`);
      return;
    }
    if (seen.has(line)) {
      problems.push(`${lineNo}: duplicate of line ${seen.get(line)}: ${line}`);
      return;
    }
    seen.set(line, lineNo);
  });
  return { hosts: [...seen.keys()], problems };
}

function rule(host) {
  return {
    trigger: {
      // Anchored at the scheme so the host cannot be matched inside a
      // query string or a path segment of some unrelated URL.
      'url-filter': `^https?://([a-z0-9_-]+\\.)*${escapeRegex(host)}[:/]`,
      'resource-type': RESOURCE_TYPES,
    },
    action: { type: 'block' },
  };
}

const { hosts, problems } = parseList(fs.readFileSync(SOURCE, 'utf8'));

if (problems.length) {
  console.error(`${path.relative(REPO, SOURCE)}: rejected ${problems.length} entries`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
if (!hosts.length) {
  console.error('null-list.txt has no usable hostnames');
  process.exit(1);
}
if (hosts.length > MAX_RULES) {
  console.error(`${hosts.length} rules exceeds WebKit's ${MAX_RULES} cap`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(hosts.map(rule), null, 2)}\n`);
console.log(`${path.relative(REPO, OUT)}: ${hosts.length} rules`);

const sorted = [...hosts].sort();
fs.writeFileSync(DOMAINS_OUT, `${JSON.stringify(sorted, null, 0)}\n`);
console.log(`${path.relative(REPO, DOMAINS_OUT)}: ${sorted.length} domains`);
