import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inferBump, nextVersion, releaseNotes } from '../scripts/release.mjs';

test('semantic version increments and breaking changes', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => nextVersion('01.2.3', 'patch'));
  const commit = (subject, body = '') => ({ subject, body });
  assert.equal(inferBump([commit('fix: 修复')]), 'patch');
  assert.equal(inferBump([commit('整理文档')]), 'patch');
  assert.equal(inferBump([commit('feat(物品库): 新功能')]), 'minor');
  assert.equal(inferBump([commit('feat: 功能'), commit('refactor!: 删除接口')]), 'major');
  assert.equal(inferBump([commit('fix: 兼容', 'BREAKING CHANGE: 新数据格式')]), 'major');
});

test('notes group every commit, including non-conventional messages', () => {
  const commits = ['feat: 功能', 'fix(ui): 修复', 'perf: 性能', '整理文档 [链接]', 'chore: 配置']
    .map((subject, index) => ({ subject, hash: String(index).repeat(40), body: '' }));
  const notes = releaseNotes('1.1.0', 'v1.0.0', commits, 'owner/repo');
  assert.equal((notes.match(/^- /gm) ?? []).length, commits.length);
  assert.match(notes, /## 新增功能/);
  assert.match(notes, /## 问题修复/);
  assert.match(notes, /## 性能优化/);
  assert.match(notes, /整理文档 \\\[链接\\\]/);
  assert.match(notes, /compare\/v1.0.0\.\.\.v1.1.0/);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mhxy-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src-tauri'));
  writeFileSync(join(root, '.gitignore'), '.release/\n');
  writeFileSync(join(root, 'package.json'), '{"version":"0.1.0"}\n');
  writeFileSync(join(root, 'src-tauri/tauri.conf.json'), '{"version":"0.1.0"}\n');
  writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "mhxy-ledger"\nversion = "0.1.0"\n');
  writeFileSync(join(root, 'src-tauri/Cargo.lock'),
    'version = 4\n\n[[package]]\nname = "mhxy-ledger"\nversion = "0.1.0"\n\n[[package]]\nname = "other"\nversion = "0.1.0"\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'test@example.com');
  const commit = (message) => {
    git('add', '.');
    git('commit', '--allow-empty', '-m', message);
  };
  commit('初始提交');
  const prepare = (bump = 'auto') => execFileSync(process.execPath,
    [fileURLToPath(new URL('../scripts/release.mjs', import.meta.url)), bump],
    { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_REPOSITORY: 'owner/repo' } });
  const read = (path) => readFileSync(join(root, path), 'utf8');
  return { root, git, commit, prepare, read };
}

test('first release, incremental release, version synchronization and retry', (t) => {
  const { git, commit, prepare, read } = fixture(t);
  prepare();
  assert.equal(JSON.parse(read('package.json')).version, '0.1.0');
  assert.match(read('.release/notes.md'), /首次发布，包含全部 1 条提交/);
  commit('chore(release): v0.1.0 [skip ci]');
  git('tag', 'v0.1.0');
  commit('feat(物品库): 新增功能');
  commit('修正文档');
  prepare();
  for (const path of ['package.json', 'src-tauri/tauri.conf.json']) {
    assert.equal(JSON.parse(read(path)).version, '0.2.0');
  }
  assert.match(read('src-tauri/Cargo.toml'), /version = "0.2.0"/);
  assert.match(read('src-tauri/Cargo.lock'), /name = "mhxy-ledger"\nversion = "0.2.0"/);
  assert.match(read('src-tauri/Cargo.lock'), /name = "other"\nversion = "0.1.0"/);
  assert.match(read('.release/notes.md'), /全部 2 条提交/);
  assert.doesNotMatch(read('.release/notes.md'), /初始提交/);
  commit('chore(release): v0.2.0 [skip ci]');
  git('tag', 'v0.2.0');
  prepare();
  assert.equal(JSON.parse(read('package.json')).version, '0.2.0');
  assert.match(read('.release/notes.md'), /新增功能/);
  commit('fix: 修复错误');
  prepare();
  assert.equal(JSON.parse(read('package.json')).version, '0.2.1');
});

test('manual bump and breaking footer produce major versions', (t) => {
  const { git, commit, prepare, read } = fixture(t);
  git('tag', 'v0.1.0');
  commit('更新配置');
  prepare('major');
  assert.equal(JSON.parse(read('package.json')).version, '1.0.0');
  prepare('minor');
  assert.equal(JSON.parse(read('package.json')).version, '0.2.0');
  commit('refactor: 调整数据\n\nBREAKING CHANGE: 不兼容旧接口');
  prepare();
  assert.equal(JSON.parse(read('package.json')).version, '1.0.0');
});
