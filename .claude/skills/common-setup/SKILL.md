---
name: common-setup
description: "ワークスペースの初期セットアップ（topics/index.mdの作成）"
user-invokable: true
disable-model-invocation: true
---

# topic:setup: ワークスペース初期セットアップ

ワークスペースに必要な初期ファイルを作成するコマンドなのだ。
再度走らせても安全（既存ファイルは上書きしない）。

---

## 実行内容

### Step 1: topics/index.md の存在チェックと作成

1. `topics/index.md` が存在するか確認する
2. **既に存在する場合**: 「topics/index.md は既に存在するので作成をスキップしたのだ」と表示し、作成しない
3. **存在しない場合**: `topics/templates/index.template.md` をテンプレートとして読み込み、`{{DATE}}` を今日の日付（YYYY-MM-DD）に置換して `topics/index.md` を作成する

### Step 2: topics/ ディレクトリの存在チェックと作成

1. `topics/` ディレクトリが存在するか確認する
2. **既に存在する場合**: スキップ
3. **存在しない場合**: `topics/` ディレクトリを作成する

### Step 3: 完了報告

作成したもの・スキップしたものを一覧で表示する。

---

## 出力形式

```
セットアップ完了なのだ！

- topics/index.md: <作成した / 既に存在するのでスキップ>
- topics/: <作成した / 既に存在するのでスキップ>
```

---

## 注意事項

- 既存ファイルは**絶対に上書きしない**（冪等性を保証）
- 何度実行しても安全
