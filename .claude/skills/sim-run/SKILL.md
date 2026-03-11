---
name: sim-run
description: "シミュレーション実行（四半期ターン進行）"
user-invokable: true
disable-model-invocation: true
---

### User Input
```
$ARGUMENTS
```

### パラメータ解析
Parse from $ARGUMENTS:
- `simPath`: path or slug to simulation (optional — if omitted, show selection)
- `N`: number of quarters to run (optional — if omitted, ask user during scenario selection)
- `--scenario <name>`: run specific scenario only (predefined mode)
- `--all`: run all scenarios/branches
- `--branch <name>`: run specific branch (dynamic mode)

### Phase 0: 準備（Simulation Resolution + State Loading）

以下の内容でサブエージェントに委譲する:

```
Agent({
  subagent_type: "general-purpose",
  description: "シミュレーション準備: 解決・状態ロード",
  prompt: """
以下の手順でシミュレーションの準備を行い、結果をJSON形式で返してください。

## 入力パラメータ
- simPath: {simPath または "未指定"}
- scenario: {scenario または "未指定"}
- all: {true/false}
- branch: {branch または "未指定"}

## 手順

### 1. シミュレーション解決
- simPath がフルパスなら → そのまま simDir として使用
- simPath がスラッグなら → `npx tsx sims/src/helpers/sim-registry.ts find <slug>` で解決
- simPath が未指定なら → `npx tsx sims/src/helpers/sim-registry.ts list --limit 5` を実行し、AskUserQuestion でユーザーに選択させる

### 2. steering.md の読み込み
- `{simDir}/steering.md` を Read ツールで読み込み、以下を抽出:
  - モード: predefined / dynamic
  - エージェント構成（実行順）
  - シミュレーション期間

### 3. 実行ターゲットと実行四半期数の決定
- predefined モードの場合:
  - `--scenario <name>` が指定 → そのシナリオのみ
  - `--all` が指定 → 全シナリオ（steering.md から抽出）
  - 未指定 → AskUserQuestion でユーザーに選択させる（後述の四半期数も同時に聞く）
- dynamic モードの場合:
  - `--branch <name>` が指定 → そのブランチ
  - 未指定 → "main" を使用
  - AskUserQuestion で四半期数を聞く（後述）

#### シナリオ/ブランチ未指定またはN未指定の場合の AskUserQuestion

predefined でシナリオが未指定、または N が未指定（引数から取得できなかった場合）の場合、以下の形式で一度にまとめて聞く:

```
AskUserQuestion({
  questions: [
    // predefined かつ未指定の場合のみ追加（dynamic の場合は省略）
    {
      question: "実行するシナリオを選んでほしいのだ！",
      header: "シナリオ選択",
      options: [/* steering.md から抽出したシナリオ名 */],
      multiSelect: false
    },
    // N が引数に指定されていない場合のみ追加
    {
      question: "何四半期分実行するのだ？",
      header: "実行四半期数",
      options: [
        { label: "1", description: "1四半期だけ進める" },
        { label: "2", description: "2四半期進める" },
        { label: "4", description: "4四半期（1年分）進める" },
        { label: "8", description: "8四半期（2年分）進める" }
      ],
      multiSelect: false
    }
  ]
})
```

ユーザーの回答から `quarters_to_run`（数値）を確定させる。引数で N が指定済みの場合はその値を使う。

### 4. 状態ロード
`npx tsx sims/src/helpers/state-manager.ts load <simDir> [--branch/--scenario]`

### 5. 直近コンテキスト取得
`npx tsx sims/src/helpers/metrics-tracker.ts context <simDir> 2 [--branch/--scenario]`

## 出力形式
以下のJSON形式で返してください:
{
  "simDir": "sims/sessions/...",
  "mode": "predefined" | "dynamic",
  "targets": ["scenario1", ...] | ["main"],
  "agents": [{"id": "...", "name": "...", "order": 1}, ...],
  "current_quarter": "Q2-2026",
  "turn_number": 0,
  "quarters_to_run": 1,
  "initial_state_summary": "...",
  "recent_context": "..."
}
"""
})
```

サブエージェントの結果を受け取り、以降のフェーズで使用する変数（simDir, mode, targets, agents, current_quarter, turn_number, **quarters_to_run**, initial_state_summary, recent_context）をメモリに保持する。`quarters_to_run` をメインループの反復回数として使用する。

### Main Loop: For each quarter (repeat quarters_to_run times):

#### Phase 1: イベント生成（1A: 候補抽出 → 1B: LLM選択・生成）

##### Phase 1A: 条件フィルタ（TSヘルパー直接実行）

```bash
npx tsx sims/src/helpers/event-roller.ts candidates {simDir} {--scenario <name> | --branch <name>}
```

出力は `{ candidates: RolledEvent[], max_slots: number }` のJSON。
`candidates`（プール由来の条件マッチ済み候補）と `max_slots`（今期の最大イベント数）をメモリに保持する。

##### Phase 1B: LLMによるイベント選択・追加生成（サブエージェント委譲）

```
Agent({
  subagent_type: "general-purpose",
  model: "sonnet",
  description: "イベント選択・生成: {current_quarter}",
  prompt: """
このシミュレーションの現在の経緯を踏まえ、今期に発生するイベントを決定してください。

## シミュレーション状況
テーマ: {theme from steering.md}
現在: {current_quarter}（ターン{turn_number}）
シナリオ/ブランチ: {scenario or branch name}

## 現在の世界状態
{state summary from state-manager.ts}

## 直近の経緯（直近2Q）
{recent context from metrics-tracker.ts}

## 今期の候補イベント（プール由来・条件クリア済み）
{candidates を以下の形式で列挙}
- [{id}] {name}（{magnitude}）: {description}
  → 影響領域: {impact_areas}
（候補が0件の場合は「候補なし」と表示）

## タスク

### Step 1: 候補から選択
上記の候補イベントのうち、**現在の経緯・世界状態から見て今期発生することが自然なもの**を選んでください。
- 不自然なもの・時期尚早なものは選ばないこと
- 最大 {max_slots} 件まで選択可能
- 0件でも構わない

### Step 2: 追加生成（任意）
Step 1 で選んだ件数が {max_slots} 未満の場合、**プールにはないが今期の流れから必然的に起きるべき事象**があれば追加生成してください。
- 過去のイベントと矛盾しないこと
- 現在の世界状態から自然に導かれること
- 文脈上不自然なら追加しなくてよい

## 出力形式（JSONのみ・他のテキスト不要）
{
  "selected_events": [
    {
      "id": "{pool event id}",
      "name": "{name}",
      "description": "{description}",
      "impact_areas": ["{state_key}"],
      "magnitude": "low|medium|high",
      "source": "pool",
      "selection_reason": "選んだ理由（1文）"
    }
  ],
  "generated_events": [
    {
      "id": "generated-{current_quarter}-1",
      "name": "イベント名（日本語）",
      "description": "説明（1〜2文）",
      "impact_areas": ["{state_key}"],
      "magnitude": "low|medium|high",
      "source": "generated",
      "generation_reason": "生成した理由（1文）"
    }
  ]
}
"""
})
```

サブエージェントの結果から `selected_events` と `generated_events` を合成して `rolledEvents` とし、メインフローで 🎲 emoji と共に表示する。

#### Phase 2: エージェント意思決定（Sequential Subagents）

Read `steering.md` to get agent execution order (from the エージェント構成 table).
For each agent (except analyst, which is Phase 3):

1. Read `agents/{id}.md` using Read tool
2. Get current state summary: `npx tsx sims/src/helpers/state-manager.ts summary <simDir> [--branch/--scenario]`
3. Build prompt for the Agent tool with this template:

```
あなたは以下のペルソナで行動するシミュレーションエージェントです。

## ペルソナ
{contents of agents/{id}.md}

## シミュレーション設定（要約）
テーマ: {theme from steering.md}
現在: {current_quarter}（ターン{turn_number}）
シナリオ: {scenario or branch name}

## 今期の外部イベント
{rolled events as formatted list}

## 現在の世界状態（要約）
{state summary from state-manager.ts}

## 直近の経緯
{recent context from metrics-tracker.ts}

## 今期の先行エージェントの行動
{summary of previous agents' outputs this quarter}

## 指示
上記を踏まえ、今期のあなたの行動を出力してください。
出力は以下のJSON形式で返してください:
{
  "situation_assessment": "状況認識テキスト",
  "actions": [{ "action": "行動名", "detail": "具体的な内容" }],
  "state_delta": { "key": new_value },
  "delta_details": { "key": "この指標が変化した理由（1文）" },
  "delta_reasoning": "変更理由（全体まとめ）"
}
- `delta_details` は `state_delta` の各キーに対応する理由を1文で記述してください
JSONのみを出力し、他のテキストは含めないでください。
```

4. Call Agent tool: `subagent_type: "general-purpose"`, `model: "sonnet"`
5. Parse JSON from agent output
6. Apply delta: `npx tsx sims/src/helpers/state-manager.ts apply <simDir> <agentId> --delta-json '<deltaJson>' [--branch/--scenario]`
7. Display progress with agent-specific emoji
8. Collect output for next agents

#### Phase 3: アナリスト（二次効果 + サマリー）

Same as Phase 2 but with the analyst agent, using extended prompt template:

```
あなたはアナリストとして、全エージェントの行動を統合分析します。

## ペルソナ
{contents of agents/analyst.md}

## シミュレーション設定（要約）
テーマ: {theme from steering.md}
現在: {current_quarter}（ターン{turn_number}）
シナリオ: {scenario or branch name}

## 今期の外部イベント
{rolled events as formatted list}

## 現在の世界状態（要約）
{state summary from state-manager.ts}

## 直近の経緯
{recent context from metrics-tracker.ts}

## 全エージェントの今期の行動
{all agent outputs formatted as:
### {agent_name} ({agent_id})
- 状況認識: {situation_assessment}
- 行動:
  - {action}: {detail}
- 状態変更: {state_delta の要約}
}

## 指示
全エージェントの行動を統合分析し、以下のJSON形式で出力してください:
{
  "situation_assessment": "全体の状況認識テキスト",
  "actions": [{ "action": "分析行動名", "detail": "具体的な内容" }],
  "state_delta": { "key": new_value },
  "delta_details": { "key": "この指標が変化した理由（1文）" },
  "delta_reasoning": "変更理由（全体まとめ）",
  "quarterly_summary": "四半期の統合サマリー（3〜5文で要約）",
  "secondary_effects": [
    { "trigger": "何がトリガーか", "effect": "何が起きるか", "state_delta": { "key": new_value } }
  ],
  "branch_point": {
    "detected": true/false,
    "reason": "分岐理由（detectedがtrueの場合）",
    "proposed_branches": ["branch-name-1", "branch-name-2"]
  }
}
JSONのみを出力し、他のテキストは含めないでください。

注意事項:
- state_delta には数値変更を具体的な値で指定してください（相対値ではなく絶対値）
- delta_details は state_delta の各キーに対応する理由を1文で記述してください
- secondary_effects は、複数エージェントの行動が組み合わさって生じる二次的な効果を記述してください
- branch_point は、シミュレーションの展開が大きく分岐しうる重要な判断ポイントがある場合にのみ detected: true としてください
- quarterly_summary は、この四半期の全体像を簡潔に伝える文章にしてください
```

Apply analyst's state_delta, then each secondary_effect's state_delta sequentially:
```bash
npx tsx sims/src/helpers/state-manager.ts apply <simDir> analyst --delta-json '<analystDeltaJson>' [--branch/--scenario]
npx tsx sims/src/helpers/state-manager.ts apply <simDir> analyst-secondary --delta-json '<secondaryEffectDeltaJson>' [--branch/--scenario]
```

If dynamic mode AND branch_point.detected:
- Display branch proposal to user via AskUserQuestion
- If approved: `npx tsx sims/src/helpers/branch-manager.ts fork <simDir> <quarter> <branchName> [--from <currentBranch>]`

#### Phase 4: 記録（サブエージェント委譲）

タイムライン書き込み・メトリクス追記・state更新を1つのサブエージェントに委譲する:

```
Agent({
  subagent_type: "general-purpose",
  description: "四半期記録: {current_quarter}",
  prompt: """
以下の情報をもとに、四半期記録を完了してください。3つのタスクを順番に実行してください。

## 基本情報
- simDir: {simDir}
- 四半期: {current_quarter}
- ターン: {turn_number}
- シナリオ/ブランチ: {scenario or branch name}
- タイムラインファイルパス:
  - predefined: {simDir}/scenarios/{scenario}/timeline/{quarter}.md
  - dynamic:    {simDir}/branches/{branch}/timeline/{quarter}.md
  - ルートのみ: {simDir}/timeline/{quarter}.md

## 外部イベント
{rolled events}

## エージェント行動
{all agent outputs formatted}

## アナリスト分析
{analyst output formatted}

## 二次効果
{secondary effects formatted}

---

## タスク 1: タイムラインファイル作成
指定のファイルパスに以下のフォーマットで書き込んでください:

# {quarter} タイムライン

## 外部イベント
- イベント名: 説明

## エージェント行動
### {agent_name}
- **状況認識**: ...
- **行動**: ...

## アナリスト統合分析
- **サマリー**: ...
- **二次効果**: ...

## 主要指標スナップショット
| 指標 | 値 | 前期比 | 変化理由 |
|------|-----|--------|---------|
| ... | ... | ... | ... |

※ 変化理由は各エージェントの delta_details から対応するキーの理由を引用してください。複数エージェントが同じ指標を変化させた場合は最後に適用したエージェントの理由を使用してください。

## タスク 2: メトリクス追記
以下のコマンドを実行してください:
```bash
npx tsx sims/src/helpers/metrics-tracker.ts append {simDir} {current_quarter} {--branch <name> | --scenario <name>}
```

## タスク 3: state meta の更新
以下のパスの world-state.json を読み込み、以下を更新して書き込んでください:
- predefined モード: {simDir}/scenarios/{scenario}/world-state.json
- dynamic モード:    {simDir}/branches/{branch}/world-state.json
- ルートのみ:        {simDir}/world-state.json
- `meta.current_quarter`: 次の四半期に進める（Q1→Q2→Q3→Q4→Q1(翌年)）
  例: "Q4-2025" → "Q1-2026"
- `meta.turn_number`: 現在値 +1

3つのタスクが完了したら "done" と返してください。
"""
})
```

### Progress Display Format

For each quarter, display progress like:
```
▶ Q2 2025 (main)
  🎲 Events: イベント名1, イベント名2
  🤖 Agent1名: 行動の要約
  ⚔️ Agent2名: 行動の要約
  ...
  📊 Analyst: サマリーの要約
     ⚡ 二次効果: 効果の要約
  ✅ Q2 2025 完了
```

### Completion
After all quarters:
```
シミュレーション完了なのだ！
{simDir}: Q{start} → Q{end} ({N}四半期実行)
```

完了メッセージの後、**必ず**以下の形式で次のコマンドをコードスニペットとして表示する:

```
続けて実行する場合は以下のコマンドをそのまま使えるのだ！
```

````
/sim-run {DATE}-{SLUG}
````

- `{DATE}` は `sims/sessions/` 以下のフォルダ名の日付部分（例: `20260312`）
- `{SLUG}` は同フォルダ名のスラッグ部分（例: `saas-ai-evolution`）
- `simDir` から自動で組み立てる（例: `sims/sessions/20260312-saas-ai-evolution` → `/sim-run 20260312-saas-ai-evolution`）

### Important Notes
- Use ずんだもん character (語尾: 〜のだ) in user-facing messages
- Subagent prompts should be in standard Japanese (no character voice)
- All TSヘルパー calls via Bash tool
- Parse JSON carefully from subagent outputs — they may include markdown formatting, so extract JSON from between ```json and ``` if needed
- Handle errors gracefully: if a subagent returns invalid JSON, retry once or ask user
- Delegate Phase 4 (timeline writing + metrics append + state meta update) entirely to a sub agent to save context window
- When running --all for predefined mode, iterate over each scenario sequentially
- Quarter advancement logic: Q1→Q2→Q3→Q4→Q1(next year). Example: "Q4 2025" → "Q1 2026"
