# AI Workspace

> Claude Code を活用して、調査・検討タスクを体系的に管理するためのワークスペース

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)]()

## 概要

AI Workspace は、調査や検討を「トピック」単位で管理し、以下を実現します：

- 📝 調査内容の記録と追跡
- ✅ 結論・意思決定の明確化
- 📋 タスク管理と進捗追跡
- 🏷️ タグによる整理とインデックス化

## ディレクトリ構成

```
ai-workspace/
├── README.md              # このファイル
├── index.md               # トピック一覧 + タグインデックス
├── topics/                # トピックフォルダ群
│   └── YYYYMMDD_slug/     # 各トピック（日付プレフィックス）
│       ├── conclusion.md  # 調査・検討の結論まとめ
│       ├── research.md    # 調査内容の記録
│       └── tasks.md       # タスク管理
├── templates/             # テンプレートファイル群
│   ├── conclusion.template.md
│   ├── research.template.md
│   └── tasks.template.md
└── .workspace/            # 設定・メタデータ
    └── config.yaml        # ワークスペース設定
```

## 使い方

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `/topic-start <トピック名>` | 調査開始（トピック作成→調査計画→初期調査→暫定結論を一括実行） |
| `/topic-research <クエリ/URL>` | 調査実行（Web検索/URL取得し research.md と conclusion.md に記録） |
| `/topic-task <操作>` | タスク操作（add/done/update/list で tasks.md を管理） |

> **Note**: コマンドは Claude Code のスラッシュコマンドとして実行します。

### 基本的なワークフロー

```
1. /topic-start でトピックを開始（暫定結論も自動作成）
   ↓
2. /topic-research で追加調査（conclusion.md にも追記）
   ↓
3. 必要に応じて繰り返し、完了したら /topic-archive
```

### 使用例

```bash
# 新しい調査トピックを開始
/topic-start "Claude Code の活用方法調査"

# 追加で Web 検索して調査
/topic-research "Claude Code best practices 2026"

# 特定の URL から情報を取得
/topic-research https://docs.anthropic.com/...

# タスクを追加
/topic-task add "ドキュメントを確認する"

# タスクを完了
/topic-task done 1
```

## 各ファイルの役割

| ファイル | 役割 |
|---------|------|
| `conclusion.md` | 調査・検討の最終的な結論・結果をまとめる。意思決定の根拠も記載 |
| `research.md` | 調査過程で得た情報、参照URL、メモなどを時系列で記録 |
| `tasks.md` | そのトピックに関するタスクを管理。進捗状況も追跡 |

## タグ

トピックにはタグを付けて整理できます。

### プリセットタグ

- `#tech/ai` - AI・機械学習関連
- `#tech/development` - 開発関連
- `#business/strategy` - ビジネス戦略
- `#research/investigation` - 調査・研究
- `#personal/learning` - 個人学習

### 命名規則

- **トピックフォルダ**: `YYYYMMDD_slug-name`
  - 例: `20260202_philippines-software-engineer-salary`
  - 日付は作成日、slug は英数字とハイフンのみ
- **タグ**: `#category/subcategory` 形式
  - 例: `#tech/ai`, `#business/strategy`, `#offshore/philippines`

## インデックス管理

`index.md` はトピックの一覧とタグ別インデックスを管理します。

- **最近のトピック**: 新しく作成されたトピックが表示される
- **タグ別インデックス**: タグごとにトピックを分類して表示

## 要件

- [Claude Code](https://claude.ai/code) がインストールされていること
- 対応するスキル（topic-* コマンド）が設定されていること

## ライセンス

Private

---

*Last updated: 2026-02-04*
