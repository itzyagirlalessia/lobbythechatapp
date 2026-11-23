import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pullGitHub, sharedPath } from './pull-github.mjs';

const directory = mkdtempSync(join(tmpdir(), 'duo-github-sync-'));
const remote = join(directory, 'shared.git'), author = join(directory, 'collaborator'), site = join(directory, 'site');
const noHooks = join(directory, 'no-hooks');
mkdirSync(noHooks);
function git(root, ...args) {
  return execFileSync('git', ['-c', `core.hooksPath=${noHooks}`, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root, path, value) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); }
function init(root) {
  mkdirSync(root);
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Sync verification');
  git(root, 'config', 'user.email', 'sync@example.test');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
}
function publish(message, branch = 'main') {
  git(author, 'add', '-A');
  git(author, 'commit', '-m', message);
  git(author, 'push', 'origin', branch);
  return git(author, 'rev-parse', 'HEAD');
}
const pull = options => pullGitHub({ root: site, url: remote, ...options });
try {
  for (const path of ['../escape', 'src/../../escape', '/outside', 'C:/outside', 'src\\outside', '.openai/hosting.json', '.env', 'src/.env.local', '.local/data.sqlite', 'src/.git/config', 'dist/server/index.js']) assert.equal(sharedPath(path), false, path);
  for (const path of ['src/new-feature.js', 'scripts/check.mjs', 'drizzle/0011_example.sql', 'CLAUDE.md', '.github/workflows/check.yml']) assert.equal(sharedPath(path), true, path);
  mkdirSync(remote);
  git(remote, 'init', '--bare', '--initial-branch=main');
  init(author);
  git(author, 'remote', 'add', 'origin', remote);
  write(author, 'src/app.js', 'original\n');
  write(author, 'src/local.js', 'shared starting point\n');
  const base = publish('Initial shared source');
  init(site);
  write(site, 'src/app.js', 'original\r\n');
  write(site, 'src/local.js', 'shared starting point\n');
  write(site, '.gitignore', '.local/\n.env\n');
  write(site, '.openai/hosting.json', 'private hosting configuration\n');
  write(site, '.env', 'local secret placeholder\n');
  git(site, 'add', '.');
  git(site, 'commit', '-m', 'Separate Sites source history');
  assert.equal(pull({ initialize: base }).initialized, base);
  assert.equal(pull({ mode: 'apply' }).changes.length, 0);
  assert.throws(() => pull({ initialize: base }), /already initialized/);

  write(author, 'src/app.js', 'collaborator update\n');
  write(author, 'src/new.js', 'new feature\n');
  write(author, '.openai/hosting.json', 'must not replace local hosting\n');
  write(author, '.env', 'must not replace local secrets\n');
  const update = publish('Claude contribution');
  write(site, 'src/local.js', 'unfinished local work\n');
  const preview = pull();
  assert.equal(preview.head, update);
  assert.equal(readFileSync(join(site, 'src/app.js'), 'utf8'), 'original\r\n');
  const applied = pull({ mode: 'apply' });
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.skipped.sort(), ['.env', '.openai/hosting.json']);
  assert.equal(readFileSync(join(site, 'src/app.js'), 'utf8'), 'collaborator update\n');
  assert.equal(readFileSync(join(site, 'src/new.js'), 'utf8'), 'new feature\n');
  assert.equal(readFileSync(join(site, 'src/local.js'), 'utf8'), 'unfinished local work\n');
  assert.equal(readFileSync(join(site, '.openai/hosting.json'), 'utf8'), 'private hosting configuration\n');
  assert.equal(readFileSync(join(site, '.env'), 'utf8'), 'local secret placeholder\n');
  assert.equal(readFileSync(join(site, applied.backup, 'src/app.js'), 'utf8'), 'original\r\n');

  git(author, 'switch', '-c', 'staging', base);
  write(author, 'src/app.js', 'staging preview\n');
  const staged = publish('Staging contribution', 'staging');
  git(author, 'switch', 'main');
  const stageSite = join(directory, 'staging-site');
  init(stageSite);
  write(stageSite, '.openai/github-sync.json', '{"branch":"staging"}\n');
  write(stageSite, '.openai/hosting.json', 'staging hosting configuration\n');
  write(stageSite, 'src/app.js', 'original\n');
  const pullStaging = options => pullGitHub({ root: stageSite, url: remote, ...options });
  assert.equal(pullStaging({ initialize: base }).branch, 'staging');
  assert.equal(pullStaging({ mode: 'apply' }).head, staged);
  assert.equal(readFileSync(join(stageSite, 'src/app.js'), 'utf8'), 'staging preview\n');
  assert.equal(pull().head, update);
  assert.equal(readFileSync(join(site, 'src/app.js'), 'utf8'), 'collaborator update\n');
  assert.equal(readFileSync(join(stageSite, '.openai/hosting.json'), 'utf8'), 'staging hosting configuration\n');
  write(stageSite, '.openai/github-sync.json', '{"branch":"main"}\n');
  assert.throws(() => pullStaging({ mode: 'apply' }), /does not match this repository and branch/);

  write(site, 'src/app.js', 'local edit\n');
  write(author, 'src/app.js', 'different remote edit\n');
  write(author, 'src/another.js', 'must wait for conflict resolution\n');
  const conflictHead = publish('Conflicting contribution');
  const conflict = pull({ mode: 'apply' });
  assert.deepEqual(conflict.conflicts, ['src/app.js']);
  assert.equal(conflict.applied, undefined);
  assert.equal(existsSync(join(site, 'src/another.js')), false);
  assert.equal(readFileSync(join(site, 'src/app.js'), 'utf8'), 'local edit\n');
  assert.equal(JSON.parse(readFileSync(join(site, '.local/github-sync.json'))).commit, update);
  write(site, 'src/app.js', 'different remote edit\n');
  assert.equal(pull({ mode: 'apply' }).head, conflictHead);
  assert.equal(readFileSync(join(site, 'src/another.js'), 'utf8'), 'must wait for conflict resolution\n');

  unlinkSync(join(author, 'src/new.js'));
  publish('Remove an obsolete file');
  const deleted = pull({ mode: 'apply' });
  assert.equal(existsSync(join(site, 'src/new.js')), false);
  assert.equal(readFileSync(join(site, deleted.backup, 'src/new.js'), 'utf8'), 'new feature\n');

  const outside = join(directory, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(site, 'src/linked'), 'junction');
  write(author, 'src/linked/target.js', 'must not write outside checkout\n');
  publish('Path through a local symbolic link');
  assert.deepEqual(pull({ mode: 'apply' }).conflicts, ['src/linked/target.js']);
  assert.equal(existsSync(join(outside, 'target.js')), false);
  unlinkSync(join(site, 'src/linked'));
  assert.equal(pull({ mode: 'apply' }).applied, true);
  git(author, 'mv', 'src/another.js', 'src/Another.js');
  publish('Case-only rename requires portable review');
  const renamed = pull({ mode: 'apply' });
  assert.deepEqual(renamed.conflicts.sort(), ['src/Another.js', 'src/another.js']);
  assert.equal(renamed.applied, undefined);
  assert.equal(readFileSync(join(site, 'src/another.js'), 'utf8'), 'must wait for conflict resolution\n');
  console.log('Verified isolated main and staging pulls, new and deleted files, conflict protection, backups, private paths, symbolic links, and case-only renames.');
} finally {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('duo-github-sync-')) throw new Error('Refusing to clean up an unexpected test directory.');
  rmSync(target, { recursive: true, force: true });
}
