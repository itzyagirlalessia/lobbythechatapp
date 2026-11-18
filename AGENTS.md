# Project workflow

The user wants completed app updates reflected in GitHub as part of the same task.

- The GitHub source repository is `itzyagirlalessia/lobbythechatapp`, branch `main`.
- The live app is hosted with Sites. Read `.openai/hosting.json` for its project ID and use the Sites workflow to publish live changes unless the user requests code-only or local-only work.
- After an app change, sync the reviewed source changes and relevant checks to GitHub. Preserve unrelated remote edits and use an expected branch SHA when updating the ref. Do not change repository visibility or force-push over other work.
- Keep GitHub's README and CI workflow. Upload source and migrations, never runtime secrets, real account assignments, `.env` files, databases, user uploads, `.local/`, generated `dist/`, `.openai/`, or the Sites repository's Git history. Placeholder-only `.env.example` is allowed.
- Run `node scripts/verify.mjs` for changes to chat behavior and check modified JavaScript syntax. Verify the GitHub check run after pushing. Report a failed or incomplete sync explicitly.
- GitHub checks currently validate code only. A push does not deploy the live Sites app, and changes made outside this workspace are not automatically mirrored.
