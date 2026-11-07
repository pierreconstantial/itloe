// The e2e runner: the one way to run the end-to-end suites. Blocks until every requested suite is done,
// then prints one line per suite, the FAIL lines of failed ones, and an overall line; exits 1 on a failure.
// Usage: npm run e2e [-- [--shots <dir> [--compare <ref>]] <suite>…]      (no suite: all of them)
//   suites: base resume presence campaign quiz pyramide backgammon inventory tv phone; phone:<n> = ONLY=<n>, tv:<section> = ONLY=<section>
//   --shots <dir>: SHOTS=<dir>/<suite> for the tv and phone suites (each must be new or empty).
//   --compare <ref>: then compares those screenshots with <ref>/<suite>, an earlier --shots folder (e2e-compare.mts).
//   LOCK_MS and E2E_SLOW pass through.
// Each suite runs as a job through scripts/e2e-slot.sh (the machine's shared slots), all of them in parallel.
// A job (`--job <suite>`, run by the slot) picks free ports, starts what the suite needs (headless Chrome for
// the browser suites, a server on the sample content for base), runs it and stops them. Every job's scratch
// files (the suites' data folders, Chrome's profile) live in TMPDIR, a folder this runner removes at the end,
// also after a failure, a Ctrl-C or the deadline.
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compareShots } from './e2e-compare.mts';
import { freePort, killGroups, startChrome, startServer, stop } from './e2e-lib.mts';

const ROOT = new URL('..', import.meta.url).pathname;
const SELF = new URL(import.meta.url).pathname;
const SLOT = join(ROOT, 'scripts/e2e-slot.sh');
/** Past this, everything still running or waiting is stopped: a run must fit a 10-minute foreground command. */
const DEADLINE_MS = 9 * 60_000;

/** The suites, longest first: they start first, so they get the first slots. `<suite>:<x>` runs a `focus` suite
 *  with ONLY=x, one of its parts; the suite itself refuses an unknown part and lists its parts. */
const SUITES: Record<string, { script: string, browser?: boolean, server?: boolean, focus?: boolean, env?: Record<string, string> }> = {
  phone: { script: 'e2e-phone.mts', browser: true, focus: true, env: { LOCK_MS: '20000' } },
  tv: { script: 'e2e-tv.mts', browser: true, focus: true },
  campaign: { script: 'e2e-campaign.mts' },
  quiz: { script: 'e2e-quiz.mts' },
  pyramide: { script: 'e2e-pyramide.mts', browser: true },
  backgammon: { script: 'e2e-backgammon.mts', browser: true },
  inventory: { script: 'e2e-inventory.mts' },
  resume: { script: 'e2e-resume.mts' },
  presence: { script: 'e2e-presence.mts' },
  base: { script: 'e2e.mts', server: true },
};

/** `phone:4` → the phone suite with ONLY=4; null for an unknown suite. */
function parse(spec: string): { suite: string, only?: string } | null {
  const [suite, only, ...rest] = spec.split(':');
  if (!SUITES[suite] || rest.length || (only !== undefined && (!SUITES[suite].focus || !only))) return null;
  return { suite, only };
}

// ---------- a job: one suite, inside a slot ----------
async function job(spec: string): Promise<number> {
  const { suite, only } = parse(spec)!;
  const def = SUITES[suite];
  const scratch = tmpdir(); // the runner's folder for this job
  const env: Record<string, string | undefined> = { ...def.env, ...process.env, PORT: String(await freePort()) };
  if (only) env.ONLY = only;
  console.log(`e2e-run: started ${spec} on PORT=${env.PORT}`);
  let chrome: ChildProcess | null = null, server: ChildProcess | null = null;
  try {
    if (def.browser) {
      ({ proc: chrome, cdp: env.CDP } = await startChrome(join(scratch, 'chrome')));
      console.log(`e2e-run: Chrome on CDP=${env.CDP}`);
    }
    if (def.server) {
      server = (await startServer(env.PORT!, join(scratch, 'var'), 'sample', { env })).proc;
    }
    const run = spawn(process.execPath, [join(ROOT, 'scripts', def.script)], { env, stdio: 'inherit' });
    return await new Promise<number>((r) => run.once('exit', (code) => r(code ?? 1)));
  } catch (e) {
    console.log(`e2e-run: ${(e as Error).message}`);
    return 1;
  } finally {
    await stop(server);
    await stop(chrome);
  }
}

// ---------- the runner ----------
type Run = { spec: string, name: string, log: string, proc: ChildProcess, queued: number, started?: number, ended?: number, code?: number | null, timedOut?: boolean };

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

async function runner(args: string[]): Promise<number> {
  let shots: string | undefined, compare: string | undefined;
  const specs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--shots') { shots = args[++i]; if (!shots) return usage('--shots needs a folder'); }
    else if (args[i] === '--compare') { compare = args[++i]; if (!compare) return usage('--compare needs a reference folder'); }
    else specs.push(args[i]);
  }
  const bad = specs.filter((s) => !parse(s));
  if (bad.length) return usage(`unknown suite: ${bad.join(', ')}`);
  if (!specs.length) specs.push(...Object.keys(SUITES));
  if (new Set(specs).size !== specs.length) return usage('a suite is named twice');
  specs.sort((a, b) => Object.keys(SUITES).indexOf(parse(a)!.suite) - Object.keys(SUITES).indexOf(parse(b)!.suite));
  /** The folder names of the suites that take screenshots (`phone:4` → phone-4). */
  const shooting = specs.filter((s) => SUITES[parse(s)!.suite].browser).map((s) => s.replace(':', '-'));
  if (compare && !shots) return usage('--compare needs --shots <dir> for the new screenshots');
  if (compare && !existsSync(compare)) return usage(`no reference folder ${compare}`);
  if (shots && !shooting.length) return usage('only the tv and phone suites take screenshots');
  // a fresh folder per suite: no stale screen from an earlier run, and a reference is never overwritten
  const used = shooting.filter((n) => shots && existsSync(join(shots, n)) && readdirSync(join(shots, n)).length);
  if (used.length) return usage(`${used.map((n) => join(shots!, n)).join(', ')} already holds screenshots: pick another --shots folder`);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const logs = join(tmpdir(), 'itloe-e2e-logs', `${stamp}-${process.pid}`);
  mkdirSync(logs, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'itloe-e2e-run-'));
  console.log(`e2e: ${specs.join(' ')}  (logs in ${logs})`);

  const t0 = Date.now();
  let interrupted = false;
  const others: number[] = []; // process groups besides the jobs': the comparison's Chrome
  const runs: Run[] = specs.map((spec) => {
    const name = spec.replace(':', '-');
    const dir = join(scratch, name);
    mkdirSync(dir);
    const env: Record<string, string | undefined> = { ...process.env, TMPDIR: dir };
    for (const k of ['PORT', 'CDP', 'ONLY', 'SHOTS', 'BLOKO_VAR']) delete env[k];
    if (shots && SUITES[parse(spec)!.suite].browser) env.SHOTS = join(resolve(shots), name);
    const log = join(logs, `${name}.log`);
    const out = createWriteStream(log);
    // its own process group, so the whole tree can be stopped at once
    const proc = spawn(SLOT, [process.execPath, SELF, '--job', spec], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const r: Run = { spec, name, log, proc, queued: Date.now() };
    const take = (d: Buffer) => { if (!r.started && String(d).includes('e2e-run: started')) r.started = Date.now(); out.write(d); };
    proc.stdout!.on('data', take);
    proc.stderr!.on('data', take);
    return r;
  });
  const done = Promise.all(runs.map((r) => new Promise<void>((res) => r.proc.once('close', (code) => {
    r.ended = Date.now(); r.code = code;
    if (!r.timedOut && !interrupted) console.log(`  ${r.spec} ${code === 0 ? 'passed' : 'failed'} (${fmt(r.ended - (r.started ?? r.queued))})`);
    res();
  }))));

  const abort = async (why: 'deadline' | 'interrupt') => {
    if (why === 'interrupt') { if (interrupted) return; interrupted = true; console.log('\ne2e: interrupted, stopping the suites…'); }
    else { for (const r of runs) if (r.ended === undefined) r.timedOut = true; console.log(`e2e: past the ${fmt(DEADLINE_MS)} deadline, stopping the suites still running or waiting…`); }
    await killGroups([...runs.filter((r) => r.ended === undefined).map((r) => r.proc.pid!), ...others]);
  };
  process.on('SIGINT', () => void abort('interrupt'));
  process.on('SIGTERM', () => void abort('interrupt'));
  const deadline = setTimeout(() => void abort('deadline'), DEADLINE_MS);
  await done;
  clearTimeout(deadline);
  await killGroups(runs.map((r) => r.proc.pid!)); // whatever a job left behind in its group (normally nothing)
  if (compare && !interrupted) {
    try {
      const chrome = await startChrome(join(scratch, 'compare-chrome'), true);
      others.push(chrome.proc.pid!);
      await compareShots(chrome.cdp, resolve(shots!), resolve(compare), shooting);
    } catch (e) {
      console.log(`\ne2e: the comparison failed: ${(e as Error).message}`);
    }
    await killGroups(others);
  }
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });

  console.log('');
  let failed = 0;
  const width = Math.max(...runs.map((r) => r.spec.length));
  for (const r of runs) {
    const text = existsSync(r.log) ? readFileSync(r.log, 'utf8') : '';
    const lines = text.split('\n');
    const fails = lines.filter((l) => l.startsWith('FAIL'));
    const checks = lines.filter((l) => l.startsWith('PASS')).length + fails.length;
    const pass = r.code === 0 && !fails.length && checks > 0;
    const note = r.timedOut ? (r.started ? ' (stopped at the deadline)' : ' (never got a slot before the deadline)')
      : interrupted && r.code !== 0 ? ' (interrupted)'
      : r.code === 0 && !checks ? ' (no checks ran)' : '';
    const wait = r.started && r.started - r.queued >= 5000 ? ` (+${fmt(r.started - r.queued)} waiting for a slot)` : '';
    const took = r.started ? fmt(r.ended! - r.started) : '-';
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${r.spec.padEnd(width)}  ${took.padStart(6)}${wait}  ${r.log}${note}`);
    if (pass) continue;
    failed++;
    // its FAIL lines, or for a crash or a stop without any, the end of its log
    const show = fails.length ? fails : lines.filter((l) => l.trim()).slice(-12);
    for (const l of show) console.log(`      ${l}`);
  }
  const total = fmt(Date.now() - t0);
  console.log(failed ? `\nFAILED: ${failed} of ${runs.length} suite(s) in ${total}` : `\nALL PASS: ${runs.length} suite(s) in ${total}`);
  return interrupted ? 130 : failed ? 1 : 0;
}

function usage(msg: string): number {
  console.error(`e2e: ${msg}\nUsage: npm run e2e [-- [--shots <dir> [--compare <ref>]] <suite>…]\n  suites: ${Object.keys(SUITES).join(' ')}\n  one part (the suite's ONLY; an unknown one lists them): ${Object.entries(SUITES).filter(([, d]) => d.focus).map(([n]) => `${n}:<part>`).join('  ')}`);
  return 2;
}

const args = process.argv.slice(2);
process.exit(args[0] === '--job' ? await job(args[1]) : await runner(args));
