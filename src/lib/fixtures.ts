/**
 * Development-only stand-in for the Rust backend.
 *
 * The chrome lives in one webview and the pages live in others, so the
 * UI can be opened in an ordinary browser (`npm run dev`) — but every
 * command would reject, leaving every list empty and every panel blank.
 * This returns plausible fixture data instead, so the sidebar, the home
 * screen and the panels can be looked at and styled without launching
 * the app.
 *
 * Guarded twice: it only loads when Tauri is absent AND the bundle is a
 * dev build, so `import.meta.env.DEV` removes it from production output
 * entirely. It never runs in the real app — if Tauri is present, the
 * real IPC is used, including when a command legitimately fails.
 */

const now = Math.floor(Date.now() / 1000);

const BOOKMARKS = [
  { id: 1, url: "https://mail.google.com/", title: "mail.google.com", created_at: now - 86400 * 30, kind: "bookmark", parent_id: null },
  { id: 2, url: "https://www.youtube.com/", title: "youtube.com", created_at: now - 86400 * 28, kind: "bookmark", parent_id: null },
  // A folder, so the tile grid's folder rendering is exercised in
  // screenshots: two research pins folded together.
  { id: 90, url: "", title: "Research", created_at: now - 86400 * 20, kind: "folder", parent_id: null },
  { id: 3, url: "https://arxiv.org/", title: "arxiv.org", created_at: now - 86400 * 20, kind: "bookmark", parent_id: 90 },
  { id: 4, url: "https://kraa.io/", title: "kraa.io", created_at: now - 86400 * 12, kind: "bookmark", parent_id: 90 },
];

const ARTIFACTS = [
  {
    id: 5, kind: "clip", title: "Kraa · Digitally Shaped",
    source_url: "https://kraa.io/writing/digitally-shaped",
    source_title: "Kraa · Digitally Shaped",
    // Deliberately exercises the whole markdown surface — hr, bold
    // inside bullets, a blockquote between sections, inline code — so
    // the screenshot harness catches viewer regressions (browser-default
    // <hr> rules once shipped because no fixture contained one).
    markdown:
      "# Digitally Shaped\n\n*A note on what it means to build tools that keep their shape under use.*\n\n---\n\n## The argument\n\nSoftware that adapts to everyone ends up **shaped by no one**. The tools that last are the ones that hold a form:\n\n- Constraints travel better than preferences\n- A tool you can **predict** is a tool you can trust\n- Every surface you make configurable is a surface you stopped designing\n- `defaults` are the real interface — most people never leave them\n\n> The shape of the tool ends up in the shape of the work. That is the whole case for caring.\n\n---\n\n## What this costs\n\nHolding a shape means saying no, in public, repeatedly. It reads as stubbornness right up until it reads as identity.\n\n```js\n// the whole settings surface, ideally\nexport const settings = { theme: 'aka' };\n```\n",
    model: "none", created_at: now - 3600 * 2, file_path: "/Users/you/Documents/Null/0005-kraa-digitally-shaped.md",
  },
  {
    id: 4, kind: "selection", title: "A Review of Artificial Intelligence in Education",
    source_url: "https://onlinelibrary.wiley.com/doi/10.1111/example",
    source_title: "A Review of Artificial Intelligence in Education",
    markdown: "> Adaptive systems consistently outperformed static courseware on retention, but the effect narrowed sharply once prior attainment was controlled for.\n",
    model: "none", created_at: now - 3600 * 9, file_path: "/Users/you/Documents/Null/0004-a-review-of-artificial-intelligence.md",
  },
  {
    id: 3, kind: "clip", title: "Humanity's Last Exam",
    source_url: "https://agi.safe.ai/",
    source_title: "Humanity's Last Exam",
    markdown: "# Humanity's Last Exam\n\n## Overview\n\n**Humanity's Last Exam (HLE)** is a benchmark designed to test the limits of AI on the hardest questions humans can pose.\n",
    model: "none", created_at: now - 86400, file_path: "/Users/you/Documents/Null/0003-humanitys-last-exam.md",
  },
  {
    id: 2, kind: "clip", title: "Kraa · A Benchmark Measurement Problem",
    source_url: "https://kraa.io/writing/benchmarks",
    source_title: "Kraa · A Benchmark Measurement Problem",
    markdown: "# A Benchmark Measurement Problem\n\nWhat a score measures, and what it is taken to measure, drift apart the moment the score matters.\n",
    model: "none", created_at: now - 86400 * 3, file_path: "/Users/you/Documents/Null/0002-kraa-a-benchmark-measurement-problem.md",
  },
  {
    id: 1, kind: "selection", title: "Attention Is All You Need",
    source_url: "https://arxiv.org/abs/1706.03762",
    source_title: "Attention Is All You Need",
    markdown: "> We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.\n",
    model: "none", created_at: now - 86400 * 6, file_path: "/Users/you/Documents/Null/0001-attention-is-all-you-need.md",
  },
];

const HISTORY = [
  { id: 1, url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", visited_at: now - 1800 },
  { id: 2, url: "https://kraa.io/writing/benchmarks", title: "Kraa · A Benchmark Measurement Problem", visited_at: now - 5400 },
  { id: 3, url: "https://agi.safe.ai/", title: "Humanity's Last Exam", visited_at: now - 86400 },
  { id: 4, url: "https://www.youtube.com/", title: "YouTube", visited_at: now - 86400 * 2 },
];

const NETWORK = [
  { id: 1, tab_id: null, url: "https://arxiv.org/abs/1706.03762", origin: "https://arxiv.org", kind: "navigation", blocked: false, at: now - 60 },
  { id: 2, tab_id: null, url: "https://arxiv.org/static/base/css/arxiv.css", origin: "https://arxiv.org", kind: "css", blocked: false, at: now - 59 },
  { id: 3, tab_id: null, url: "https://www.google-analytics.com/collect", origin: "https://www.google-analytics.com", kind: "script", blocked: true, at: now - 58 },
  { id: 4, tab_id: null, url: "https://static.arxiv.org/js/app.js", origin: "https://static.arxiv.org", kind: "script", blocked: false, at: now - 57 },
];

/**
 * `?empty=1` makes every list resolve empty, so the empty states can be
 * looked at. They are the first thing a new user sees and the last thing
 * anyone thinks to open — `npm run ui:shoot` captures them for exactly
 * that reason.
 */
function wantsEmpty(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("empty") === "1";
  } catch {
    return false;
  }
}

let nextFixtureId = 100;

/**
 * Commands with no useful fixture resolve to a sane empty value.
 *
 * The bookmark mutations (`move_bookmark`, `group_bookmarks`,
 * `reorder_bookmarks`) are live: they mutate `BOOKMARKS` the way
 * storage would, including dissolving an emptied folder. Without this,
 * every drag in the dev preview silently reverts on the refresh that
 * follows — which makes drag-and-drop the one interaction the harness
 * could never exercise.
 */
export function fixtureFor(cmd: string, args?: Record<string, unknown>): unknown {
  if (wantsEmpty()) {
    switch (cmd) {
      case "list_bookmarks":
      case "list_artifacts":
      case "list_history":
      case "list_network_events":
      case "list_blocked_origins":
        return [];
      case "get_artifact":
        return null;
    }
  }
  switch (cmd) {
    // A fresh array each call: the mutations below edit BOOKMARKS in
    // place, and handing React the same reference back would make
    // setState bail on identity and swallow the update.
    case "list_bookmarks": return [...BOOKMARKS];
    case "move_bookmark": {
      const b = BOOKMARKS.find(
        (x) => x.id === args?.id && x.kind === "bookmark",
      );
      if (b) b.parent_id = (args?.parent as number | null) ?? null;
      for (let i = BOOKMARKS.length - 1; i >= 0; i--) {
        const f = BOOKMARKS[i];
        if (
          f.kind === "folder" &&
          !BOOKMARKS.some((c) => c.parent_id === f.id)
        ) {
          BOOKMARKS.splice(i, 1);
        }
      }
      return null;
    }
    case "group_bookmarks": {
      const folder = {
        id: nextFixtureId++, url: "", title: "Folder",
        created_at: now, kind: "folder", parent_id: null as number | null,
      };
      const at = BOOKMARKS.findIndex((x) => x.id === args?.target);
      BOOKMARKS.splice(at < 0 ? BOOKMARKS.length : at, 0, folder);
      for (const x of BOOKMARKS) {
        if (
          (x.id === args?.target || x.id === args?.dragged) &&
          x.kind === "bookmark"
        ) {
          x.parent_id = folder.id;
        }
      }
      return null;
    }
    case "reorder_bookmarks": {
      const order = new Map(
        ((args?.orderedIds as number[]) ?? []).map((id, i) => [id, i]),
      );
      BOOKMARKS.sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
      return null;
    }
    case "list_artifacts": return ARTIFACTS;
    case "get_artifact":
      return ARTIFACTS.find((a) => a.id === args?.id) ?? ARTIFACTS[0];
    case "list_history": return HISTORY;
    case "list_network_events": return NETWORK;
    case "list_blocked_origins":
      return [{ origin: "https://www.google-analytics.com", created_at: now - 86400 }];
    case "network_is_paused": return false;
    case "get_notes_dir": return "/Users/you/Documents/Null";
    case "get_favicons": return [];
    case "create_note":
      return {
        id: 999, kind: "note", title: "", source_url: "",
        source_title: null, markdown: "", model: "none",
        created_at: now, file_path: "/Users/you/Documents/Null/0999-untitled.md",
      };
    case "update_note": return null;
    case "get_app_version": return "0.1.0";
    case "search_get_instance": return null;
    default: return null;
  }
}
