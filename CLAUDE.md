# Working on the shared chat app

Read `AGENTS.md` for the shared collaboration rules and `README.md` for setup.

GitHub `staging` in `itzyagirlalessia/lobbythechatapp` is the shared branch for updates. Fetch the latest changes before editing. In a normal clone, start from current `staging`, work on a feature branch, run the checks, and open a pull request into `staging`. Preserve changes from the other developer. Never force-push over their work or commit credentials, real account assignments, databases, user uploads, or local hosting configuration.

For every change, add a one-line entry at the top of `docs/CHANGELOG.md` under today's date, tagged `[Wilmer]`.

After opening a pull request, pushing to one, or merging one, post a comment on that pull request yourself with `gh api` (not a GitHub Action). Start it with `@itzyagirlalessia`, then a short heading ("New pull request", "New push" or "Merged into staging"), then the new changelog lines, the commits and the changed files.

Keep GitHub Actions usage to a minimum: do not add new workflows or extra triggers without the user's approval.

For chat changes, run `node scripts/verify.mjs`. For changes to the GitHub pull helper, run `node scripts/verify-github-sync.mjs`. The project uses Node.js 24 and has no package dependencies to install.

Both sites use the Sites host. GitHub Actions checks source code. Codex publishes merged staging changes to the private test site using the connected Sites tools. After testing and user approval, merge the tested changes into `main` for a separate production deployment. See `docs/STAGING.md`.
