# Contributing to CRM

CRM is maintained as an application for managing WhatsApp conversations,
contacts, sales, and automations. Contributions should keep the product
reliable, secure, accessible, and easy to deploy.

## Setup and run

```bash
git clone https://github.com/anthonymorocho/wacrm.git
cd wacrm

cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm install
npm run dev
```

Full setup (Supabase migrations, WhatsApp Business API, deploy) lives in
[`docs/`](./docs/README.md).

## Reporting bugs

Open an issue with the commit SHA, runtime (Hostinger / Vercel / local /
other), reproduction steps, and relevant logs.

## Reporting security issues

**Do not file security issues publicly.** Follow the private flow in
[SECURITY.md](./.github/SECURITY.md).

## Pull requests

Before opening a pull request:

- Branch off the latest `main` (don't push to a merged branch — commits
  end up orphaned).
- Run `npm run typecheck` and `npm run format` locally first.
- Fill in the PR template, especially the **Test plan**.
- One logical change per PR.
- Commit-message first line is imperative + terse; the body explains
  the *why*, the diff shows the *what*.

Open an issue first for larger product changes so the scope and approach
are clear before implementation.

## Dev-loop reference

These are the main scripts used during development:

| Command | What it does |
| --- | --- |
| `npm run dev` | Turbopack dev server on port 3000. |
| `npm run build` | Production build. Next also runs its own typecheck here. |
| `npm run typecheck` | `tsc --noEmit`. Fast TS-only pass. |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier in check-only mode. Useful in CI. |

## Licensing

CRM is MIT-licensed under [`LICENSE`](./LICENSE). Keep this notice with
the project when distributing it.
