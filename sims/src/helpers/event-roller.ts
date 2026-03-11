import path from "node:path";
import { parseArgs, resolveSimDir, readJSON, resolveStatePath } from "@/helpers/utils.js";
import type { EventPool, EventPoolItem, RolledEvent, WorldState } from "@/helpers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** events_log からこれまでに発生した全イベントの id 一覧を返す */
function pastEventIds(worldState: WorldState): string[] {
  return worldState.events_log.flatMap((entry) =>
    entry.events
      .filter((e) => e.source === "pool" || e.source === "generated")
      .map((e) => e.id),
  );
}

/**
 * 指定イベントが最後に発生した四半期の turn_number を返す。
 * 一度も発生していなければ -Infinity を返す。
 */
function lastOccurrenceTurn(id: string, worldState: WorldState): number {
  // metrics_history と同期した turn index として events_log の配列インデックスを利用する
  for (let i = worldState.events_log.length - 1; i >= 0; i--) {
    if (worldState.events_log[i].events.some((e) => e.id === id)) {
      // turn_number はメタから取るより log インデックスで近似する
      // (turn_number = log エントリ数 - 1 - i) を逆算
      return worldState.meta.turn_number - (worldState.events_log.length - 1 - i);
    }
  }
  return -Infinity;
}

/** world-state の現在値が conditions を満たすか確認する */
function checkConditions(
  event: EventPoolItem,
  worldState: WorldState,
  pastIds: string[],
): { ok: boolean; reason?: string } {
  const cond = event.conditions;
  if (!cond) return { ok: true };

  // one_shot チェック
  if (event.one_shot && pastIds.includes(event.id)) {
    return { ok: false, reason: "one_shot: already occurred" };
  }

  // cooldown チェック
  const cooldown = event.cooldown_quarters ?? 0;
  if (cooldown > 0) {
    const lastTurn = lastOccurrenceTurn(event.id, worldState);
    const elapsed = worldState.meta.turn_number - lastTurn;
    if (elapsed < cooldown) {
      return { ok: false, reason: `cooldown: ${elapsed}/${cooldown}Q elapsed` };
    }
  }

  // requires_events チェック
  if (cond.requires_events) {
    for (const req of cond.requires_events) {
      if (!pastIds.includes(req)) {
        return { ok: false, reason: `requires_events: "${req}" not yet occurred` };
      }
    }
  }

  // excludes_events チェック
  if (cond.excludes_events) {
    for (const excl of cond.excludes_events) {
      if (pastIds.includes(excl)) {
        return { ok: false, reason: `excludes_events: "${excl}" already occurred` };
      }
    }
  }

  // state_min チェック
  if (cond.state_min) {
    for (const [key, min] of Object.entries(cond.state_min)) {
      const val = worldState.state[key];
      if (val === undefined || val < min) {
        return { ok: false, reason: `state_min: ${key}=${val} < ${min}` };
      }
    }
  }

  // state_max チェック
  if (cond.state_max) {
    for (const [key, max] of Object.entries(cond.state_max)) {
      const val = worldState.state[key];
      if (val === undefined || val > max) {
        return { ok: false, reason: `state_max: ${key}=${val} > ${max}` };
      }
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// candidateEvents – conditions を満たすイベントを候補リストとして返す
// ---------------------------------------------------------------------------

function candidateEvents(
  simDir: string,
  options: { scenario?: string; branch?: string; maxSlots?: number },
): { candidates: RolledEvent[]; max_slots: number } {
  const resolved = resolveSimDir(simDir);

  const poolPath = path.join(resolved, "events", "event-pool.json");
  const pool = readJSON<EventPool>(poolPath);

  const statePath = resolveStatePath(simDir, { branch: options.branch, scenario: options.scenario });
  const worldState = readJSON<WorldState>(statePath);

  const maxSlots = options.maxSlots ?? worldState.meta.max_events_per_quarter;
  const pastIds = pastEventIds(worldState);

  const candidates: RolledEvent[] = [];

  for (const event of pool.events) {
    const { ok } = checkConditions(event, worldState, pastIds);
    if (ok) {
      candidates.push({ ...event, source: "pool" });
    }
  }

  return { candidates, max_slots: maxSlots };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (command !== "candidates") {
    console.error(`Unknown command: ${command}. Usage: event-roller.ts candidates <simDir> [--scenario <name>] [--branch <name>] [--max <N>]`);
    process.exit(1);
  }

  const simDir = positional[1];
  if (!simDir) {
    console.error("Usage: event-roller.ts candidates <simDir> [--scenario <name>] [--branch <name>] [--max <N>]");
    process.exit(1);
  }

  const scenario = typeof flags.scenario === "string" ? flags.scenario : undefined;
  const branch = typeof flags.branch === "string" ? flags.branch : undefined;
  const maxSlots = typeof flags.max === "string" ? parseInt(flags.max, 10) : undefined;

  const result = candidateEvents(simDir, { scenario, branch, maxSlots });
  console.log(JSON.stringify(result, null, 2));
}

main();
