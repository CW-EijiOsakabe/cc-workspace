---
name: sim-new
description: "新規シミュレーション作成（お題→Web調査→設定提案→ファイル生成）"
user-invokable: true
disable-model-invocation: true
---

# sim:new: 新規シミュレーション作成コマンド

ユーザーのお題をもとに、Web調査 → 設定提案 → ユーザー承認 → ファイル一式生成を行い、シミュレーション環境を構築するコマンドなのだ。

**重要**: 各フェーズは `Agent` ツールを使ってサブエージェントに委譲するのだ。メインフローはコーディネーターとして動作し、フェーズ間のデータ受け渡しとユーザーとのインタラクションのみを担当する。

---

## User Input

```text
$ARGUMENTS
```

---

## パラメータ解析

User Input から以下を抽出:

- **topic**: シミュレーションのお題・テーマ（必須）

### topic が空の場合

`$ARGUMENTS` が空の場合は `AskUserQuestion` で質問する:

```
AskUserQuestion({
  questions: [
    {
      question: "何をシミュレートしたいのだ？",
      header: "シミュレーションのお題",
      options: [],
      multiSelect: false
    }
  ]
})
```

### slug化ルール

- 日本語の場合: 内容を表す短い英語のslugに変換（例: "AI時代の工数管理SaaS市場" → `saas-ai-evolution`）
- 英語の場合: lowercase + ハイフン区切り（例: "Fintech Disruption" → `fintech-disruption`）
- 最大40文字に抑える

### 日付と開始四半期

- 今日の日付を `YYYYMMDD` 形式で取得（Bashで `date +%Y%m%d`）
- 以降 `{DATE}` と表記する
- **実行時点の次の四半期**を計算する。以下のコマンドで求める:

```bash
npx tsx sims/src/helpers/utils.ts next-quarter-from-now
```

- 以降この値を `{START_Q}` と表記する（例: 2026年3月実行 → `Q2-2026`）

### 変数定義

以降のフェーズで使用する変数:

- `{DATE}`: YYYYMMDD形式の今日の日付
- `{SLUG}`: slug化されたお題
- `{SIM_DIR}`: `sims/sessions/{DATE}-{SLUG}` （プロジェクトルートからの相対パス）
- `{START_Q}`: シミュレーション開始四半期（実行時点の次の四半期。例: `Q2-2026`）

### 重複チェック

同じ `{SIM_DIR}` が既に存在する場合は、ユーザーに確認してから上書きするか、slug末尾に連番を付与する（例: `-2`）。

---

## 実行フロー

```
Phase 1: Web調査 → Phase 2: 設定提案・承認 → Phase 3: ファイル生成 → Phase 4: 完了表示
```

各フェーズは `Agent` ツールのサブエージェント（`general-purpose`）に委譲するのだ。フェーズ完了後、サブエージェントの結果を受け取り、次フェーズに引き継ぐ。

---

## Phase 1: Web調査（サブエージェント委譲）

### 調査観点の決定

お題を分析し、**そのテーマに最適な4〜5の調査観点**を決定する。固定の観点ではなく、お題の性質に応じて選ぶこと。

観点の選び方の例:

| お題の性質 | 調査観点の例 |
|---|---|
| B2Bビジネス・SaaS | 市場規模/成長率・競合構造・技術スタック・価格帯・採用障壁 |
| 消費者向けサービス | ユーザー行動・競合ブランド・テクノロジートレンド・規制・SNS動向 |
| ハードウェア・製造 | 技術成熟度・サプライチェーン・主要メーカー・コスト構造・需要予測 |
| ヘルスケア・医療 | 臨床エビデンス・規制/承認動向・医療費・プレイヤー・患者動向 |
| エネルギー・環境 | 政策・補助金・コスト曲線・技術革新・国際比較・インフラ状況 |
| 金融・フィンテック | 規制/ライセンス・既存金融との競合・ユーザー信頼度・技術安全性 |
| 教育・HRテック | 学習効果・導入率・政策・競合・ユーザー（教員/学習者）動向 |
| 社会・政策系 | 統計データ・政策動向・国際比較・社会的影響・ステークホルダー |

上記はあくまで参考であり、お題の特性に合わせて自由に設計すること。

### サブエージェントへの委譲

以下の内容でサブエージェントに委譲する:

```
Agent({
  subagent_type: "general-purpose",
  description: "Web調査: {お題}",
  prompt: """
お題「{お題}」について、以下の調査観点でWebSearchを実行し、調査結果をまとめてください。

## 調査観点
{決定した4〜5の調査観点と、各観点の検索クエリ例}

## 実行内容
- 各観点につき1〜2回のWebSearchを実施
- 日本市場が主な場合は日本語クエリも追加
- 信頼性の高い情報源（業界レポート、公的機関、大手メディア）を優先

## 出力形式
以下のMarkdown形式でまとめてください:

# リサーチコンテキスト: {お題タイトル}

> 調査日: {DATE}

## {観点1}

- {調査結果を箇条書きで整理}
- 出典: {URL}

## {観点2}
...（各観点を同様に）

## シミュレーションへの示唆

- {調査結果から得られた、シミュレーション設計に役立つ示唆を3〜5点}
"""
})
```

サブエージェントの結果（research-context の全文）をメモリに保持し、Phase 2 に引き継ぐ。

→ **Phase 2 へ進む**

---

## Phase 2: 設定提案 → ユーザー承認

調査結果をもとに設定を設計するサブエージェントを起動し、その後ユーザーとのインタラクションを行う。

### Step 1: 設定案の設計（サブエージェント委譲）

```
Agent({
  subagent_type: "general-purpose",
  description: "シミュレーション設定設計: {お題}",
  prompt: """
以下の調査結果をもとに、シミュレーション設定を設計してください。

## 調査結果
{Phase 1 の research-context 全文}

## 設計してほしい内容

## Effortレベル（制約）
- **Effort**: {EFFORT}（low または default）
- **low の場合**: エージェント数 2〜4体、世界状態パラメータ 7〜10個
- **default の場合**: エージェント数 5〜7体、世界状態パラメータ 15〜20個
必ずこの範囲に収めること。

### 1. エージェント構成（Effortに応じた体数）
お題のステークホルダーを洗い出し、Effortレベルで指定された体数のエージェントを設計する。
- **low**: 2〜4体（analyst含む）
- **default**: 5〜7体（analyst含む）

**最後のエージェントは必ず `analyst`（アナリスト）** とする。

各エージェント:
- ID: 英語のケバブケース
- 名前: 日本語の短い名称
- 役割: 何を代表するか（1文）
- 実行順: 1〜N

### 2. 世界状態の初期パラメータ（Effortに応じた個数）
- **low**: 7〜10個
- **default**: 15〜20個
- 全て数値型（文字列不可）
- 割合は 0.0〜1.0 のスケール
- 金額は単位を統一（例: 億円）
- 各キーに説明を付与

### 3. シミュレーション期間
- 開始四半期: `{START_Q}`（固定。変更不可）
- 終了四半期・合計四半期数はお題の規模・性質から適切に設計すること

### 4. イベントプール（10〜15個）
各イベントに: id, name(日本語), description, impact_areas, magnitude(low/medium/high),
cooldown_quarters, one_shot, conditions(state_min/state_max/requires_events/excludes_events)

- `base_probability` や `scenario_weights` は**使用しない**（LLMが文脈で選ぶため確率は不要）
- `conditions` でそのイベントが「起きうる前提状態」を定義すること
- ストーリー上の必然性（前後関係・段階）を `requires_events` / `excludes_events` で表現すること
- 例: 「市場独占完成」は `one_shot: true` + `requires_events: ["platform-bundling-announced"]`
- 例: 「第二波普及」は `cooldown_quarters: 4` + `state_min: { adoption_rate: 0.5 }`

### 5. 実行ルール
- max_delta_pct: デフォルト 0.2
- max_events_per_quarter: デフォルト 3

## 開始四半期（固定）
シミュレーション開始四半期は必ず `{START_Q}` を使用すること。自分で考えず、この値をそのまま使うこと。

## 出力形式
JSON形式で以下の構造で返してください:
{
  "agents": [...],
  "world_state": {...},
  "simulation_period": {"start": "{START_Q}", "end": "（お題の規模から適切に設定）", "total_quarters": N},
  "events": [...],
  "rules": {"max_delta_pct": 0.2, "max_events_per_quarter": 3}
}
"""
})
```

### Step 2: ユーザーへの提案表示

サブエージェントの結果を受け取り、読みやすく整形して表示する:

```
調査結果をもとに、シミュレーション設定を提案するのだ！

【エージェント構成】
| # | ID | 名前 | 役割 | 実行順 |
|---|---|---|---|---|
| 1 | {id} | {名前} | {役割} | 1 |
...
| N | analyst | アナリスト | 統合分析・二次効果・分岐検知 | N |

【世界状態の初期パラメータ】
| キー | 初期値 | 説明 |
|---|---|---|
...

【シミュレーション期間】
{開始Q} 〜 {終了Q}（{N}四半期）

【イベントプール】
{N}個のイベントを設計済み（主要なものを3〜5個表示）

【実行ルール】
- max_delta_pct: 0.2
- max_events_per_quarter: 3
```

### Step 3: シナリオモード・Effort選択

```
AskUserQuestion({
  questions: [
    {
      question: "シナリオモードを選んでほしいのだ！",
      header: "シナリオモード",
      options: [
        {
          label: "事前定義型（predefined）",
          description: "Baseline / Bullish / Bearish などの固定シナリオで比較"
        },
        {
          label: "動的分岐型（dynamic）",
          description: "1本のシミュレーションを進め、途中で分岐点を探索"
        }
      ],
      multiSelect: false
    },
    {
      question: "シミュレーションの規模（Effort）を選んでほしいのだ！",
      header: "Effortレベル",
      options: [
        {
          label: "Low",
          description: "エージェント数 2〜4体 / 世界状態パラメータ 7〜10個（高速・軽量）"
        },
        {
          label: "Default",
          description: "エージェント数 5〜7体 / 世界状態パラメータ 15〜20個（標準・詳細）"
        }
      ],
      multiSelect: false
    }
  ]
})
```

ユーザーの選択結果から `{EFFORT}` を確定させる（`low` または `default`）。

### Step 4: 承認

```
AskUserQuestion({
  questions: [
    {
      question: "この設定で進めて良いのだ？修正したい点があれば教えてほしいのだ！",
      header: "設定確認",
      options: [
        { label: "OK、このまま進める", description: "ファイル生成に進む" },
        { label: "修正したい", description: "修正点を指定する" }
      ],
      multiSelect: false
    }
  ]
})
```

「修正したい」が選ばれた場合は、修正内容を聞いて Step 1 のサブエージェントを再度呼び出して設定を更新し、再度承認を求める。

→ **Phase 3 へ進む**

---

## Phase 3: ファイル生成（サブエージェント委譲）

承認された設定に基づき、ファイル一式の生成をサブエージェントに完全委譲する。

```
Agent({
  subagent_type: "general-purpose",
  description: "シミュレーションファイル生成: {SIM_DIR}",
  prompt: """
以下の設定に基づいて、シミュレーションのファイル一式を生成してください。

## 基本情報
- SIM_DIR: {SIM_DIR}
- お題: {お題}
- シナリオモード: {predefined | dynamic}
- Effortレベル: {EFFORT}（low または default）

## 承認済み設定
{Phase 2 で承認された設定の全JSON}

## 調査結果
{Phase 1 の research-context 全文}

## 生成するファイル一覧

### 1. ディレクトリ作成
```bash
npx tsx sims/src/helpers/utils.ts init-dirs {SIM_DIR}
```

### 2. {SIM_DIR}/research-context.md
Phase 1 の調査結果をそのまま書き出す。

### 3. {SIM_DIR}/steering.md
以下のフォーマットで生成:
```markdown
# {シミュレーションタイトル}

## テーマ
{シミュレーションの主題を2〜3文で説明}

## 前提・制約
- {調査で判明した前提条件}
...

## シナリオモード
mode: {predefined | dynamic}

### 【predefined の場合】シナリオ一覧
| シナリオ名 | {条件軸1} | {条件軸2} | {条件軸3} | 説明 |
|---|---|---|---|---|
| baseline | 中 | 中 | 中 | 現状延長 |
| bullish | 高 | 高 | 低 | 楽観シナリオ |
| bearish | 低 | 低 | 高 | 悲観シナリオ |

### 【dynamic の場合】分岐ルール
- アナリストが「分岐点」と判定した場合、2〜3本の分岐を提案
- ユーザー承認後に分岐を実行
- 分岐は最大3階層まで

## エージェント構成
{エージェントテーブル}

## シミュレーション期間
- 開始: {開始Q} / 終了: {終了Q} / 合計: {N}四半期

## 実行ルール
- world-state の数値変更は ±{max_delta_pct * 100}% 以内/Q
- イベントは event-pool.json から確率ベースで抽選

## イベント設定
- イベントプール: events/event-pool.json
- 1Qあたり最大イベント数: {max_events_per_quarter}
```
※シナリオモードに応じて、該当しないセクションは削除する。

### 4. {SIM_DIR}/world-state.json
```json
{
  "meta": {
    "current_quarter": "{開始Q}",
    "turn_number": 0,
    "max_delta_pct": 0.2,
    "max_events_per_quarter": 3
  },
  "state": { /* 承認済みパラメータ全て */ },
  "events_log": [],
  "metrics_history": []
}
```
- predefined型: meta に "scenario": "baseline" を追加
- dynamic型: meta に "branch": "main" を追加

### 5. {SIM_DIR}/events/event-pool.json
```json
{
  "events": [
    {
      "id": "event-id",
      "name": "イベント名（日本語）",
      "description": "説明（1〜2文）",
      "impact_areas": ["state_key_1"],
      "magnitude": "medium",
      "cooldown_quarters": 3,
      "one_shot": false,
      "conditions": {
        "state_min": { "state_key": 0.4 },
        "state_max": { "state_key": 0.9 },
        "requires_events": [],
        "excludes_events": []
      }
    }
  ]
}
```
- `base_probability` / `scenario_weights` は**使用しない**
- `conditions` の各フィールドは不要なものは省略可（空配列・未指定でよい）
- 10〜15個のイベントを含める
- ストーリー上の前後関係を `requires_events` / `excludes_events` で表現すること

### 6. {SIM_DIR}/agents/{id}.md（各エージェント）
各エージェントのファイルを以下のテンプレートで生成:
```markdown
# {エージェント名}

## 役割
{1〜2文}

## objectives（目的）
- {目的1〜3}

## constraints（制約）
- {制約1〜2}

## success_metrics（成功指標）
- {指標1〜2}

## behavioral_tendency（行動傾向）
{1〜2文}

## action_space（取りうる行動の一覧）
- {行動1}: {説明}
...

## managed_state_keys（管轄パラメータ）
- `{state_key}`: {説明}

## 出力フォーマット
JSON形式で以下を返す:
- situation_assessment: 状況認識テキスト
- actions: action_spaceから選択した行動の配列
- state_delta: world-stateへの変更提案
- delta_reasoning: 変更理由
```

**analyst.md の追加フォーマット**:
- quarterly_summary: 四半期の統合サマリー
- secondary_effects: 二次効果の配列（trigger, effect, state_delta）
- branch_point: 分岐点の検知結果（detected, reason, proposed_branches）

### 7. シナリオ/ブランチ初期化

#### predefined型の場合
```bash
npx tsx sims/src/helpers/branch-manager.ts init-scenarios sims/sessions/{DATE}-{SLUG} scenario1,scenario2,scenario3
```

#### dynamic型の場合
```bash
mkdir -p {SIM_DIR}/branches/main/timeline
```
そして world-state.json を branches/main/world-state.json にコピーし、meta.branch を "main" に設定する。

### 8. {SIM_DIR}/timeline/Q0-initial.md
```markdown
# Q0: 初期状態

> {開始Q} - シミュレーション開始時点

## 概要
{お題の初期状況を2〜3文。調査結果に基づく。}

## 初期パラメータ
{world-state の state セクションを人間可読な形で列挙}

## 注目ポイント
- {注目ポイント1〜3}
```

全ファイルを生成後、生成したファイルのパス一覧を返してください。
"""
})
```

→ **Phase 4 へ進む**

---

## Phase 4: 完了表示

### ディレクトリ構造の表示

```bash
npx tsx sims/src/helpers/utils.ts list-files {SIM_DIR}
```

で実際のファイル一覧を表示する。

### 完了メッセージ

```
シミュレーションを作成したのだ！

お題: {タイトル}
フォルダ: {SIM_DIR}/
モード: {predefined | dynamic}
エージェント: {N}体
イベント: {N}個
期間: {開始Q} 〜 {終了Q}（{N}四半期）

次のステップ:
- steering.md を確認して、設定に問題がなければ `/sim:run` で実行開始なのだ
- エージェントの役割やイベントを調整したい場合は直接ファイルを編集できるのだ
```

やる夫のAscii Artを表示:

```
        ____
       /⌒  ⌒\
      /( ●)  (●)\
     /::::::⌒(__人__)⌒::::\
     |   |r┬-|    |
     \   `ー'´   /
```

---

## 注意事項

- Web調査に時間がかかる場合は、進捗状況をユーザーに知らせること
- research-context.md は後から参照される重要な資料なので、丁寧に整理する
- world-state.json の `state` 値は全て数値型とする（文字列不可）
- エージェントの `managed_state_keys` が重複しないよう注意する
- イベントの `impact_areas` は `state` のキー名と正確に一致させる
- ずんだもんキャラクター（語尾: 〜のだ、〜なのだ）を維持すること
- フェーズ間のデータ受け渡し（research-context、設定JSON）は必ず次のサブエージェントに完全に渡すこと
