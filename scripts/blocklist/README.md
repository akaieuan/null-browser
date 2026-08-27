# The blocklist

`null-list.txt` is Null's blocklist. It is written here, in this
repository, by hand.

Nothing in it comes from EasyList, uBlock Origin, AdGuard, Peter Lowe's
list, or any other filter project — not the entries, not the format, not
the tooling. That is a deliberate constraint, not an oversight: a
browser that ships someone else's list has to fetch that list to keep it
current, and a browser that fetches a list makes a connection to a
service the user did not ask for. Invariant 2 does not have an exception
for good causes.

So the list grows the way the rest of the codebase grows. Someone adds a
hostname, explains it in the commit message, and the change ships in a
build. There is no update channel.

## What goes in

A hostname qualifies when it exists to serve advertising, to measure a
person across sites, or to sell an audience segment.

A hostname does not qualify when it also carries pages a user reads or a
login a user needs. An ad company's dashboard is still a dashboard, and
breaking it is not blocking an ad. Where only a company's collector
subdomain qualifies, the entry names that subdomain rather than the
registrable domain — `c.statcounter.com`, not `statcounter.com`.

Every entry matches the hostname and all of its subdomains.

## Regenerating

```bash
node scripts/blocklist/generate.mjs
```

That reads `null-list.txt` and writes
`src-tauri/src/blocklist/ads.json`, which is the WebKit content-blocker
JSON the Rust side compiles into a `WKContentRuleList`. Commit both
files together — `ads.json` is checked in and `include_str!`d, so the
build never runs this script and never touches the network.

The generator is zero-dependency Node, same as `scripts/ui/cdp.mjs`. It
refuses to write anything if a line is uppercase, carries a scheme or a
path, fails hostname validation, or duplicates an earlier line, and it
reports every rejected line at once rather than stopping at the first.

## What the rules do

Each hostname becomes one rule that blocks `script`, `image`,
`style-sheet`, `raw`, `font`, `media` and `popup` loads anchored to that
host.

`document` is not in that list. Main-frame navigations stay on the
`on_navigation` path in `src-tauri/src/network`, where the Network
Inspector records them and the user can see what was refused. A rule
list that swallowed navigations would block them where nothing is
watching.

The per-origin blocks a user adds from the Network Inspector are
compiled separately, from SQLite, and those *do* cover every resource
type including `document` — an origin the user blocked by hand should
not be reachable by a popup either.
