# Contributing to seamless-claude

## Prerequisites

- Node.js 18 or later
- Claude Code

## Setup

```bash
npm install
npm test
npm run lint
```

## Code Style

Code style is enforced by biome:

- 72-character line width limit
- Single quotes
- No semicolons
- ESM imports only

Run `npm run lint` before submitting changes. Auto-fix with
`npm run lint:fix`.

## Testing

Tests use Node's native test runner (`node --test`).

- Write tests first (TDD)
- Test behaviour, not implementation
- Use real objects, not mocks
- Keep tests focused and independent

Run tests with `npm test`.

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Write or update tests
5. Update `CHANGELOG.md` under an `[Unreleased]`
   heading (see [Keep a Changelog][kac])
6. Run `npm test` and `npm run lint`
7. Submit a pull request

[kac]: https://keepachangelog.com/en/1.1.0/

Keep PRs focused on a single change. Include clear descriptions
of what changed and why.

## Commit Messages

Follow conventional commit format where appropriate:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `test:` test additions or changes
- `refactor:` code changes without behaviour changes

Keep commit messages concise and descriptive.

## Questions

Open an issue for questions or clarifications before starting
significant changes.
