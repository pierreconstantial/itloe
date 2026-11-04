// Package committed runtime files, never a developer's saves, secrets or working-tree edits.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node.split('.')[0] !== '24') {
  throw new Error('Build releases on Linux x64 with Node 24');
}
const root = new URL('..', import.meta.url).pathname;
const commit = execFileSync('git', ['rev-parse', '--verify', `${process.argv[2] ?? 'HEAD'}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const output = join(root, 'dist', 'release');
const name = `itloe-${commit}-linux-x64.tar.gz`;
const stage = mkdtempSync(join(tmpdir(), 'itloe-release-'));
try {
  const source = execFileSync('git', ['archive', commit, 'server', 'shared', 'public', 'data/quiz', 'package.json', 'package-lock.json'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', stage], { input: source });
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
  writeFileSync(join(stage, 'release.json'), JSON.stringify({ commit, nodeMajor: 24, platform: 'linux', arch: 'x64' }) + '\n');
  mkdirSync(output, { recursive: true });
  execFileSync('tar', ['-czf', join(output, name), '-C', stage,
    'server', 'shared', 'public', 'data', 'node_modules', 'package.json', 'package-lock.json', 'release.json']);
  const digest = createHash('sha256').update(readFileSync(join(output, name))).digest('hex');
  writeFileSync(join(output, 'SHA256SUMS'), `${digest}  ${name}\n`);
  console.log(join(output, name));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
