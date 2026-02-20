---
description: 調査実行（WebSearch/WebFetchで情報収集しresearch.mdに記録）
---

# topic-research: 調査実行コマンド

指定されたクエリまたはURLで調査を実行し、research.md に記録するコマンドなのだ。

---

## 実行モデル: Task tool による Agent 呼び出し

このコマンドは **Task tool を使って topic-research-agent を呼び出す**のだ。

---

## User Input

```text
$ARGUMENTS
```

---

## パラメータ解析

User Inputから以下を判定:

- **query_or_url**: 調査クエリまたはURL（必須）

判定ルール:
- `http://` または `https://` で始まる場合 → URL
- それ以外 → 検索クエリ

---

## 現在のステータス確認

最新のトピックフォルダを特定:
```bash
ls -td topics/*/ 2>/dev/null | head -1
```

---

## Task toolで topic-research-agent を呼び出す

**必ず以下のようにTask toolを使用すること:**

```
Task({
  subagent_type: "topic-research-agent",
  description: "調査実行",
  prompt: `
    query_or_url: <入力値>
    topic_folder: <自動検出または最新>

    以下を実行してください:

    1. 対象トピックの特定
    2. 入力タイプの判定（URL/クエリ）
    3. 調査実行
       - URL → WebFetch
       - クエリ → WebSearch
    4. research.md に結果を追記
       - タイムスタンプ付きで追記
       - ソースURLを必ず記載
    5. 追加調査の提案
    6. 完了報告
  `
})
```

---

## 完了条件

- [ ] 調査結果がresearch.mdに追記済み
- [ ] タイムスタンプが正しい形式
- [ ] ソースURLが記載済み
- [ ] 関連リンクが追加済み

---

## 次のステップ

調査完了後、以下のコマンドが利用可能:

```
/topic-research <追加クエリ>  # 追加調査（conclusion.mdにも追記）
/topic-archive                # トピックをアーカイブ
```

---

## 注意事項

- 調査内容は常にタイムスタンプ付きで追記
- 同じ内容を重複して追記しないよう注意
- Web検索結果はソースURLを必ず記載
- **必ずTask toolを使ってAgentを呼び出すこと**
