import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

// ---------------------------------------------------------------------------
// parseArgs – Simple CLI argument parser
// ---------------------------------------------------------------------------

export function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");

      if (eqIndex !== -1) {
        // --flag=value
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        flags[key] = value;
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];

        if (next !== undefined && !next.startsWith("--")) {
          // --flag value
          flags[key] = next;
          i++;
        } else {
          // --boolean-flag
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

// ---------------------------------------------------------------------------
// resolveSimDir – Resolve simulation directory path
// ---------------------------------------------------------------------------

export function resolveSimDir(simDir: string): string {
  return path.resolve(simDir);
}

// ---------------------------------------------------------------------------
// resolveStatePath – Determine correct world-state.json path
// ---------------------------------------------------------------------------

export function resolveStatePath(
  simDir: string,
  options?: { branch?: string; scenario?: string },
): string {
  const base = resolveSimDir(simDir);

  if (options?.scenario) {
    return path.join(base, "scenarios", options.scenario, "world-state.json");
  }
  if (options?.branch) {
    return path.join(base, "branches", options.branch, "world-state.json");
  }
  return path.join(base, "world-state.json");
}

// ---------------------------------------------------------------------------
// resolveTimelinePath – Determine correct timeline/ directory path
// ---------------------------------------------------------------------------

export function resolveTimelinePath(
  simDir: string,
  options?: { branch?: string; scenario?: string },
): string {
  const base = resolveSimDir(simDir);

  if (options?.scenario) {
    return path.join(base, "scenarios", options.scenario, "timeline");
  }
  if (options?.branch) {
    return path.join(base, "branches", options.branch, "timeline");
  }
  return path.join(base, "timeline");
}

// ---------------------------------------------------------------------------
// readJSON – Read and parse a JSON file
// ---------------------------------------------------------------------------

export function readJSON<T>(filePath: string): T {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// writeJSON – Write JSON file (pretty-printed, creates parent dirs)
// ---------------------------------------------------------------------------

export function writeJSON(filePath: string, data: unknown): void {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// readStdin – Read all data from stdin
// ---------------------------------------------------------------------------

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin });
    const chunks: string[] = [];

    rl.on("line", (line) => {
      chunks.push(line);
    });

    rl.on("close", () => {
      resolve(chunks.join("\n"));
    });

    rl.on("error", (err) => {
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// quarterToString – Format a quarter string (identity / validation)
// ---------------------------------------------------------------------------

export function quarterToString(q: string): string {
  const match = q.match(/^Q([1-4])-(\d{4})$/);
  if (!match) {
    throw new Error(`Invalid quarter format: "${q}" (expected "Q1-2025" style)`);
  }
  return `Q${match[1]}-${match[2]}`;
}

// ---------------------------------------------------------------------------
// nextQuarter – Advance to the next quarter
// ---------------------------------------------------------------------------

export function nextQuarter(q: string): string {
  const match = q.match(/^Q([1-4])-(\d{4})$/);
  if (!match) {
    throw new Error(`Invalid quarter format: "${q}" (expected "Q1-2025" style)`);
  }

  let quarter = parseInt(match[1], 10);
  let year = parseInt(match[2], 10);

  if (quarter === 4) {
    quarter = 1;
    year += 1;
  } else {
    quarter += 1;
  }

  return `Q${quarter}-${year}`;
}

// ---------------------------------------------------------------------------
// currentQuarterFromDate – Get quarter string from a Date object
// ---------------------------------------------------------------------------

export function currentQuarterFromDate(date: Date): string {
  const month = date.getMonth() + 1; // 1–12
  const year = date.getFullYear();
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${q}-${year}`;
}

// ---------------------------------------------------------------------------
// initSimDirs – Create standard simulation subdirectories
// ---------------------------------------------------------------------------

export function initSimDirs(simDir: string): void {
  const base = path.resolve(simDir);
  for (const sub of ["agents", "events", "timeline"]) {
    fs.mkdirSync(path.join(base, sub), { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// listSimFiles – Recursively list files under simDir (up to maxFiles)
// ---------------------------------------------------------------------------

export function listSimFiles(simDir: string, maxFiles = 30): string[] {
  const base = path.resolve(simDir);
  const results: string[] = [];

  function walk(dir: string) {
    if (results.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= maxFiles) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        results.push(path.relative(base, full));
      }
    }
  }

  walk(base);
  return results;
}

// ---------------------------------------------------------------------------
// main – CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("utils.ts") ||
    process.argv[1] && path.resolve(process.argv[1]).endsWith("utils.js")) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  switch (command) {
    case "next-quarter-from-now": {
      const today = new Date();
      const cur = currentQuarterFromDate(today);
      console.log(nextQuarter(cur));
      break;
    }

    case "init-dirs": {
      const simDir = positional[1];
      if (!simDir) {
        console.error("Usage: utils.ts init-dirs <simDir>");
        process.exit(1);
      }
      initSimDirs(simDir);
      console.log(`Created: ${simDir}/agents, ${simDir}/events, ${simDir}/timeline`);
      break;
    }

    case "list-files": {
      const simDir = positional[1];
      if (!simDir) {
        console.error("Usage: utils.ts list-files <simDir> [--max <n>]");
        process.exit(1);
      }
      const max = typeof flags.max === "string" ? parseInt(flags.max, 10) : 30;
      const files = listSimFiles(simDir, max);
      console.log(files.join("\n"));
      break;
    }

    default:
      console.error(`Unknown command: "${command}". Expected: next-quarter-from-now, init-dirs, list-files`);
      process.exit(1);
  }
}
