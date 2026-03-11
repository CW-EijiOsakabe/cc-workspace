import { parseArgs, resolveStatePath, readJSON, writeJSON, readStdin } from "@/helpers/utils.js";
import type { WorldState, DeltaResult } from "@/helpers/types.js";

// ---------------------------------------------------------------------------
// loadState – Load world-state.json from the resolved path
// ---------------------------------------------------------------------------

function loadState(simDir: string, flags: Record<string, string | boolean>): WorldState {
  const statePath = resolveStatePath(simDir, {
    branch: typeof flags.branch === "string" ? flags.branch : undefined,
    scenario: typeof flags.scenario === "string" ? flags.scenario : undefined,
  });
  return readJSON<WorldState>(statePath);
}

// ---------------------------------------------------------------------------
// saveState – Write world-state.json back to disk
// ---------------------------------------------------------------------------

function saveState(simDir: string, flags: Record<string, string | boolean>, state: WorldState): void {
  const statePath = resolveStatePath(simDir, {
    branch: typeof flags.branch === "string" ? flags.branch : undefined,
    scenario: typeof flags.scenario === "string" ? flags.scenario : undefined,
  });
  writeJSON(statePath, state);
}

// ---------------------------------------------------------------------------
// applyDelta – Apply a delta to the state with numeric constraint enforcement
// ---------------------------------------------------------------------------

function applyDelta(
  state: WorldState,
  delta: Record<string, number>,
  agentId: string,
): DeltaResult {
  const applied: Record<string, number> = {};
  const clamped: string[] = [];
  const rejected: string[] = [];

  const maxPct = state.meta.max_delta_pct;

  for (const [key, newValue] of Object.entries(delta)) {
    // Reject keys that don't exist in state
    if (!(key in state.state)) {
      rejected.push(key);
      continue;
    }

    const oldValue = state.state[key];

    // Calculate change ratio and enforce clamping
    if (oldValue === 0) {
      // When oldValue is 0, use absolute difference check against max_delta_pct
      const absDiff = Math.abs(newValue - oldValue);
      if (absDiff > maxPct) {
        // Clamp: allow at most maxPct change in the direction of newValue
        const clampedValue = newValue > oldValue ? oldValue + maxPct : oldValue - maxPct;
        state.state[key] = clampedValue;
        applied[key] = clampedValue;
        clamped.push(key);
      } else {
        state.state[key] = newValue;
        applied[key] = newValue;
      }
    } else {
      const ratio = Math.abs(newValue - oldValue) / Math.abs(oldValue);
      if (ratio > maxPct) {
        // Clamp to max allowed change
        const maxChange = Math.abs(oldValue) * maxPct;
        const clampedValue = newValue > oldValue ? oldValue + maxChange : oldValue - maxChange;
        state.state[key] = clampedValue;
        applied[key] = clampedValue;
        clamped.push(key);
      } else {
        state.state[key] = newValue;
        applied[key] = newValue;
      }
    }
  }

  // Append to events_log
  state.events_log.push({
    quarter: state.meta.current_quarter,
    events: [
      {
        id: `delta-${agentId}-${Date.now()}`,
        name: `Delta applied by ${agentId}`,
        description: `Agent ${agentId} applied delta: ${JSON.stringify(applied)}. Clamped: [${clamped.join(", ")}]. Rejected: [${rejected.join(", ")}].`,
        impact_areas: Object.keys(applied),
        magnitude: "low",
        base_probability: 1,
        scenario_weights: {},
        effective_probability: 1,
      },
    ],
  });

  return { applied, clamped, rejected };
}

// ---------------------------------------------------------------------------
// getStateSummary – Generate human-readable summary
// ---------------------------------------------------------------------------

function getStateSummary(
  state: WorldState,
  keys?: string[],
): string {
  const lines: string[] = [];

  lines.push(`Quarter: ${state.meta.current_quarter}`);
  lines.push(`Turn:    ${state.meta.turn_number}`);
  lines.push("");

  const entries = Object.entries(state.state);
  const filtered = keys
    ? entries.filter(([k]) => keys.includes(k))
    : entries;

  for (const [key, value] of filtered) {
    lines.push(`${key} = ${value}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command) {
    throw new Error("Usage: state-manager.ts <load|apply|summary> <simDir> [options]");
  }

  switch (command) {
    case "load": {
      const simDir = positional[1];
      if (!simDir) throw new Error("Usage: state-manager.ts load <simDir> [--branch <name>] [--scenario <name>]");
      const state = loadState(simDir, flags);
      console.log(JSON.stringify(state, null, 2));
      break;
    }

    case "apply": {
      const simDir = positional[1];
      const agentId = positional[2];
      if (!simDir || !agentId) {
        throw new Error("Usage: state-manager.ts apply <simDir> <agentId> [--delta-json '<json>'] [--branch <name>] [--scenario <name>]");
      }

      const rawDelta = typeof flags["delta-json"] === "string"
        ? flags["delta-json"]
        : await readStdin();
      const delta: Record<string, number> = JSON.parse(rawDelta);

      const state = loadState(simDir, flags);
      const result = applyDelta(state, delta, agentId);
      saveState(simDir, flags, state);

      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "summary": {
      const simDir = positional[1];
      if (!simDir) throw new Error("Usage: state-manager.ts summary <simDir> [--keys key1,key2,...] [--branch <name>] [--scenario <name>]");

      const state = loadState(simDir, flags);
      const keys = typeof flags.keys === "string" ? flags.keys.split(",") : undefined;
      const summary = getStateSummary(state, keys);
      console.log(summary);
      break;
    }

    default:
      throw new Error(`Unknown command: "${command}". Expected: load, apply, summary`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
