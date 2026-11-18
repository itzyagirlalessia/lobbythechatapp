# Working on the shared chat app

Read `AGENTS.md` for the shared collaboration rules and `README.md` for setup.

GitHub `main` in `itzyagirlalessia/lobbythechatapp` is the shared source. Fetch the latest changes before editing. In a normal clone, start from current `main`, work on a feature branch, run the checks, and push a pull request. Preserve changes from the other developer. Never force-push over their work or commit credentials, real account assignments, databases, user uploads, or local hosting configuration.

For every change, add a one-line entry at the top of `docs/CHANGELOG.md` under today's date, tagged `[Wilmer]`.

For chat changes, run `node scripts/verify.mjs`. For changes to the GitHub pull helper, run `node scripts/verify-github-sync.mjs`. The project uses Node.js 24 and has no package dependencies to install.

The live app still uses the Sites host. GitHub Actions checks source code; pushing or merging does not deploy the live app. Codex can pull merged changes into the Sites checkout, review them, and publish using the connected Sites tools. Do not replace the app's authentication or storage just to publish from GitHub.
