import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function nextVersion(current, bump) {
  if (!semver.test(current)) throw new Error(`不支持的版本号：${current}`);
  const [major, minor, patch] = current.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`不支持的升级幅度：${bump}`);
}

export function inferBump(commits) {
  if (commits.some(({ subject, body }) =>
    /^[a-z]+(?:\([^\r\n]*\))?!:/i.test(subject) || /^BREAKING[ -]CHANGE:\s/m.test(body))) return 'major';
  if (commits.some(({ subject }) => /^feat(?:\([^\r\n]*\))?:/i.test(subject))) return 'minor';
  return 'patch';
}

export function updateVersions(version) {
  if (!semver.test(version)) throw new Error(`不支持的版本号：${version}`);
  for (const path of ['package.json', 'src-tauri/tauri.conf.json']) {
    const data = readJson(path);
    data.version = version;
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  for (const path of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
    const source = readFileSync(path, 'utf8');
    const section = path.endsWith('.lock')
      ? /(\[\[package\]\]\r?\nname = "mhxy-ledger"\r?\nversion = ")[^"]+(")/
      : /(\[package\][\s\S]*?\nversion = ")[^"]+(")/;
    // Only the application's package version changes, never dependency versions.
    if (!section.test(source)) throw new Error(`找不到应用版本：${path}`);
    writeFileSync(path, source.replace(section, (_, prefix, suffix) => `${prefix}${version}${suffix}`));
  }
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const records = git('log', '--reverse', '--format=%H%x00%s%x00%b%x00%x1e', range);
  return records.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, subject, body] = record.split('\0');
    return { hash, subject, body };
  });
}

const escapeMarkdown = (value) => value.replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');

export function releaseNotes(version, previousTag, commits, repository) {
  const groups = new Map([
    ['新增功能', []], ['问题修复', []], ['性能优化', []], ['其他变更', []],
  ]);
  for (const commit of commits) {
    const type = commit.subject.match(/^([a-z]+)(?:\(.*\))?!?:/i)?.[1].toLowerCase();
    const group = { feat: '新增功能', fix: '问题修复', perf: '性能优化' }[type] ?? '其他变更';
    const url = `https://github.com/${repository}/commit/${commit.hash}`;
    groups.get(group).push(`- ${escapeMarkdown(commit.subject)} ([${commit.hash.slice(0, 7)}](${url}))`);
  }
  const lines = [`# 梦幻记账 v${version}`, '', '支持 Windows x86-64。可下载 EXE 或 MSI 安装包。', '',
    previousTag ? `以下为 ${previousTag} 以来的全部 ${commits.length} 条提交。` : `首次发布，包含全部 ${commits.length} 条提交。`];
  for (const [title, entries] of groups) {
    if (entries.length) lines.push('', `## ${title}`, '', ...entries);
  }
  if (previousTag) lines.push('', `[完整差异](https://github.com/${repository}/compare/${previousTag}...v${version})`);
  return `${lines.join('\n')}\n`;
}

export function prepareRelease(bump = 'auto') {
  if (!['auto', 'major', 'minor', 'patch'].includes(bump)) throw new Error(`不支持的升级幅度：${bump}`);
  const current = readJson('package.json').version;
  if (!semver.test(current)) throw new Error(`不支持的版本号：${current}`);
  const tags = git('tag', '--merged', 'HEAD', '--sort=-version:refname').split('\n')
    .filter((tag) => tag.startsWith('v') && semver.test(tag.slice(1)));
  let previousTag = tags[0];
  // Retrying a run that already pushed its tag must reuse the same version.
  const retry = bump === 'auto' && previousTag && git('rev-list', '-n', '1', previousTag) === git('rev-parse', 'HEAD');
  if (retry && previousTag !== `v${current}`) throw new Error('标签版本与项目版本不一致');
  if (retry) previousTag = tags[1];
  const commits = commitsSince(previousTag);
  const version = retry ? current : previousTag
    ? nextVersion(previousTag.slice(1), bump === 'auto' ? inferBump(commits) : bump)
    : bump === 'auto' ? current : nextVersion(current, bump);
  const tag = `v${version}`;
  if (!retry && git('tag', '--list', tag)) throw new Error(`标签 ${tag} 已存在，拒绝覆盖`);
  updateVersions(version);
  mkdirSync('.release', { recursive: true });
  writeFileSync('.release/notes.md', releaseNotes(version, previousTag, commits,
    process.env.GITHUB_REPOSITORY ?? 'hi-liyan/mhxy-tool'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
  console.log(`发布 ${tag}；基线 ${previousTag ?? '首次发布'}；${commits.length} 条提交`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareRelease(process.argv[2] ?? 'auto');
}
