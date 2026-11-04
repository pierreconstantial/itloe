// Q2 — which address phones should use: LAN interface picker.
// BLOKO_HOST = an interface name or an address (used verbatim, e.g. the Windows host IP when running in WSL).
// Otherwise: one external IPv4 → it; several → numbered prompt on a TTY (Enter / timeout = first), else first.

import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline/promises';

export type Lan = { iface: string, address: string };

const PROMPT_TIMEOUT_MS = 20_000;

export function externalIPv4s(): Lan[] {
  const out: Lan[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ iface, address: a.address });
    }
  }
  return out;
}

export async function pickLan(): Promise<Lan | null> {
  const all = externalIPv4s();
  const forced = process.env.BLOKO_HOST?.trim();
  if (forced) {
    return all.find((l) => l.iface === forced || l.address === forced) ?? { iface: 'BLOKO_HOST', address: forced };
  }
  if (all.length <= 1 || !process.stdin.isTTY) return all[0] ?? null;

  console.log('[itloe] several network interfaces — which one do the phones reach?');
  all.forEach((l, i) => console.log(`  ${i + 1}) ${l.address}  (${l.iface})`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`  choice [1] (${PROMPT_TIMEOUT_MS / 1000}s): `, {
      signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
    });
    const n = Number(answer.trim() || '1');
    return all[n - 1] ?? all[0];
  } catch {
    console.log('\n[itloe] no answer — using the first interface');
    return all[0];
  } finally {
    rl.close();
  }
}
