---
name: common-md-to-pdf
description: "指定のmdファイルをpdfファイルに書き出す（複数指定可・同じ階層に出力）"
user-invokable: true
---

# md-to-pdf: Markdown → PDF変換コマンド

指定されたMarkdownファイルをPDFに変換するコマンドなのだ。
変換には実績のある `md-to-pdf` パッケージを npx 経由で実行するのだ。
**出力先は各入力ファイルと同じディレクトリ**に `.pdf` 拡張子で生成されるのだ。
**複数ファイルをスペース区切りで指定すると、それぞれ変換するのだ。**

---

## User Input

```text
$ARGUMENTS
```

---

## パラメータ解析

User Inputから以下を取得:

- **input_files**: 変換対象のMarkdownファイルパスのリスト（スペース区切り、1つ以上必須）

出力ファイルは各ファイルごとに自動決定:
- 入力ファイルと**同じディレクトリ**
- 拡張子を `.md` → `.pdf` に変換

### 解析例

```
/md-to-pdf topics/20260223_xxx/conclusion.md
```
→ input_files: `["topics/20260223_xxx/conclusion.md"]`

```
/md-to-pdf topics/20260223_xxx/conclusion.md topics/20260223_yyy/research.md
```
→ input_files: `["topics/20260223_xxx/conclusion.md", "topics/20260223_yyy/research.md"]`

---

## Task toolで Bash agent を呼び出す

**必ず以下のようにTask toolを使用すること:**

```
Task({
  subagent_type: "Bash",
  description: "Markdown→PDF変換（複数ファイル）",
  prompt: `
    以下のMarkdownファイルをそれぞれPDFに変換してください。

    ## パラメータ
    - input_files:
      <解析したinput_filesを1行ずつ列挙>

    ## 実行内容

    各ファイルに対して順番に以下を実行してください:

    ### ファイルごとの処理（全ファイル分繰り返す）

    1. 入力ファイルの存在確認
       \`\`\`bash
       ls "<input_file>"
       \`\`\`
       ※ 存在しない場合はそのファイルをスキップしてエラーを記録し次のファイルへ

    2. npx で md-to-pdf を実行してPDFに変換
       ※ md-to-pdf はデフォルトで入力ファイルと同じディレクトリにPDFを出力する
       \`\`\`bash
       npx md-to-pdf@5.2.5 "<input_file>"
       \`\`\`

    3. 出力ファイルの存在確認（拡張子を .pdf に変えたパス）
       \`\`\`bash
       ls -lh "<output_file>"
       \`\`\`

    ### 全ファイル処理後

    4. 全ファイルの変換結果を一覧でまとめて報告
       - 成功したファイル（出力パスとサイズ）
       - 失敗したファイル（エラー内容）

    ## 注意事項
    - md-to-pdf は初回実行時にパッケージのダウンロードが発生する場合がある
    - 1つのファイルでエラーが発生しても、残りのファイルの変換は継続すること
    - 出力ファイルは入力ファイルと同じディレクトリに生成される
  `
})
```

---

## 完了条件

- [ ] 全入力ファイルの処理（変換 or エラー記録）が完了済み
- [ ] 変換成功ファイルのパスとサイズを報告済み
- [ ] 変換失敗ファイルがある場合はエラー内容を報告済み

---

## 出力形式

```
✅ PDF変換完了！

変換結果:
- ✅ topics/xxx/conclusion.md → topics/xxx/conclusion.pdf (123 KB)
- ✅ topics/yyy/research.md  → topics/yyy/research.pdf  (456 KB)
- ❌ topics/zzz/missing.md   → エラー: ファイルが見つかりません

成功: 2件 / 失敗: 1件
```

---

## 注意事項

- 入力ファイルが存在しない場合はスキップしてエラーを記録すること
- 1ファイルでも変換できれば処理を継続すること
- **必ずTask toolを使ってBash agentを呼び出すこと**
- npx は初回実行時にパッケージをダウンロードするため少し時間がかかる場合がある
