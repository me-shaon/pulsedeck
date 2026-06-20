# Contributing to PulseDeck

Thanks for your interest in improving PulseDeck. This guide covers how to get set up, the bar for a change, and the Contributor License Agreement you accept by contributing.

## Getting started

PulseDeck is a pnpm monorepo (Node ≥ 22, pnpm 9).

```bash
pnpm install
pnpm dev          # API on :3001, web on :3000
```

See the [README](README.md) for the full workflow and architecture.

## Before you open a pull request

Please make sure the workspace is green:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

Guidelines:

- Keep changes focused; one logical change per PR.
- Match the existing style — Prettier and ESLint are configured at the root.
- The report/block wire contract lives in `packages/schema` and is documented in [`BLOCK_SCHEMA.md`](BLOCK_SCHEMA.md). Changes there are **additive within 1.x** (new optional fields, block types, or enum values only); renames or removals are a major version.
- Add or update tests for behavior changes.
- For anything non-trivial, open an issue first so we can align on the approach.

## Reporting bugs & security issues

- **Bugs / features:** open a GitHub issue with clear reproduction steps.
- **Security vulnerabilities:** please do **not** open a public issue. Email the maintainers privately so we can ship a fix before disclosure.

## Contributor License Agreement (CLA)

PulseDeck is open-source under AGPL-3.0, with a long-term goal of preserving the ability to offer dual/commercial licensing (the open-core model described in the PRD).

**By submitting a contribution (code, docs, or other content) to this project, you agree that:**

1. You are the original author of the contribution, or you have the right to submit it.
2. You grant the project maintainers a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, sublicense, and distribute your contribution **and to relicense it**, including under commercial or other licenses, as part of PulseDeck.
3. Your contribution is and remains available under the project's AGPL-3.0 license.
4. You provide your contribution "as is", without warranties of any kind.

This dual grant is what lets PulseDeck stay AGPL for everyone while keeping a sustainable commercial path. If your employer holds rights to work you create, make sure you have permission to contribute under these terms.

On your first pull request, please add a line to your PR description confirming:

> I have read and agree to the PulseDeck CLA in CONTRIBUTING.md.

Thank you for contributing.
