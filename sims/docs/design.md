# agent-sim: マルチエージェント変遷シミュレーター 設計書

> 作成日: 2026-03-11
> 最終更新: 2026-03-11 v3

## 1. 概要

LLMエージェントが複数のステークホルダーを演じ、四半期ごとのターン制で相互作用しながら、あるテーマ（例: 工数管理SaaSへのAI影響）がどう変遷するかをシミュレートする汎用フレームワーク。

Claude Code の Subagent を中核とし、LLMが苦手な処理（数値制約、乱数、ファイルI/O）をTypeScriptヘルパーに切り出すことでトークン効率と決定性を両立する。

## 2. ディレクトリ構成

```
sims/
├── docs/
│   └── design.md                # 本設計書
├── src/                         # ソースコード
│   └── helpers/                 # TSヘルパー（全シミュレーション共通）
│       ├── state-manager.ts
│       ├── event-roller.ts
│       ├── metrics-tracker.ts
│       ├── branch-manager.ts
│       ├── sim-registry.ts
│       ├── types.ts
│       └── utils.ts
├── sessions/                    # 個別シミュレーション
│   └── [yyyymmdd]-[slug]/
│       ├── steering.md
│       ├── research-context.md
│       ├── agents/
│       │   ├── {agent-1}.md
│       │   ├── {agent-2}.md
│       │   └── ...
│       ├── events/
│       │   └── event-pool.json
│       ├── world-state.json         # 動的分岐型のメインライン / 事前定義型は scenarios/ 配下
│       ├── scenarios/               # 【事前定義型】シナリオ別
│       │   ├── baseline/
│       │   │   ├── world-state.json
│       │   │   └── timeline/
│       │   └── bullish/
│       │       ├── world-state.json
│       │       └── timeline/
│       ├── branches/                # 【動的分岐型】分岐ブランチ
│       │   ├── main/
│       │   │   ├── world-state.json
│       │   │   └── timeline/
│       │   └── Q3-vendor-aggressive/
│       │       ├── world-state.json
│       │       └── timeline/
│       └── timeline/                # 分岐前のメインタイムライン
│           └── Q0-initial.md
├── tsconfig.json
└── package.json                 # tsx 等の依存定義

# スキルファイルはプロジェクトルートの .claude/skills/ に配置:
# .claude/skills/sim-new/SKILL.md
# .claude/skills/sim-run/SKILL.md
```

## 3. 設計思想

### 3.1 エージェント中心 + コードアシスト

```
┌─────────────────────────────────────────────┐
│  Subagent (LLM)                             │
│  = 判断・推論・テキスト生成                  │
│  = 「何が起きるか」「どう行動するか」を考える │
└──────────────┬──────────────────────────────┘
               ↕ JSON入出力
┌──────────────┴──────────────────────────────┐
│  TSヘルパー (コード)                         │
│  = ファイルI/O, 数値制約, 乱数, メトリクス   │
│  = LLMが苦手 or トークンが無駄な処理を担当   │
└─────────────────────────────────────────────┘
```

LLMが苦手/非効率な処理をTSヘルパーに委譲し、Subagentは「判断してJSONを返す」ことに集中する。

### 3.2 エージェント実行方式

シミュレーションエージェントのペルソナ定義は各シミュレーションの `agents/{id}.md` に配置する。
`.claude/agents/` には置かず、スキル（オーケストレーター）が以下の手順で実行する:

1. TSヘルパーまたはReadツールで `agents/{id}.md` を読み込む
2. world-stateやイベント情報と合わせてプロンプトを組み立てる
3. `Agent` ツールを `subagent_type: "general-purpose"` で呼び出し、プロンプトにペルソナを展開する

この方式により、シミュレーションごとにエージェント構成を自由に変えられる。

### 3.3 シナリオ分岐（2モード切替）

`steering.md` で選択する。

| モード | 説明 | 向いているケース |
|---|---|---|
| **predefined**（事前定義型） | sim-new 時にシナリオ条件を定義し、それぞれ独立実行 | 「楽観vs悲観」のように明確な軸で比較したい時 |
| **dynamic**（動的分岐型） | 1本のシミュレーションを進め、アナリストが「分岐点」を検知したら分岐 | 予想外の展開を許容し、より探索的にしたい時 |

#### 事前定義型

- sim-new でシナリオ条件（AI進化速度、コスト低下率、規制強度など）を定義
- `scenarios/{name}/` ごとに独立した world-state と timeline を持つ
- sim-run で `--scenario <name>` で個別実行、`--all` で全シナリオ順次実行

#### 動的分岐型

- `branches/main/` でシミュレーションを開始
- アナリストが分岐点を検知 → ユーザー承認 → `branches/{name}/` に分岐
- 分岐先は親ブランチのworld-stateをコピーして独立進行
- 分岐は最大3階層まで

### 3.4 四半期ターン制

- 1ターン = 1四半期
- 各ターンは「イベント生成 → エージェント意思決定 → 二次効果 → メトリクス記録」の4フェーズで構成

### 3.5 イベント生成方式（ハイブリッド型）

イベントは「プールによる候補抽出」と「LLMによる選択・追加生成」の2ステップで決定する。

```
Phase 1A: TSヘルパー（event-roller.ts）
  event-pool.json の各イベントに対して conditions を評価し、
  現在の world-state・発生履歴と照合して「今期発生しうる候補」を返す。
  ※ 確率抽選は行わない。条件を満たすすべての候補を列挙する。
      ↓ { candidates: RolledEvent[], max_slots: N }

Phase 1B: LLMサブエージェント
  候補リスト・現在の世界状態・直近2Qの経緯を入力として受け取り、
  「今期の文脈上最も自然なもの」を候補から選択する。
  候補にないが経緯から必然的に起きるべき事象は追加生成する。
  各イベントに selection_reason / generation_reason を付与する。
      ↓ { selected_events: RolledEvent[], generated_events: RolledEvent[] }

合成: selected_events + generated_events → rolledEvents（Phase 2 へ渡す）
```

#### この方式により解決される問題

| 問題 | 解決方法 |
|---|---|
| プール固定（既定外の事象が起きない） | LLM が追加生成（`source: "generated"`）することで対応 |
| 同一イベントの繰り返し発生 | `cooldown_quarters` / `one_shot` で抑制 |
| タイミングの必然性がない | LLMが経緯・状態を踏まえて「今期自然かどうか」を判断して選択 |

## 4. コマンド設計

### 4.1 `/sim-new` — 新規シミュレーション作成

#### 目的

ユーザーとの対話 + Web調査を通じて、シミュレーションの設定を確定し、ファイル一式を生成する。

#### フロー

```
1. ユーザーにお題を質問
   - 「何をシミュレートしたいですか？」
   - 引数でお題が渡された場合はスキップ

2. Web調査（市場データ収集）
   - 市場規模・成長率
   - 主要プレイヤーと競合構造
   - 最新のAI/技術動向
   - 規制環境
   → 調査結果を research-context.md に保存

3. 調査結果をもとに以下をAIが提案 → ユーザーが承認/修正
   a. エージェント構成（名前・役割・視点）
   b. 世界状態の初期パラメータ（実データベース）
   c. シミュレーション期間
   d. シナリオモード（predefined or dynamic）
   e. イベントプール（発生しうるイベントの候補リスト）

4. 確定したらファイルを生成
```

### 4.2 `/sim-run [sim-path] [N] [--scenario <name>] [--all] [--branch <name>]` — シミュレーション実行

#### 目的

指定された四半期数（デフォルト: 1）分、シミュレーションを進行させる。

#### シミュレーションの指定方法

| 指定方法 | 例 | 説明 |
|---|---|---|
| パスで直接指定 | `/sim-run sims/20260311-saas-ai 4` | 明示的に対象を指定 |
| スラッグで指定 | `/sim-run saas-ai 4` | 部分一致で検索 |
| 省略（対話選択） | `/sim-run` | 最新5件のシミュレーションを一覧表示し、ユーザーが選択 |

省略時の一覧表示イメージ:

```
? どのシミュレーションを実行しますか？
  [1] 20260311-saas-ai-evolution    (Q3 2025 / dynamic / 3 branches)
  [2] 20260308-fintech-disruption   (Q1 2025 / predefined / 3 scenarios)
  [3] 20260305-healthcare-ai        (Q4 2025 / dynamic / main only)
  [4] 20260301-edtech-market        (Q2 2026 / predefined / 2 scenarios)
  [5] 20260228-logistics-automation  (Q1 2025 / 未実行)
  > 1
```

この一覧生成はTSヘルパーの `sim-registry.ts` が担当する。

#### オプション

| オプション | 説明 |
|---|---|
| `sim-path` | 実行するシミュレーションのパスまたはスラッグ（省略時は対話選択） |
| `N` | 実行する四半期数（デフォルト: 1） |
| `--scenario <name>` | 特定シナリオのみ実行（事前定義型） |
| `--all` | 全シナリオ/ブランチを順番に実行 |
| `--branch <name>` | 特定ブランチで実行（動的分岐型） |

#### フロー（1四半期分）

```
Phase 0: 準備
  TSヘルパー: loadState() で world-state.json 読み込み
  TSヘルパー: getRecentContext(2) で直近2Qの要約を取得
      ↓
Phase 1: イベント生成（2ステップ）
  Phase 1A（TSヘルパー）: candidateEvents(eventPool) で conditions フィルタ済み候補リストを生成
  ※ 確率抽選なし。cooldown/one_shot/state条件/依存関係でフィルタリングのみ
  Phase 1B（LLMサブエージェント）: 候補リスト + 経緯 + 現在状態を受け取り、
    ・今期自然なイベントを候補から選択（selection_reason付き）
    ・必要に応じてプール外のイベントを追加生成（generation_reason付き）
  ※ 結果: 今期発生するイベント一覧（source: "pool" | "generated"）
      ↓
Phase 2: エージェント意思決定（Subagent連鎖）
  各エージェントを steering.md の実行順に従って順番に実行:

  ┌─ Agent N (Subagent: general-purpose) ────────────┐
  │  入力:                                            │
  │    - agents/{id}.md のペルソナ定義                 │
  │    - getStateSummary() の出力（state要約）         │
  │    - 今期イベント                                  │
  │    - getRecentContext(2) の出力（直近2Q要約）      │
  │    - 先行エージェントの行動要約                     │
  │  出力:                                            │
  │    - JSON（状況認識 + 行動 + state_delta）         │
  └──────────────────────────────────────────────────┘
        ↓ TSヘルパー: applyDelta() で数値制約つき更新
        ↓ 次のエージェントへ
      ↓
Phase 3: 二次効果 + サマリー（アナリストSubagent）
  ┌─ Analyst Agent ──────────────────────────────────┐
  │  全エージェントの行動を統合分析                    │
  │  二次効果（カスケード）を推論                      │
  │  四半期サマリーを生成                             │
  │  【dynamic モード】分岐点の検知・分岐提案         │
  └──────────────────────────────────────────────────┘
        ↓ TSヘルパー: applyDelta() (二次効果の反映)
      ↓
Phase 4: 記録
  TSヘルパー: appendMetrics(quarter, snapshot)
  TSヘルパー: saveState()
  TSヘルパー: saveTimeline(quarter, allOutputs)
      ↓
（dynamic モードで分岐が発生した場合）
  ユーザーに分岐するか確認
  → Yes: TSヘルパー: forkBranch(fromQ, branchName)
  → No: 分岐せず続行
```

## 5. ファイル仕様

### 5.1 `steering.md` — シミュレーション設定

```markdown
# {シミュレーションタイトル}

## テーマ
（シミュレーションの主題）

## 前提・制約
（シミュレーションの前提条件やスコープの制約）

## シナリオモード
mode: predefined | dynamic

### 【predefined の場合】シナリオ一覧
| シナリオ名 | 条件1 | 条件2 | 条件3 | 説明 |
|---|---|---|---|---|
| baseline | 中 | 中 | 中 | 現状延長 |
| bullish | 高 | 高 | 低 | 楽観シナリオ |
| bearish | 低 | 低 | 高 | 悲観シナリオ |

※ 条件の軸はお題に応じて sim-new で設計する。

### 【dynamic の場合】分岐ルール
- アナリストが「分岐点」と判定した場合、2〜3本の分岐を提案
- ユーザー承認後に分岐を実行
- 分岐は最大3階層まで

## エージェント構成
| # | ID | 名前 | 役割 | 実行順 |
|---|---|---|---|---|
| 1 | {id} | {名前} | {役割} | 1 |
| 2 | {id} | {名前} | {役割} | 2 |
| ... | ... | ... | ... | ... |
| N | analyst | アナリスト | 統合分析・二次効果・分岐検知 | N（最後） |

## シミュレーション期間
- 開始: {開始Q}（初期状態）
- 終了: {終了Q}
- 合計: {N}四半期

## 実行ルール
- 各エージェントは前のエージェントの出力を参照できる
- world-state の数値変更は ±{N}% 以内/Q（TSヘルパーで強制）
- イベントは event-pool.json から確率ベースで抽選

## イベント設定
- イベントプール: events/event-pool.json
- 1Qあたり最大イベント数: {N}
- シナリオ条件によるイベント確率の重み付けあり
```

### 5.2 `agents/{id}.md` — エージェントペルソナ定義

```markdown
# {エージェント名}

## 役割
（このエージェントが何を代表するか）

## objectives（目的）
- （目的1）
- （目的2）

## constraints（制約）
- （制約1）
- （制約2）

## success_metrics（成功指標）
- （指標1: 何がどうなれば成功か）
- （指標2）

## behavioral_tendency（行動傾向）
（保守的 / 攻撃的 / 日和見的 / 楽観的 / 破壊的 など）

## action_space（取りうる行動の一覧）
- （行動1: 説明）
- （行動2: 説明）
- （行動3: 説明）

## managed_state_keys（管轄パラメータ）
（world-state.json 内で直接更新できるキー一覧）

## 出力フォーマット
JSON形式で以下を返す:
- situation_assessment: 状況認識テキスト
- actions: action_spaceから選択した行動の配列
- state_delta: world-stateへの変更提案
- delta_reasoning: 変更理由
```

### 5.3 `world-state.json` — 世界状態

共通の外枠:

```json
{
  "meta": {
    "current_quarter": "Q1-2025",
    "turn_number": 0,
    "scenario": "baseline",
    "branch": "main"
  },
  "state": {
    // お題固有のパラメータ（sim-new で動的に設計）
  },
  "events_log": [],
  "metrics_history": []
}
```

`metrics_history` は各Q終了時にTSヘルパーが自動追記:

```json
{
  "metrics_history": [
    {
      "quarter": "Q1-2025",
      "snapshot": { "key1": 0.5, "key2": 0.3 }
    }
  ]
}
```

### 5.4 `events/event-pool.json` — イベントプール

```json
{
  "events": [
    {
      "id": "event-id",
      "name": "イベント名",
      "description": "イベントの説明（1〜2文）",
      "impact_areas": ["影響を受けるstateキー"],
      "magnitude": "low | medium | high",
      "cooldown_quarters": 3,
      "one_shot": false,
      "conditions": {
        "state_min": { "state_key": 0.4 },
        "state_max": { "state_key": 0.9 },
        "requires_events": ["prerequisite-event-id"],
        "excludes_events": ["conflicting-event-id"]
      }
    }
  ]
}
```

- `base_probability` / `scenario_weights` は廃止。LLMが文脈で選ぶため確率は使わない。
- `conditions` はそのイベントが「起きうる前提状態」を定義する（省略可）。
- `cooldown_quarters`: 同一イベントが再び候補になるまでの最短四半期数（0 = 制限なし）。
- `one_shot`: `true` なら一度発生したら候補から永久に除外。
- `conditions.requires_events`: 指定IDが `events_log` に存在する場合のみ候補になる。
- `conditions.excludes_events`: 指定IDが `events_log` に存在する場合は候補から除外。
- `conditions.state_min/max`: `world-state.state` の値が範囲内の場合のみ候補になる。

## 6. TSヘルパー設計

### 6.1 概要

TSヘルパーは `sims/src/helpers/` に配置し、Claude CodeのBashツール経由で `npx tsx sims/src/helpers/{script}.ts` として呼び出す。

エージェント（Subagent）は直接TSヘルパーを呼ばない。スキル（オーケストレーター）が呼び出す。

#### 前提条件

- `sims/package.json` に `tsx` を devDependencies として定義
- TSヘルパーは `sims/` をカレントディレクトリとして実行される想定
- 外部API依存なし（ファイルI/O + 乱数のみ）

#### 制約値の取得

TSヘルパー（特に `applyDelta`）が参照する制約値（±変動上限など）は、各シミュレーションの `steering.md` のYAML frontmatterではなく、**`world-state.json` の `meta` セクションに数値として保持する**:

```json
{
  "meta": {
    "current_quarter": "Q1-2025",
    "turn_number": 0,
    "max_delta_pct": 0.2,
    "max_events_per_quarter": 3
  }
}
```

これにより、TSヘルパーはJSONのみパースすれば良く、Markdownパースの複雑さを避けられる。
`steering.md` 側にも同じ値を人間可読な形で記載するが、実行時の正（source of truth）は `world-state.json` の `meta` とする。

### 6.2 モジュール一覧

#### `state-manager.ts`

```
用途: world-state.json の読み書き + 数値制約チェック

CLI:
  npx tsx state-manager.ts load <simDir> [--branch <name>]
  npx tsx state-manager.ts apply <simDir> <deltaJson> <agentId> [--branch <name>]
  npx tsx state-manager.ts summary <simDir> [--keys key1,key2] [--branch <name>]

関数:
  loadState(simDir, branch?) → WorldState
  applyDelta(simDir, delta, agentId, branch?) → { applied, clamped, rejected }
  saveState(simDir, state, branch?) → void
  getStateSummary(simDir, keys?, branch?) → string
```

#### `event-roller.ts`

```
用途: イベントプールの conditions フィルタリングと候補リスト生成

CLI:
  npx tsx event-roller.ts candidates <simDir> [--scenario <name>] [--branch <name>] [--max <N>]

関数:
  candidateEvents(simDir, { scenario?, branch?, maxSlots? })
    → { candidates: RolledEvent[], max_slots: number }

フィルタリング順:
  1. one_shot チェック（events_log に同IDが存在 → 除外）
  2. cooldown チェック（最終発生から cooldown_quarters Q 未満 → 除外）
  3. conditions.requires_events（未発生のIDがある → 除外）
  4. conditions.excludes_events（発生済みIDがある → 除外）
  5. conditions.state_min/max（world-state の値が範囲外 → 除外）

注意: 確率抽選は行わない。候補の選択・生成は Phase 1B の LLM が担当する。
```

#### `metrics-tracker.ts`

```
用途: メトリクス履歴の蓄積と直近コンテキスト取得

CLI:
  npx tsx metrics-tracker.ts append <simDir> <quarter> [--branch <name>]
  npx tsx metrics-tracker.ts context <simDir> <N> [--branch <name>]

関数:
  appendMetrics(simDir, quarter, snapshot, branch?) → void
  getRecentContext(simDir, n, branch?) → string
```

#### `branch-manager.ts`

```
用途: シナリオ/ブランチのディレクトリ管理

CLI:
  npx tsx branch-manager.ts init-scenarios <simDir> <scenario1,scenario2,...>
  npx tsx branch-manager.ts fork <simDir> <fromQuarter> <branchName> [--from <branch>]
  npx tsx branch-manager.ts list <simDir>

関数:
  initScenarios(simDir, scenarioNames[]) → void
  forkBranch(simDir, fromQuarter, branchName, fromBranch?) → string
  listBranches(simDir) → BranchInfo[]
```

#### `sim-registry.ts`

```
用途: sims/ 配下のシミュレーション一覧管理

CLI:
  npx tsx sim-registry.ts list [--limit <N>]
  npx tsx sim-registry.ts find <query>

関数:
  listSims(limit?) → SimInfo[]
    - sims/ 配下のディレクトリを走査
    - 各シミュレーションの steering.md と world-state.json から
      名前、現在Q、シナリオモード、ブランチ数を取得
    - 更新日時の降順でソート

  findSim(query) → SimInfo | null
    - パスまたはスラッグで部分一致検索
```

## 7. Subagent呼び出し設計

### 7.1 プロンプト構成

スキル（オーケストレーター）が以下を組み立てて Agent ツールに渡す:

```
あなたは以下のペルソナで行動するシミュレーションエージェントです。

## ペルソナ
{agents/{id}.md の内容を展開}

## シミュレーション設定（要約）
テーマ: {theme}
現在: {current_quarter}（ターン{turn_number}）
シナリオ: {scenario_name}

## 今期の外部イベント
{event-roller.ts の抽選結果}

## 現在の世界状態（要約）
{state-manager.ts の getStateSummary() 出力}

## 直近の経緯
{metrics-tracker.ts の getRecentContext(2) 出力}

## 今期の先行エージェントの行動
{同一Q内で先に実行されたエージェントの出力要約}

## 指示
上記を踏まえ、今期のあなたの行動を出力してください。
出力は以下のJSON形式で返してください:

{
  "situation_assessment": "状況認識テキスト",
  "actions": [
    {
      "action": "action_spaceから選んだ行動",
      "detail": "具体的な内容"
    }
  ],
  "state_delta": {
    "key": "new_value"
  },
  "delta_reasoning": "変更理由"
}
```

### 7.2 アナリストエージェントの追加出力

通常エージェントのJSON出力に加えて:

```json
{
  "quarterly_summary": "四半期の統合サマリー",
  "secondary_effects": [
    {
      "trigger": "何がトリガーか",
      "effect": "何が起きるか",
      "state_delta": { "key": "value" }
    }
  ],
  "branch_point": {
    "detected": false,
    "reason": "",
    "proposed_branches": []
  }
}
```

`branch_point.detected` が `true` の場合、オーケストレーターがユーザーに分岐するか確認する。

### 7.3 Subagent設定

| 設定項目 | 値 |
|---|---|
| subagent_type | general-purpose |
| mode | default |
| model | sonnet（コスト最適化） |

## 8. 実行例イメージ

```
$ /sim-new

? 何をシミュレートしますか？
> AI時代の工数管理SaaS市場の変遷

🔍 Web調査中...
  - 工数管理SaaS市場規模: 約500億円（2025年）
  - 主要プレイヤー: CrowdLog, TeamSpirit, HRMOS, ジョブカン...
  - AI動向: GitHub Copilot普及率30%超、AIコーディングエージェント登場...
  → research-context.md に保存

📋 以下の設定を提案します:
  エージェント: AI技術 / 競合 / SaaSベンダー / CFO / IT管理者 / エンドユーザー / アナリスト
  期間: Q1 2025 〜 Q4 2027（12四半期）
  シナリオモード: ?
  [1] 事前定義型（Baseline / Bullish / Bearish）
  [2] 動的分岐型
  > 2

✅ ファイル生成完了
  → sims/20260311-saas-ai-evolution/

---

$ /sim-run 4

? どのシミュレーションを実行しますか？
  [1] 20260311-saas-ai-evolution  (Q1 2025 / dynamic / main)
  > 1

▶ Q2 2025 (main)
  🎲 Events: 推論コスト30%低下, AIコーディングエージェント普及加速
  🤖 AI Tech: コーディングエージェント成熟度 0.5→0.6
  ⚔️ Competitor: AIネイティブ工数自動記録ツール「AutoTrack」が$2Mシード調達
  🏢 Vendor: AI入力サジェスト機能をβリリース
  💼 CFO: SaaS統合検討を開始、3ツール→2ツールへ
  🔒 IT Admin: AIツール導入のセキュリティガイドライン策定
  👤 User: AIサジェストに好反応（satisfaction 0.65→0.70）
  📊 Analyst: 市場に変化の兆し。従来型シェア微減。
     ⚡ 二次効果: CFOのSaaS統合方針→ベンダー間競争激化
  ✅ Q2 2025 完了

▶ Q3 2025 (main)
  🎲 Events: 大手テック企業がAIワークフロー統合を発表
  ...
  📊 Analyst:
     🔀 分岐点を検知！
     理由: プラットフォーム企業のバンドル戦略により市場構造が変わりうる
     分岐A: platform-bundling（プラットフォームが工数管理を統合）
     分岐B: vertical-moat（専業ベンダーがデータmoatで対抗）
  ? 分岐しますか？ [Y/n] > Y
  ✅ Q3 2025 完了 → 2ブランチに分岐

▶ Q4 2025 (platform-bundling)
  ...
▶ Q4 2025 (vertical-moat)
  ...

---

$ /sim-run saas-ai 2 --branch platform-bundling

▶ Q1 2026 (platform-bundling)
  ...
▶ Q2 2026 (platform-bundling)
  ...
```

## 9. 拡張ポイント（将来）

- **ユーザー介入**: 特定Qでユーザーが手動イベントを注入（規制変更、大型M&Aなど）
- **可視化**: metrics_history からMermaidグラフを自動生成
- **リプレイ**: 特定Qに巻き戻して別の判断を試す
- **比較レポート**: 複数シナリオ/ブランチの最終状態を横並び比較
- **エクスポート**: シミュレーション結果をPDFレポートとして出力
