# Contributing to Null

Null is a solo-maintained open-source project. If you're thinking about contributing, read [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) first and make sure your change fits inside the six invariants. If it doesn't, it probably doesn't belong in Null — no matter how useful it is in isolation.

## Setup

1. Install [Rust stable](https://rustup.rs) and Node 20+.
2. On Linux, install the system deps listed in [.github/workflows/ci.yml](.github/workflows/ci.yml) (webkit2gtk, build-essential, etc).
3. `npm install`
4. `npm run tauri dev`

If `cargo` isn't on your `PATH`, run `source ~/.cargo/env` once per shell.

## Running checks locally

Before opening a PR, run the same checks CI runs:

```sh
npm run build                                                  # tsc + vite
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings
```

CI runs these on macOS, Linux, and Windows. If a platform-specific failure happens and you can't reproduce it locally, say so in the PR.

## The three questions

Every PR that touches **networking, storage, or AI routing** must answer, in the PR description:

1. What does this **store**?
2. What does this **transmit**?
3. What does this **remember**?

If a reviewer cannot answer all three from the diff alone, the PR isn't ready. This is how we hold the line on the six invariants. "Nothing" is a perfectly good answer — write it anyway.

## Dependency rules

Before adding a new crate or npm package:

- Its license must be compatible with MPL 2.0.
- It must not phone home on import or init.
- Its transitive deps must not do either of the above.

Run `cargo tree` (or `npm ls`) and look down the whole tree, not just the direct dep. If you're unsure, flag it in the PR — it's fine to ask, it's not fine to guess.

Don't add a package to satisfy a hypothetical future need. Add it when a feature actually requires it, and delete it when the feature goes away.

## Voice

Commit messages, PR descriptions, user-facing strings, and docs should read as if written by a person with a point of view. Direct, specific, opinionated where it matters.

Avoid AI-sounding prose: "it's worth noting", "leverage", "seamless", "robust", "empower", list-for-the-sake-of-list structure, hedges like "this might help" or "could potentially". Match the register of [README.md](README.md) and [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md).

## Commit style

- Small, reviewable commits. Write them as if they'll be audited — because privacy projects depend on being auditable.
- Imperative present tense: "Add the network inspector", not "Added" or "Adds".
- Explain the **why** in the body when the **what** isn't obvious from the diff.

## License

By contributing, you agree that your contributions are licensed under the [MPL 2.0](LICENSE). Contributions under any other license cannot be accepted.
