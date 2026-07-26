# BulkBro v0.2 Firebase

## 起動
1. ZIPを展開
2. フォルダ上部のアドレス欄へ `cmd`
3. 次を実行

```cmd
npm install
npm run dev
```

## 最初に必ず行うこと
Firebase Console → Firestore Database → **ルール** を開き、同梱の `firestore.rules` の内容へ置き換えて **公開**。

## 実装済み
- Googleログイン／ログアウト
- Firestoreでユーザー別に同期
- 自由タイトルのルーティン作成
- 保存済みルーティンを「トレーニング開始」に反映
- ルーティン全種目を1画面で記録
- 部位→単独種目記録
- 種目自由追加
- 前回記録表示
- 維持・回数UP・重量UP候補
- きつさ（余裕・普通・限界）
- 前セットコピー
- 総ボリューム・PR表示
- 日付ごとに全種目をまとめた履歴

## 注意
外でスマホから使うには、次にVercelまたはFirebase Hostingへ公開する必要があります。
