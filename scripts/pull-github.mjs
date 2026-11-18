import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export const repositoryUrl = 'https://github.com/itzyagirlalessia/lobbythechatapp.git';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootFiles = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'LICENSE', '.gitignore', 'package.json', 'package-lock.json']);
const protectedParts = new Set(['.git', '.openai', '.local', 'node_modules', 'dist']);

export function sharedPath(path) {
  const parts = path.split('/');
  if (isAbsolute(path) || /[\\:\0]/.test(path) || parts.some(part => !part || part === '..' || part === '.' || protectedParts.has(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part))) return false;
  return rootFiles.has(path) || /^(src|scripts|drizzle|docs|\.github)\//.test(path);
}

function safePath(root, path) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Unsafe path: ${path}`);
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic links require manual review: ${path}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

function localFile(root, path) {
  const target = safePath(root, path);
  if (!existsSync(target)) return null;
  if (!lstatSync(target).isFile()) throw new Error(`Expected a regular file: ${path}`);
  return readFileSync(target);
}

function equal(a, b) {
  if (a === null || b === null) return a === b;
  if (a.equals(b)) return true;
  if (a.includes(0) || b.includes(0)) return false;
  try {
    const decode = value => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value).replace(/\r\n/g, '\n');
    return decode(a) === decode(b);
  } catch { return false; }
}

export function pullGitHub({ root = projectRoot, url = repositoryUrl, mode = 'check', initialize = null, fetch = true } = {}) {
  root = resolve(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const readGit = (commit, path) => execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (resolve(git('rev-parse', '--show-toplevel').trim()) !== root) throw new Error('Run this helper from its own project checkout.');
  const remotes = git('remote').trim().split(/\r?\n/);
  if (!remotes.includes('github')) git('remote', 'add', 'github', url);
  if (git('remote', 'get-url', 'github').trim() !== url) throw new Error('The github remote points somewhere else. Review it before pulling.');
  if (fetch) git('fetch', '--no-tags', 'github', 'main');
  const head = git('rev-parse', 'refs/remotes/github/main').trim();
  const stateFile = safePath(root, '.local/github-sync.json');
  mkdirSync(dirname(stateFile), { recursive: true });
  const lock = safePath(root, '.local/github-sync.lock');
  writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    if (initialize) {
      if (existsSync(stateFile)) throw new Error('The pull baseline is already initialized.');
      if (!/^[a-f0-9]{40}$/.test(initialize)) throw new Error('Use the full SHA of the last shared GitHub commit.');
      git('merge-base', '--is-ancestor', initialize, head);
      writeFileSync(stateFile, JSON.stringify({ repository: url, branch: 'main', commit: initialize }, null, 2) + '\n', { flag: 'wx' });
      return { initialized: initialize, head };
    }
    if (!existsSync(stateFile)) throw new Error('Initialize once with --initialize <last-shared-commit> before pulling.');
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (state.repository !== url || state.branch !== 'main' || !/^[a-f0-9]{40}$/.test(state.commit)) throw new Error('The saved pull baseline does not match this repository.');
    git('merge-base', '--is-ancestor', state.commit, head);
    const tree = commit => new Map(git('ls-tree', '-r', '-z', '--full-tree', commit).split('\0').filter(Boolean).map(entry => {
      const split = entry.indexOf('\t');
      const [mode, type, sha] = entry.slice(0, split).split(' ');
      return [entry.slice(split + 1), { mode, type, sha }];
    }));
    const base = tree(state.commit), incoming = tree(head);
    const changes = [], conflicts = [], skipped = [];
    const paths = new Set([...base.keys(), ...incoming.keys()]);
    const caseNames = new Map(), caseConflicts = new Set();
    for (const path of paths) {
      if (!sharedPath(path)) continue;
      const previous = caseNames.get(path.toLowerCase());
      if (previous && previous !== path) { caseConflicts.add(previous); caseConflicts.add(path); }
      caseNames.set(path.toLowerCase(), path);
    }
    for (const path of paths) {
      const old = base.get(path), next = incoming.get(path);
      if (old?.sha === next?.sha && old?.mode === next?.mode) continue;
      if (!sharedPath(path)) { skipped.push(path); continue; }
      if (caseConflicts.has(path)) { conflicts.push(path); continue; }
      if ([old, next].some(entry => entry && (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)))) {
        conflicts.push(path); continue;
      }
      const before = old ? readGit(state.commit, path) : null;
      const after = next ? readGit(head, path) : null;
      let local;
      try { local = localFile(root, path); } catch { conflicts.push(path); continue; }
      if (equal(local, after)) continue;
      if (!equal(local, before)) { conflicts.push(path); continue; }
      changes.push({ path, local, after });
    }
    const result = { base: state.commit, head, changes: changes.map(c => ({ path: c.path, action: c.after === null ? 'delete' : c.local === null ? 'add' : 'update' })), conflicts, skipped };
    if (mode !== 'apply' || conflicts.length) return result;
    const backup = `.local/github-backups/${Date.now()}-${randomUUID()}`;
    const applied = [];
    try {
      for (const change of changes) {
        if (!equal(localFile(root, change.path), change.local)) throw new Error(`File changed during pull: ${change.path}`);
        if (change.local !== null) {
          const saved = safePath(root, `${backup}/${change.path}`);
          mkdirSync(dirname(saved), { recursive: true });
          writeFileSync(saved, change.local, { flag: 'wx' });
        }
        const target = safePath(root, change.path);
        if (change.after === null) unlinkSync(target);
        else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, change.after); }
        applied.push(change);
      }
      writeFileSync(stateFile, JSON.stringify({ ...state, commit: head }, null, 2) + '\n');
    } catch (error) {
      for (const change of applied.reverse()) {
        if (!equal(localFile(root, change.path), change.after)) continue;
        const target = safePath(root, change.path);
        if (change.local === null) unlinkSync(target);
        else writeFileSync(target, change.local);
      }
      throw error;
    }
    return { ...result, applied: true, backup: changes.some(c => c.local !== null) ? backup : null };
  } finally { unlinkSync(lock); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    const initialize = args[0] === '--initialize' && args.length === 2 ? args[1] : null;
    if (!initialize && args.length && !(args.length === 1 && ['--apply', '--check'].includes(args[0]))) throw new Error('Usage: node scripts/pull-github.mjs [--check | --apply | --initialize <commit-sha>]');
    const result = pullGitHub({ mode: args[0] === '--apply' ? 'apply' : 'check', initialize });
    console.log(JSON.stringify(result, null, 2));
    if (result.conflicts?.length) {
      console.error('Pull stopped before changing files. Resolve the listed local/remote conflicts, then retry.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
