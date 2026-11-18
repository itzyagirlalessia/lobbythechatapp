# Duo Chat

A group chat app with rooms, text and voice channels, profiles, friends, private DMs, moderation, events, shared checklists, polls, and optional shared ChatGPT replies.

## Current hosting

The working app is hosted at https://duo-chat-workspace.itzyagirlalessia.chatgpt.site.

This export contains source code, database migrations, and automated checks. It contains no production database, uploads, runtime secrets, or Git history. Uploading this repository does not migrate the live app or its users.

## Updates

GitHub `main` is the shared source for Codex, Claude, and other collaborators. Fetch the latest changes before editing, work on a feature branch when contributing in parallel, and merge reviewed pull requests into `main`. Codex pulls merged changes before the next update and pushes completed work back here. Shared instructions are in `AGENTS.md` and `CLAUDE.md`.

In a normal GitHub clone:

```sh
git switch main
git pull --ff-only
git switch -c your-feature-name
```

Use this on a clean working tree. If you have local work, commit it on your branch and fetch/merge the latest changes without discarding it.

The existing Sites checkout has a separate Git history. Its pull helper imports app source without merging the hosting repository's history:

```sh
node scripts/pull-github.mjs --check
node scripts/pull-github.mjs --apply
```

The first command previews changes. The second applies them, saves copies of replaced files under ignored `.local/github-backups/`, and records the imported commit in `.local/github-sync.json`. Local edits to unchanged files stay in place. If both sides changed a file differently, the pull stops before applying any changes; resolve the conflict and retry. Private hosting configuration, environment files, generated output, and user data are excluded. The helper does not commit local work or move the Sites branch.

Managed paths are `src/`, `scripts/`, `drizzle/`, `docs/`, `.github/`, and the root project files listed in the helper. New top-level source directories need review before adding them to this list. Symbolic links and case-only filename changes also require manual review so pulls work safely across Windows and Linux.

The Sites workspace is already initialized. For a new separate checkout, initialize once with `node scripts/pull-github.mjs --initialize <full-sha-of-last-shared-commit>`. This must be the commit its local source was based on; choosing the current remote SHA without first comparing files can miss incoming changes. Normal GitHub clones should use Git's usual pull and branch commands instead.

GitHub Actions checks each push and pull request. Pulling runs when the workspace is used or the command is run; there is no background watcher. Review and test incoming app changes before publishing. Live publication on the Sites host is separate, so a push or merge does not automatically update the live app.

## Build and check

Use Node.js 24 or newer. The project has no package dependencies to install.

```sh
node scripts/build.mjs
node scripts/verify.mjs
node scripts/verify-github-sync.mjs
```

The build writes a Cloudflare-compatible Worker module to `dist/server/index.js`. The verification script uses a disposable in-memory SQLite database and mocked external services; it does not contact real users or charge an AI account.

```sh
node scripts/preview.mjs
```

The local preview runs at http://127.0.0.1:3957. It supports anonymous room testing and intentionally strips trusted identity headers. Hosted account profiles, friends, DMs, and uploads require the hosting integrations below.

## Deployment requirements

GitHub Pages serves static files and cannot run this app's server or database. The full app needs:

- A Worker-compatible server runtime.
- A D1 database bound as `DB`, with the SQL migrations applied in order.
- An R2 bucket bound as `BUCKET` for profile pictures and image uploads.
- An authenticated identity layer and the existing invite-only access policy.
- A private `ROOM_KEY_ENCRYPTION` value for encrypting room owners' AI API keys.

The existing deployment receives verified `oai-authenticated-user-id` and `oai-authenticated-user-email` headers from the Sites gateway. **Do not expose this Worker directly on another host while trusting caller-supplied versions of these headers.** An independent deployment must verify user identity, strip incoming identity headers, and inject authenticated identity itself. `/signin-with-chatgpt` is also supplied by the current hosting gateway.

Cloudflare Workers can deploy from GitHub using Workers Builds or GitHub Actions. This export does not enable deployment until the target hosting account, authenticated sign-in, access rules, and storage have been configured. No production data is included or automatically moved. A migration must preserve account ownership, room access, encrypted API keys, and uploaded images.

See [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) and [Cloudflare Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/).

## Configuration

`.env.example` lists runtime configuration names only. Set real values in the hosting provider's secret settings; never commit them. The local preview currently reads `ROOM_KEY_ENCRYPTION` and `DUO_PORT` from the process environment. It does not load `.env` files.

`DUO_ADMIN_EMAILS` and `DUO_ACCOUNT_ASSIGNMENTS` contain private admin and username assignments on the existing host. Reapply them securely when migrating. `DUO_STEAM_API_KEY` and `DUO_LASTFM_API_KEY` enable optional live activity.

ChatGPT replies use the room host's OpenAI API key and API billing. DMs do not send messages to the AI provider. DMs are protected by application access controls and are not end-to-end encrypted.

Scheduled room messages deliver when someone opens the room at or after their due time. Reminders and browser notifications require the app to be open.

## Copyright

All rights reserved. Publishing source code does not grant an open-source license. See `src/terms.html` and `src/copyright.html` for the app's current terms and reporting contact.
