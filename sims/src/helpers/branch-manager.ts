import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveSimDir, readJSON, writeJSON } from "@/helpers/utils.js";
import type { WorldState, BranchInfo } from "@/helpers/types.js";

// ---------------------------------------------------------------------------
// init-scenarios – Create scenario directories from root world-state
// ---------------------------------------------------------------------------

function initScenarios(simDir: string, scenarioNames: string[]): void {
  const base = resolveSimDir(simDir);
  const rootStatePath = path.join(base, "world-state.json");
  const rootState = readJSON<WorldState>(rootStatePath);

  for (const name of scenarioNames) {
    const scenarioDir = path.join(base, "scenarios", name);
    const timelineDir = path.join(scenarioDir, "timeline");

    fs.mkdirSync(timelineDir, { recursive: true });

    const scenarioState: WorldState = {
      ...rootState,
      meta: { ...rootState.meta, scenario: name },
    };

    writeJSON(path.join(scenarioDir, "world-state.json"), scenarioState);
    console.log(`Created scenario: ${scenarioDir}`);
  }

  console.log(`Initialized ${scenarioNames.length} scenario(s).`);
}

// ---------------------------------------------------------------------------
// fork – Fork a branch from an existing branch at a given quarter
// ---------------------------------------------------------------------------

function forkBranch(
  simDir: string,
  fromQuarter: string,
  branchName: string,
  fromBranch?: string,
): string {
  const base = resolveSimDir(simDir);
  const sourceBranch = fromBranch ?? "main";
  const sourceDir = path.join(base, "branches", sourceBranch);
  const targetDir = path.join(base, "branches", branchName);
  const targetTimelineDir = path.join(targetDir, "timeline");

  // Read source world-state
  const sourceStatePath = path.join(sourceDir, "world-state.json");
  const sourceState = readJSON<WorldState>(sourceStatePath);

  // Create target directories
  fs.mkdirSync(targetTimelineDir, { recursive: true });

  // Write updated world-state
  const newState: WorldState = {
    ...sourceState,
    meta: { ...sourceState.meta, branch: branchName },
  };
  writeJSON(path.join(targetDir, "world-state.json"), newState);

  // Copy timeline files up to and including fromQuarter
  const sourceTimelineDir = path.join(sourceDir, "timeline");
  if (fs.existsSync(sourceTimelineDir)) {
    const files = fs.readdirSync(sourceTimelineDir);
    for (const file of files) {
      // Extract quarter from filename (e.g., "Q1-2025.json" -> "Q1-2025")
      const quarter = path.basename(file, path.extname(file));
      if (quarter <= fromQuarter) {
        fs.copyFileSync(
          path.join(sourceTimelineDir, file),
          path.join(targetTimelineDir, file),
        );
      }
    }
  }

  console.log(`Forked branch "${branchName}" from "${sourceBranch}" at ${fromQuarter}`);
  console.log(`Branch path: ${targetDir}`);
  return targetDir;
}

// ---------------------------------------------------------------------------
// list – List all scenarios and branches
// ---------------------------------------------------------------------------

function listBranches(simDir: string): BranchInfo[] {
  const base = resolveSimDir(simDir);
  const results: BranchInfo[] = [];

  const dirs: { type: string; basePath: string }[] = [
    { type: "scenario", basePath: path.join(base, "scenarios") },
    { type: "branch", basePath: path.join(base, "branches") },
  ];

  for (const { basePath } of dirs) {
    if (!fs.existsSync(basePath)) continue;

    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(basePath, entry.name);
      const statePath = path.join(dirPath, "world-state.json");

      try {
        const state = readJSON<WorldState>(statePath);
        results.push({
          name: entry.name,
          path: dirPath,
          currentQuarter: state.meta.current_quarter,
          turnNumber: state.meta.turn_number,
          parentBranch: state.meta.branch,
        });
      } catch {
        // Skip directories without valid world-state.json
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  switch (command) {
    case "init-scenarios": {
      const simDir = positional[1];
      const names = positional[2];
      if (!simDir || !names) {
        console.error("Usage: branch-manager init-scenarios <simDir> <scenario1,scenario2,...>");
        process.exit(1);
      }
      initScenarios(simDir, names.split(",").map((s) => s.trim()));
      break;
    }

    case "fork": {
      const simDir = positional[1];
      const fromQuarter = positional[2];
      const branchName = positional[3];
      if (!simDir || !fromQuarter || !branchName) {
        console.error("Usage: branch-manager fork <simDir> <fromQuarter> <branchName> [--from <sourceBranch>]");
        process.exit(1);
      }
      const fromFlag = flags["from"] as string | undefined;
      forkBranch(simDir, fromQuarter, branchName, fromFlag);
      break;
    }

    case "list": {
      const simDir = positional[1];
      if (!simDir) {
        console.error("Usage: branch-manager list <simDir>");
        process.exit(1);
      }
      const branches = listBranches(simDir);
      console.log(JSON.stringify(branches, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: init-scenarios, fork, list");
      process.exit(1);
  }
}

main();
