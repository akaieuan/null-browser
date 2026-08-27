# Philosophy

Null exists because the default behaviour of every major browser is to leak data, and the people who made that choice did not have a good reason — they had a business model.

The name is the argument. `null` is the value a function returns when there is nothing to return, and that is what a browser should emit by default: no telemetry, no history uploaded to a server, no prompts sent to an AI the user did not ask for, no measurement of attention, no record of the visit anywhere but the machine in front of the user.

Null is not a privacy feature bolted onto a browser. It is a browser built around the assumption that the user owns their data and their attention, and that every departure from that assumption has to be asked for, not assumed.

---

## The three convictions

**No inference, anywhere.** Null does not run a language model, and it does not call one. It captures instead: any page, or any selection, becomes markdown on the user's disk in one click. Where that markdown goes next — a chat window, an editor, a notes app — is the user's business, not the browser's. This started as local-first AI with opt-in cloud providers; the providers went because a browser that holds an API key is a browser you have to trust, and capture turned out to be the part that was actually worth using.

**Radical transparency.** The network inspector is not a developer tool. It is a first-class surface that shows every outbound request the browser makes, in real time, grouped by origin. Storage is SQLite and plain markdown files — inspectable with standard tools, and readable without Null installed. There is nothing in this browser that the user cannot see.

**Assist, don't complete.** Null hands the user material and gets out of the way. It does not click, type, or navigate on their behalf, and it does not decide what a page means. Anything agent-shaped is a feature that has to be earned through clear, per-action consent — not a default the user has to opt out of.

---

## What this means in practice

Null makes no connection to any service operated by this project, or by Google, Anthropic, OpenAI, Mozilla, or any third party beyond the site the user is visiting. It does not phone home on launch. It does not check for updates unless the user asks. It does not ship crash reports to a server. If the developers want to know how the browser is performing in the wild, they will have to ask.

Null does not have an account system. It does not have a sync service. It does not want the user's email address. There is no onboarding flow, no "Skip for now", no notification designed to pull the user back in.

Every piece of data the browser holds — bookmarks, history, clips, cookies, settings — lives on the user's machine in a format the user can read. Clips are plain markdown files in the user's documents folder, so they outlive the app itself. If the user wants to delete it, one command removes it. If the user wants to back it up, standard tools work. No one else has a copy.

---

## What Null is not

Null is not a Chromium fork. A solo maintainer cannot keep up with Chromium, and trying would turn the project into a full-time job that ends when the maintainer burns out.

Null is not a product. It is not funded, it is not monetised, it is not for sale, it is not seeking acquisition. It will not take money from anyone whose incentives conflict with the principles above.

Null is not a competitor to Chrome, Safari, or Firefox. It does not need to displace them to matter. It needs to exist, work honestly, and be found by the people who want it.

Null is not for everyone. It is for people who would rather have control than convenience, and who are willing to accept small frictions — copying a clip into the tool that will use it, reading a network inspector — in exchange for a browser that does not treat them as a signal to harvest.

---

## The invariants

These are not defaults. They are invariants. Code that violates them is a bug.

1. **Zero telemetry.** No analytics, no crash reporting to a server, no anonymous usage statistics, no A/B testing infrastructure, no phone-home of any kind.
2. **No default cloud connections.** The browser must start up and browse the web without making any connection to any service operated by this project or any third party beyond the site the user is visiting.
3. **No inference in the browser.** Null does not run or call a language model. It captures pages as markdown; the user takes that markdown wherever they like.
4. **Every outbound connection is visible** through the network inspector.
5. **Data lives with the user.** Local, plaintext-inspectable formats (SQLite, JSON). No mandatory sync. No cloud account.
6. **No dark patterns.** No forced onboarding, no engagement retention tricks, no notification spam, no "Skip for now" buttons designed to make the next launch louder.

Any pull request that touches networking or storage has to answer three questions in its description: *what does this store, what does it transmit, what does it remember?* If a reviewer cannot answer those from the diff, the PR is not ready.

---

## Decisions on the record

### Blocking (2026-08-27)

Null blocks ads and trackers from a static list that is written in this repository, by hand, and compiled into the binary. Nothing in it is imported from EasyList, uBlock Origin, AdGuard, or any other filter project.

The reason is invariant 2, and it is not a close call. Every shipping blocklist is a subscription: the browser fetches it on a schedule, from a server the user did not choose, and that fetch is a connection to a third party on every launch. It usually carries an install identifier so the operator can count users. Adopting one would mean either breaking the invariant or shipping a list that goes stale — and a browser that phones home for its blocklist is exactly the shape of thing this project exists to not be.

So the list is code. Adding a hostname is a commit; getting a bigger list is updating the app. That is slower and smaller than a subscription, and it is honest about what it is: an opinion the maintainer holds, versioned, readable, and reviewable in the same diff as everything else. The provenance rules live in `scripts/blocklist/README.md`.

It is **off by default**. Blocking changes what a page receives, and a browser that silently rewrites pages on first launch has made a decision that was not its to make. The Network Inspector shows what a page loads; the toggle in Settings is where a user decides to do something about it.

### Invariant 4 and a blocked request

A blocked request is not an invisible outbound connection. It is not an outbound connection at all — WebKit refuses it before anything is written to a socket, so no packet, no DNS lookup, and no TLS handshake leaves the machine.

Invariant 4 says every outbound connection is visible through the Network Inspector. That still holds exactly: the inspector shows what loaded, and blocking removes things from that list rather than hiding them from it. Main-frame navigations are kept off the bundled rule list for the same reason — they stay on the path where they are recorded, so a refused navigation is something the user can see was refused.

---

## How to use this document

When a feature is proposed — by a contributor, by an issue, by the maintainer's own enthusiasm — read this document and ask whether the feature would sit comfortably alongside it. If it would not, the feature does not belong in Null, no matter how clever or useful it is in isolation.

The point is not that every good idea fits here. The point is that this browser is for one specific set of values, and the set is small on purpose.
