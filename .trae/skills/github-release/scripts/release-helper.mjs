/**
 * GitHub Release 辅助脚本
 * 用法: node .trae/skills/github-release/scripts/release-helper.mjs <command>
 *
 * 命令:
 *   analyze    分析从最新 tag 到 HEAD 的提交，按类型分类输出 JSON
 *   bump       升级 package.json 版本号并输出新版本
 *   changelog  生成 CHANGELOG 条目内容
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../../../../');

// ── 工具函数 ──────────────────────────────────────────────

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

function getLatestTag() {
  try {
    // 优先使用与当前版本号匹配的 tag，避免异常 tag 干扰
    const currentVer = getCurrentVersion();
    const tags = run('git tag --sort=-v:refname').split('\n').filter(Boolean);
    const matchTag = tags.find(t => t === `v${currentVer}`);
    if (matchTag) return matchTag;
    // 回退：按版本排序取最新（排除明显异常的 major 版本跳跃）
    const currentMajor = parseInt(currentVer.split('.')[0], 10);
    const validTags = tags.filter(t => {
      const m = t.match(/^v?(\d+)\./);
      return m && parseInt(m[1], 10) <= currentMajor + 1;
    });
    return validTags[0] || tags[0] || null;
  } catch {
    return null;
  }
}

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function getRepoInfo() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const homepage = pkg.homepage || '';
  // https://github.com/owner/repo -> { owner, repo }
  const match = homepage.match(/github\.com\/([^/]+)\/([^/]+)/);
  return match ? { owner: match[1], repo: match[2] } : { owner: '', repo: '' };
}

function bumpVersion(current, commits, userVersion) {
  // 用户指定版本号时直接使用
  if (userVersion) return userVersion;
  // 默认 patch +1（0.0.9 → 0.0.10）
  const [major, minor, patch] = current.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// ── 命令: analyze ─────────────────────────────────────────

function cmdAnalyze(userVersion) {
  const latestTag = getLatestTag();
  const logRange = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const rawLog = run(`git log ${logRange} --pretty=format:"%h||%s"`);

  if (!rawLog) {
    console.log(JSON.stringify({ commits: [], latestTag, hasNewCommits: false }));
    return;
  }

  const typeMap = {
    feat: 'Features', fix: 'Bug Fixes', refactor: 'Refactor',
    perf: 'Performance', docs: 'Documentation', build: 'Build',
    ci: 'Build', chore: 'Chore', test: 'Test', style: 'Style',
    revert: 'Revert'
  };

  const commits = rawLog.split('\n').map(line => {
    const [hash, subject] = line.split('||');
    const match = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
    if (!match) return { hash, type: 'other', scope: '', message: subject };
    return { hash, type: match[1], scope: match[2] || '', message: match[3] };
  });

  const currentVersion = getCurrentVersion();
  const newVersion = bumpVersion(currentVersion, commits, userVersion);

  console.log(JSON.stringify({
    commits,
    latestTag,
    currentVersion,
    newVersion,
    hasNewCommits: true,
    groupedByType: Object.entries(
      commits.reduce((acc, c) => {
        const section = typeMap[c.type] || 'Other';
        if (!acc[section]) acc[section] = [];
        acc[section].push(c);
        return acc;
      }, {})
    )
  }, null, 2));
}

// ── 命令: bump ────────────────────────────────────────────

function cmdBump(newVersion) {
  const pkgPath = resolve(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const oldVersion = pkg.version;
  pkg.version = newVersion || bumpVersion(oldVersion, [], null);
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(JSON.stringify({ oldVersion, newVersion: pkg.version }));
}

// ── 命令: changelog ───────────────────────────────────────

function cmdChangelog(newVersion) {
  const latestTag = getLatestTag();
  const currentVersion = getCurrentVersion();
  const { owner, repo } = getRepoInfo();
  const targetVersion = newVersion || currentVersion;
  const today = new Date().toISOString().split('T')[0];

  const compareUrl = latestTag
    ? `https://github.com/${owner}/${repo}/compare/${latestTag}...v${targetVersion}`
    : `https://github.com/${owner}/${repo}/commits/v${targetVersion}`;

  console.log(JSON.stringify({
    version: targetVersion,
    date: today,
    compareUrl,
    previousTag: latestTag
  }));
}

// ── 命令: release-notes ────────────────────────────────────

function cmdReleaseNotes(newVersion) {
  const latestTag = getLatestTag();
  const currentVersion = getCurrentVersion();
  const { owner, repo } = getRepoInfo();
  const targetVersion = newVersion || currentVersion;
  const logRange = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const rawLog = run(`git log ${logRange} --pretty=format:"%h||%s"`);

  const typeMap = {
    feat: 'Highlights', fix: 'Fixes', refactor: 'Refactor',
    perf: 'Performance', docs: 'Documentation', build: 'Build',
    ci: 'Build', chore: 'Chore', test: 'Test', style: 'Style',
    revert: 'Revert'
  };

  // Only include these sections in release notes
  const includedSections = new Set(['Highlights', 'Fixes', 'Refactor', 'Performance']);

  let commits = [];
  if (rawLog) {
    commits = rawLog.split('\n').map(line => {
      const [hash, subject] = line.split('||');
      const match = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
      if (!match) return { hash, type: 'other', scope: '', message: subject };
      return { hash, type: match[1], scope: match[2] || '', message: match[3] };
    });
  }

  const grouped = {};
  for (const c of commits) {
    const section = typeMap[c.type] || 'Other';
    if (!includedSections.has(section)) continue;
    if (!grouped[section]) grouped[section] = [];
    grouped[section].push(c);
  }

  const compareUrl = latestTag
    ? `https://github.com/${owner}/${repo}/compare/${latestTag}...v${targetVersion}`
    : `https://github.com/${owner}/${repo}/commits/v${targetVersion}`;

  console.log(JSON.stringify({
    version: targetVersion,
    previousTag: latestTag,
    compareUrl,
    sections: grouped,
    totalCommits: commits.length
  }, null, 2));
}

// ── 入口 ──────────────────────────────────────────────────

const [,, command, arg] = process.argv;

switch (command) {
  case 'analyze':  cmdAnalyze(arg); break;
  case 'bump':     cmdBump(arg); break;
  case 'changelog': cmdChangelog(arg); break;
  case 'release-notes': cmdReleaseNotes(arg); break;
  default:
    console.error('用法: node release-helper.mjs <analyze|bump|changelog|release-notes> [version]');
    process.exit(1);
}
