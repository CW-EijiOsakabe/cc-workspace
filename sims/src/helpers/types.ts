export interface MetaState {
  current_quarter: string;
  turn_number: number;
  scenario?: string;
  branch?: string;
  max_delta_pct: number;
  max_events_per_quarter: number;
}

export interface EventLogEntry {
  quarter: string;
  events: RolledEvent[];
}

export interface MetricsEntry {
  quarter: string;
  snapshot: Record<string, number>;
}

export interface WorldState {
  meta: MetaState;
  state: Record<string, number>;
  events_log: EventLogEntry[];
  metrics_history: MetricsEntry[];
}

export interface EventConditions {
  /** world-state.state の各キーが指定値以上であること */
  state_min?: Record<string, number>;
  /** world-state.state の各キーが指定値以下であること */
  state_max?: Record<string, number>;
  /** 指定 ID のイベントが過去に発生済みであること */
  requires_events?: string[];
  /** 指定 ID のイベントが過去に発生済みであれば候補から除外 */
  excludes_events?: string[];
}

export interface EventPoolItem {
  id: string;
  name: string;
  description: string;
  impact_areas: string[];
  magnitude: "low" | "medium" | "high";
  /** 同一イベントが再び候補になるまでの最短四半期数（0 = 制限なし） */
  cooldown_quarters?: number;
  /** true の場合、一度発生したら二度と候補にならない */
  one_shot?: boolean;
  conditions?: EventConditions;
}

export interface EventPool {
  events: EventPoolItem[];
}

export interface RolledEvent extends EventPoolItem {
  /** "pool": event-pool 由来 / "generated": LLM が今期生成 */
  source: "pool" | "generated";
}

export interface DeltaResult {
  applied: Record<string, number>;
  clamped: string[];
  rejected: string[];
}

export interface AgentOutput {
  situation_assessment: string;
  actions: { action: string; detail: string }[];
  state_delta: Record<string, number>;
  delta_details: Record<string, string>;
  delta_reasoning: string;
}

export interface AnalystOutput extends AgentOutput {
  quarterly_summary: string;
  secondary_effects: {
    trigger: string;
    effect: string;
    state_delta: Record<string, number>;
  }[];
  branch_point: {
    detected: boolean;
    reason: string;
    proposed_branches: string[];
  };
}

export interface SimInfo {
  dir: string;
  slug: string;
  title: string;
  currentQuarter: string;
  mode: "predefined" | "dynamic";
  branchCount: number;
  scenarioCount: number;
  lastModified: Date;
}

export interface BranchInfo {
  name: string;
  path: string;
  currentQuarter: string;
  turnNumber: number;
  parentBranch?: string;
}
