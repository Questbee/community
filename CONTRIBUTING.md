# Contributing to Questbee Community Edition

Thank you for your interest in contributing.

## Before you start

- **Bug reports** — open a GitHub issue with steps to reproduce, expected vs actual behavior, and your Docker / OS version.
- **Feature requests** — open a GitHub issue describing the use case. Features that belong in the enterprise tier will be noted.
- **Security issues** — do not open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

See the **Development** section in [README.md](README.md) for how to run the API and web dashboard locally.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep changes focused — one feature or fix per PR.
3. For backend changes, add or update tests in `api/tests/`.
4. Run `ruff check api/` and `pytest api/` before opening the PR.
5. Run `npm run build` in `web/` to confirm no type errors.
6. Describe what the PR does and why in the description.

## Code style

- **Python** — `ruff` for linting, `black`-compatible formatting, line length 100.
- **TypeScript** — ESLint config from the repo; no `any` unless unavoidable.
- Do not commit `.env` or any file with real credentials.

## What we will not accept

- Changes that break the Docker Compose single-command deployment.
- Enterprise-only features submitted as community PRs.
- Dependencies that require external cloud services (no AWS SDK, no Stripe, etc.).
