// A dependency-free Chrome DevTools Protocol driver.
//
// Node ships a global WebSocket and Chrome exposes CDP over one, so
// scripted screenshots need nothing installed — no puppeteer, nothing
// added to the project's package.json, nothing to keep in step with a
// browser version.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  throw new Error(
    'No Chrome or Chromium found. Set CHROME_PATH to the binary.\nLooked in:\n  ' +
      CANDIDATES.join('\n  '),
  );
}

function rmQuietly(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {
    /* the OS reaps its own temp directory eventually */
  }
}

/** Ask the OS for a port nothing is using. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function launch({ port, profile } = {}) {
  // Each launch takes its own port and its own profile. Reusing a fixed
  // port means the second launch can reach the *previous* Chrome while
  // it is still shutting down, and connect to a socket about to close.
  port ??= await freePort();
  const userDataDir = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), 'null-shot-'));
  const ownsProfile = !profile;
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=2',
      '--allow-file-access-from-files',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  // Kill the browser and delete the profile. Callers get this as `kill`
  // so a failed run cannot strand a headless Chrome holding a port, or
  // leave tens of megabytes of profile behind in the temp directory —
  // one per launch, three per `ui:shoot` run.
  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    if (!ownsProfile) return;
    // Chrome exits asynchronously and keeps writing its profile on the
    // way out, so an rm issued straight after kill() races it and either
    // throws or leaves a partial directory behind. Try now, and again on
    // process exit — by then Chrome is reliably gone. Neither attempt is
    // allowed to throw: cleanup runs from `finally`, where an exception
    // would mask whatever actually went wrong.
    rmQuietly(userDataDir);
    process.once('exit', () => rmQuietly(userDataDir));
  };

  // Poll the debugging endpoint rather than sleeping a guessed interval.
  const deadline = Date.now() + 20_000;
  let version;
  for (;;) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      if (Date.now() > deadline) {
        cleanup();
        throw new Error('Chrome did not expose CDP in time');
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return {
    child,
    port,
    browserWs: version.webSocketDebuggerUrl,
    userDataDir,
    kill: cleanup,
  };
}

/** A single CDP session over one WebSocket. */
export class Session {
  #ws;
  #id = 0;
  #pending = new Map();
  #handlers = new Map();

  static async open(url) {
    const s = new Session();
    s.#ws = new WebSocket(url);
    await new Promise((res, rej) => {
      s.#ws.addEventListener('open', res, { once: true });
      s.#ws.addEventListener('error', rej, { once: true });
    });
    s.#ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = s.#pending.get(msg.id);
        if (!p) return;
        s.#pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else {
        for (const h of s.#handlers.get(msg.method) ?? []) h(msg.params);
      }
    });
    // A dead socket must fail every outstanding call. Otherwise a Chrome
    // that crashes mid-run leaves promises that never settle, the script
    // hangs forever, and the caller's `finally { kill() }` never runs.
    const fail = (why) => {
      for (const [, p] of s.#pending) p.reject(new Error(why));
      s.#pending.clear();
    };
    s.#ws.addEventListener('close', () => fail('CDP socket closed'));
    s.#ws.addEventListener('error', () => fail('CDP socket error'));
    return s;
  }

  /** @param {number} timeout ms before the call is abandoned. */
  send(method, params = {}, sessionId, timeout = 30_000) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeout}ms`));
      }, timeout);
      const done = (fn) => (v) => {
        clearTimeout(timer);
        fn(v);
      };
      this.#pending.set(id, { resolve: done(resolve), reject: done(reject) });
      this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method, fn) {
    if (!this.#handlers.has(method)) this.#handlers.set(method, []);
    this.#handlers.get(method).push(fn);
    return () => {
      const a = this.#handlers.get(method);
      a.splice(a.indexOf(fn), 1);
    };
  }

  once(method, predicate = () => true) {
    return new Promise((resolve) => {
      const off = this.on(method, (p) => {
        if (!predicate(p)) return;
        off();
        resolve(p);
      });
    });
  }

  close() {
    this.#ws.close();
  }
}

/** A page target: navigate, evaluate, screenshot. */
export class Page {
  constructor(session, sessionId) {
    this.s = session;
    this.sid = sessionId;
  }

  static async create(browserWs, { width = 1440, height = 900 } = {}) {
    const s = await Session.open(browserWs);
    const { targetId } = await s.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await s.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(s, sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.setViewport(width, height);
    return page;
  }

  send(method, params) {
    return this.s.send(method, params, this.sid);
  }

  setViewport(width, height, deviceScaleFactor = 2) {
    return this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
    });
  }

  /** Runs before any page script on every subsequent navigation. */
  addInitScript(source) {
    return this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async goto(url) {
    const loaded = this.s.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  }

  /** Poll an expression until it is truthy. Beats sleeping a guess. */
  async waitFor(expression, { timeout = 10_000, every = 100 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await this.eval(`!!(${expression})`)) return;
      if (Date.now() > deadline) throw new Error(`waitFor timed out: ${expression}`);
      await new Promise((r) => setTimeout(r, every));
    }
  }

  async screenshot(file, { clip } = {}) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: !!clip,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
}
