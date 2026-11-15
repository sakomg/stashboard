# Contributing

Thank you for helping. Bug reports, ideas and pull requests are all welcome.

## Getting started

You need [Node.js 24](https://nodejs.org) or newer. There is no build step: Node runs the TypeScript directly
and the page is plain HTML, CSS and ES modules.

```sh
npm ci
npm run demo      # the dashboard with made-up data, no API keys needed
npm run lint      # formatting check, typecheck and tests, as CI runs them
```

To work against real data, copy `config.example.json` to `config.json`, add keys, and run `npm start`.

## How the project is written

- **English everywhere**: code, docs, interface and commit messages.
- **No comments in the code.** Explain why something is built the way it is in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), in the same pull request. User-facing behaviour goes in
  [docs/guide.md](docs/guide.md) or [docs/self-hosting.md](docs/self-hosting.md).
- **Prettier** formats everything: `npm run format`.
- **Tests** sit in `test/` and use `node:test`. New behaviour comes with a test.
- **Free data sources only.** A source must work on a free tier.
- **Read-only.** Nothing may ask for a seed phrase, a signature, or a key that can move funds.
- **Few dependencies.** Ask in an issue before adding a runtime dependency.
- **Interface text** is plain and specific: full sentences rather than clauses joined with semicolons. A
  reading that is not obvious gets a help popover with a link to its source.
- **Controls** come from the core components in [`public/common/ui.js`](public/common/ui.js).
- **Layers**: code goes in the layer it belongs to (see [Project layout](docs/ARCHITECTURE.md#project-layout)).
  Dependencies point down, and a test fails when they do not. On the page, one module per part of the
  dashboard, loaded from `main.js`.

## Pull requests

1. Open an issue first for anything larger than a fix, so we can agree on the approach.
2. Keep a pull request to one change, and describe what changed and how you checked it.
3. Make sure `npm run lint` passes. CI runs the same checks.
4. Screenshots help for anything visible. Use the demo data, never your own portfolio.
