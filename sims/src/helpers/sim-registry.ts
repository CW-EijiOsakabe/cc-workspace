import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJSON } from "@/helpers/utils.js";
import type { SimInfo, WorldState } from "@/helpers/types.js";

// ---------------------------------------------------------------------------
// listSims – Scan sims root for simulation directories
// ---------------------------------------------------------------------------

function listSims(limit?: number): SimInfo[] {
  const simsRoot = path.resolve(import.meta.dirname, "../..", "sessions");
  const datePattern = /^\d{8}-/;

  const entries = fs.readdirSync(simsRoot, { withFileTypes: true });
  const simDirs = entries.filter(
    (e) => e.isDirectory() && datePattern.test(e.name),
  );

  const results: SimInfo[] = simDirs.map((entry) => {
    const dirPath = path.join(simsRoot, entry.name);
    const slug = entry.name.replace(/^\d{8}-/, "");

    // Title from steering.md first line
    let title = entry.name;
    const steeringPath = path.join(dirPath, "steering.md");
    if (fs.existsSync(steeringPath)) {
      const firstLine = fs
        .readFileSync(steeringPath, "utf-8")
        .split("\n")
        .find((l) => l.startsWith("# "));
      if (firstLine) {
        title = firstLine.replace(/^#\s+/, "");
      }
    }

    // Meta from world-state.json
    let currentQuarter = "未実行";
    try {
      const ws = readJSON<WorldState>(path.join(dirPath, "world-state.json"));
      currentQuarter = ws.meta.current_quarter;
    } catch {
      // fallback: 未実行
    }

    // Mode detection
    const hasScenarios = fs.existsSync(path.join(dirPath, "scenarios"));
    const hasBranches = fs.existsSync(path.join(dirPath, "branches"));
    const mode: SimInfo["mode"] = hasScenarios
      ? "predefined"
      : hasBranches
        ? "dynamic"
        : "predefined";

    // Counts
    const scenarioCount = hasScenarios
      ? fs
          .readdirSync(path.join(dirPath, "scenarios"), { withFileTypes: true })
          .filter((e) => e.isDirectory()).length
      : 0;
    const branchCount = hasBranches
      ? fs
          .readdirSync(path.join(dirPath, "branches"), { withFileTypes: true })
          .filter((e) => e.isDirectory()).length
      : 0;

    // Last modified
    const stat = fs.statSync(dirPath);
    const lastModified = stat.mtime;

    return {
      dir: entry.name,
      slug,
      title,
      currentQuarter,
      mode,
      branchCount,
      scenarioCount,
      lastModified,
    };
  });

  // Sort by lastModified descending
  results.sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
  );

  return limit ? results.slice(0, limit) : results;
}

// ---------------------------------------------------------------------------
// findSim – Find a simulation by query
// ---------------------------------------------------------------------------

function findSim(query: string): SimInfo | null {
  const sims = listSims();
  const simsRoot = path.resolve(import.meta.dirname, "../..", "sessions");

  for (const sim of sims) {
    // Exact match on directory name
    if (sim.dir === query) return sim;
  }

  for (const sim of sims) {
    // Partial match on slug
    if (sim.slug.includes(query)) return sim;
  }

  for (const sim of sims) {
    // Partial match on full path
    const fullPath = path.join(simsRoot, sim.dir);
    if (fullPath.includes(query)) return sim;
  }

  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  switch (command) {
    case "list": {
      const limit = flags.limit ? Number(flags.limit) : undefined;
      const sims = listSims(limit);
      console.log(JSON.stringify(sims, null, 2));
      break;
    }
    case "find": {
      const query = positional[1];
      if (!query) {
        console.error("Usage: sim-registry.ts find <query>");
        process.exit(1);
      }
      const result = findSim(query);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error("Usage: sim-registry.ts <list|find> [options]");
      process.exit(1);
  }
}

main();
