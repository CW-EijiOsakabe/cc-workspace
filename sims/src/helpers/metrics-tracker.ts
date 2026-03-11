import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  resolveStatePath,
  resolveTimelinePath,
  readJSON,
  writeJSON,
} from "@/helpers/utils.js";
import type { WorldState } from "@/helpers/types.js";

// ---------------------------------------------------------------------------
// appendMetrics – Snapshot current state params and append to metrics_history
// ---------------------------------------------------------------------------

function appendMetrics(
  simDir: string,
  quarter: string,
  options?: { branch?: string; scenario?: string },
): void {
  const statePath = resolveStatePath(simDir, options);
  const ws = readJSON<WorldState>(statePath);

  const snapshot: Record<string, number> = { ...ws.state };

  if (!ws.metrics_history) {
    ws.metrics_history = [];
  }

  ws.metrics_history.push({ quarter, snapshot });

  writeJSON(statePath, ws);

  console.log(`Metrics appended for ${quarter}`);
}

// ---------------------------------------------------------------------------
// getRecentContext – Return formatted text for the last N metrics entries
// ---------------------------------------------------------------------------

function getRecentContext(
  simDir: string,
  n: number,
  options?: { branch?: string; scenario?: string },
): string {
  const statePath = resolveStatePath(simDir, options);
  const ws = readJSON<WorldState>(statePath);

  const history = ws.metrics_history ?? [];
  const entries = history.slice(-n);

  if (entries.length === 0) {
    return "No metrics history available.";
  }

  const timelineDir = resolveTimelinePath(simDir, options);

  const sections: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const turnIndex = history.indexOf(entry) + 1;

    // Build metrics snapshot lines
    const metricsLines = Object.entries(entry.snapshot)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");

    // Try to find a matching timeline file
    let timelineSummary = "No timeline file found";
    try {
      if (fs.existsSync(timelineDir)) {
        const files = fs.readdirSync(timelineDir);
        const match = files.find(
          (f) => f.includes(entry.quarter) && f.endsWith(".md"),
        );
        if (match) {
          const content = fs.readFileSync(
            path.join(timelineDir, match),
            "utf-8",
          );
          timelineSummary = content.slice(0, 500);
        }
      }
    } catch {
      // timeline dir may not exist – that's fine
    }

    sections.push(
      [
        `## ${entry.quarter} (Turn ${turnIndex})`,
        `### Metrics Snapshot`,
        metricsLines,
        ``,
        `### Timeline Summary`,
        timelineSummary,
      ].join("\n"),
    );
  }

  return sections.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  const command = positional[0];
  const branch = typeof flags.branch === "string" ? flags.branch : undefined;
  const scenario =
    typeof flags.scenario === "string" ? flags.scenario : undefined;
  const options = { branch, scenario };

  if (command === "append") {
    const simDir = positional[1];
    const quarter = positional[2];

    if (!simDir || !quarter) {
      console.error("Usage: metrics-tracker append <simDir> <quarter> [--branch <name>] [--scenario <name>]");
      process.exit(1);
    }

    appendMetrics(simDir, quarter, options);
  } else if (command === "context") {
    const simDir = positional[1];
    const nStr = positional[2];

    if (!simDir || !nStr) {
      console.error("Usage: metrics-tracker context <simDir> <N> [--branch <name>] [--scenario <name>]");
      process.exit(1);
    }

    const n = parseInt(nStr, 10);
    if (isNaN(n) || n <= 0) {
      console.error("N must be a positive integer");
      process.exit(1);
    }

    const output = getRecentContext(simDir, n, options);
    console.log(output);
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Available commands: append, context");
    process.exit(1);
  }
}

main();
