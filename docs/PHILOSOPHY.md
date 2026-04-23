# Philosophy

Null exists because the default behaviour of every major browser is to leak data, and the people who made that choice did not have a good reason — they had a business model.

The name is the argument. `null` is the value a function returns when there is nothing to return, and that is what a browser should emit by default: no telemetry, no history uploaded to a server, no prompts sent to an AI the user did not ask for, no measurement of attention, no record of the visit anywhere but the machine in front of the user.

Null is not a privacy feature bolted onto a browser. It is a browser built around the assumption that the user owns their data, their attention, and their AI, and that every departure from that assumption has to be asked for, not assumed.

---

## The three convictions

**Local-first AI.** The browser ships with a sidebar that can talk to a language model. By default that model runs on the user's own machine via Ollama. Cloud providers exist, but they are opt-in, per-provider, and every call that leaves the device is shown in the UI before it goes. The sidebar must work fully with only a local model. If it ever stops working without a cloud connection, that is a regression.

**Radical transparency.** The network inspector is not a developer tool. It is a first-class surface that shows every outbound request the browser makes, in real time, grouped by origin. Storage is SQLite and JSON — inspectable with standard tools. AI conversations are logged locally so the user can read them back. There is nothing in this browser that the user cannot see.

**Assist, don't complete.** The AI is a capable collaborator. It is not an autonomous agent. It does not click, type, or navigate on the user's behalf without the user approving the specific action. Agent-style behaviour is a feature that has to be earned through clear, per-action consent — not a default the user has to opt out of.

---

## What this means in practice

Null makes no connection to any service operated by this project, or by Google, Anthropic, OpenAI, Mozilla, or any third party beyond the site the user is visiting. It does not phone home on launch. It does not check for updates unless the user asks. It does not ship crash reports to a server. If the developers want to know how the browser is performing in the wild, they will have to ask.

Null does not have an account system. It does not have a sync service. It does not want the user's email address. There is no onboarding flow, no "Skip for now", no notification designed to pull the user back in.

Every piece of data the browser holds — bookmarks, history, AI conversations, cookies, settings — lives on the user's machine in a format the user can read. If the user wants to delete it, one command removes it. If the user wants to back it up, standard tools work. No one else has a copy.

---

## What Null is not

Null is not a Chromium fork. A solo maintainer cannot keep up with Chromium, and trying would turn the project into a full-time job that ends when the maintainer burns out.

Null is not a product. It is not funded, it is not monetised, it is not for sale, it is not seeking acquisition. It will not take money from anyone whose incentives conflict with the principles above.

Null is not a competitor to Chrome, Safari, or Firefox. It does not need to displace them to matter. It needs to exist, work honestly, and be found by the people who want it.

Null is not for everyone. It is for people who would rather have control than convenience, and who are willing to accept small frictions — installing Ollama, approving cloud calls, reading a network inspector — in exchange for a browser that does not treat them as a signal to harvest.

---

## The invariants

These are not defaults. They are invariants. Code that violates them is a bug.

1. **Zero telemetry.** No analytics, no crash reporting to a server, no anonymous usage statistics, no A/B testing infrastructure, no phone-home of any kind.
2. **No default cloud connections.** The browser must start up and browse the web without making any connection to any service operated by this project or any third party beyond the site the user is visiting.
3. **All AI inference is local by default.** Cloud providers are opt-in, per-provider, per-call.
4. **Every outbound connection is visible** through the network inspector.
5. **Data lives with the user.** Local, plaintext-inspectable formats (SQLite, JSON). No mandatory sync. No cloud account.
6. **No dark patterns.** No forced onboarding, no engagement retention tricks, no notification spam, no "Skip for now" buttons designed to make the next launch louder.

Any pull request that touches networking, storage, or AI routing has to answer three questions in its description: *what does this store, what does it transmit, what does it remember?* If a reviewer cannot answer those from the diff, the PR is not ready.

---

## How to use this document

When a feature is proposed — by a contributor, by an issue, by the maintainer's own enthusiasm — read this document and ask whether the feature would sit comfortably alongside it. If it would not, the feature does not belong in Null, no matter how clever or useful it is in isolation.

The point is not that every good idea fits here. The point is that this browser is for one specific set of values, and the set is small on purpose.
