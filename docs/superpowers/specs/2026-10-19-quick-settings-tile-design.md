# 快速設定磚「清理連結」— 設計文件

- 日期：2026-10-19
- 狀態：待審閱
- 目標版本：0.1.3（Android）
- 分支：`feat/qs-tile`（從 `feat/link-safety-phase1` b0d6971 開出）

## 1. 目標

### 1.1 為什麼要做
使用者最常見的流程是：在 FB、Threads 等 App 按「複製連結」，再貼到 LINE、Teams、Discord。
目前要清理，得切到 Untail、等它偵測剪貼簿、再切回去，切換 App 兩次。

想要的流程：
**複製連結 → 拉下通知列 → 點「清理連結」磚 → 回到原本的 App 直接貼上**（Gboard 鍵盤上方的剪貼簿建議就已經是乾淨的連結）。

### 1.2 限制（已查證）
- Android 10 起，只有前景 App 與預設輸入法能讀剪貼簿；背景監聽剪貼簿不可行
- 無障礙服務用於非輔助用途違反 Google Play 政策，不用
- vivo OriginOS 6 沒有 Android 原廠的剪貼簿預覽（實測：複製時只有 Gboard 的剪貼簿建議事件，SystemUI 沒有事件），所以「預覽上的分享按鈕」這條路在使用者的主力機上不可用
- iOS 沒有快速設定磚：本設計不含 iOS

### 1.3 成功標準
1. 在 vivo（Android 16、OriginOS 6）上：複製連結後點磚，約 2 秒內回到原本的 App，剪貼簿已是乾淨連結
2. 在 Xperia 1 V（Android 15）、Xperia 5 II（Android 12）、LG V35（Android 10，之後 15）、模擬器上同樣可用，或明確記錄哪裡不行
3. 不新增任何需要使用者同意的權限；不在背景讀剪貼簿

## 2. 做法：點磚就打開 Untail，沿用現有流程（方案 A）

點磚會把 Untail 帶到前景（App 在前景時才有權限讀剪貼簿），用現有的清理流程處理，成功後自動退回原本的 App。

不採用的做法：
- B：透明畫面讀剪貼簿＋背景 JS 任務清理。完全看不到 Untail 畫面，但原生程式碼多、背景任務在各廠商系統上行為不一。若 A 的畫面閃動被認為太干擾，再升級成 B，磚可沿用
- C：用 Kotlin 重寫清理邏輯。規則要維護兩份，不做

已知代價：點磚時會看到 Untail 畫面短暫出現；App 不在記憶體中時要冷啟動（約 1～2 秒）。

## 3. 使用者行為

### 3.1 磚
- 名稱：清理連結／Clean link／リンクをクリーン（依系統語言）
- 圖示：Untail 單色壁虎（沿用 `assets/monochrome.png` 的造型，做成 24dp 向量圖）
- 狀態：永遠是「未啟用」外觀（這是動作，不是開關）
- 鎖定畫面時點磚：先要求解鎖，解鎖後才執行

### 3.2 點磚後的結果

| 剪貼簿內容／清理結果 | 提示（Toast） | 之後 |
|---|---|---|
| 清理成功（移除了追蹤碼或隱藏字元），已複製 | 「已複製乾淨連結（移除 N 項）」 | 退回原本的 App |
| 連結本來就乾淨（沒有可移除的東西） | 「沒有找到追蹤碼」 | 退回原本的 App，剪貼簿不變 |
| 剪貼簿沒有連結 | 不提示 | 留在 Untail，首頁顯示「剪貼簿沒有連結」的說明 |
| 展開失敗、只完成一部分（partial）、無法處理（failed） | 不提示 | 留在 Untail，顯示結果卡與原因（現有 UI） |
| 讀剪貼簿失敗（例如系統拒絕） | 不提示 | 留在 Untail，顯示說明 |

- 點磚＝使用者明確要求清理：不看「偵測剪貼簿」「自動處理剪貼簿連結」兩個設定，一律執行；清理成功一律自動複製
- 歷史紀錄：照現有「歷史紀錄」設定
- 「N 項」：結果中被移除的項目數（追蹤參數＋隱藏字元種類），與結果卡標題用同一個計數
- 退回的條件：只有在「點磚前 Untail 不在前景」時才退回。如果使用者原本就在 Untail 裡、拉下通知列點磚，就留在 Untail 顯示結果（不要把使用者丟到桌面）

### 3.3 讓使用者加入磚
- 設定頁新增一列「加入快速設定」：
  - Android 13 以上：呼叫系統的「加入磚」對話框（`StatusBarManager.requestAddTileService`）
  - Android 12 以下：顯示說明「拉下通知列 → 編輯 → 把『清理連結』拖進去」
- 首頁「三種用法」說明中，Android 加上第四種：快速設定磚

## 4. 架構

### 4.1 元件

```
[TileService (Kotlin)] --點擊--> [MainActivity] --新 intent--> [UntailTile 模組 (Kotlin)]
                                                                   │  事件 onTileLaunch
                                                                   ▼
                                            [TileWatcher (React，與 ShareWatcher 同層)]
                                                                   │  讀剪貼簿 → enqueue(text, auto)
                                                                   ▼
                                       [decideTileOutcome (純函式)] → Toast ＋ moveTaskToBack 或留下
```

| 元件 | 位置 | 職責 |
|---|---|---|
| `CleanLinkTileService` | `apps/mobile/modules/untail-tile/android/` | 磚本身：點擊時（鎖定則先 `unlockAndRun`）以 `startActivityAndCollapse` 帶 `untail_tile_launch=true` 啟動 MainActivity |
| `UntailTileModule` | 同上 | Expo 原生模組：(1) `OnCreate`／`OnNewIntent` 讀取並清除 extra，送出 `onTileLaunch` 事件；(2) `consumeInitialTileLaunch(): Boolean`（冷啟動時 JS 準備好後來拿）；(3) `moveTaskToBack()`；(4) `requestAddTile(): Promise<'added' \| 'already' \| 'dismissed' \| 'unsupported'>` |
| `AndroidManifest.xml`（模組內） | 同上 | 宣告 service：`android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"`、`android.service.quicksettings.action.QS_TILE`、`exported=true` |
| 字串資源 | 模組 `res/values`、`values-zh-rTW`、`values-ja` | 磚名稱 |
| `modules/untail-tile/index.ts` | JS 介面 | Android 以外平台回傳不支援／no-op |
| `TileWatcher` | `apps/mobile/app/_layout.tsx` | 收到磚啟動 → 等 App 準備好 → 讀剪貼簿（含重試）→ `enqueue` → 依結果處理 |
| `decideTileOutcome` | `apps/mobile/src/lib/tileOutcome.ts` | 純函式，把（剪貼簿內容、清理結果、點磚前是否在前景）對應到動作 |

### 4.2 Android 版本差異
- `startActivityAndCollapse`：API 34 以上必須用 `PendingIntent` 版本；33 以下用 `Intent` 版本
- `requestAddTileService`：API 33 以上
- `TileService` 本身：API 24 以上（LG V35 的 Android 10 可用）

### 4.3 讀剪貼簿的時機
Android 10 起，App 要「取得視窗焦點」後才讀得到剪貼簿；從通知列回來時焦點可能晚一點才到。
`TileWatcher` 在 App 進入 `active` 後讀取；若讀到空字串或失敗，每 200 ms 重試，最多 5 次（共約 1 秒）。

### 4.4 與現有剪貼簿監看的關係
- 磚啟動的處理走 `enqueue(text, true)`，會更新剪貼簿監看的狀態（`watch`），之後 App 回到前景時不會對同一個連結再提示一次
- 同一次前景期間，若磚流程已處理剪貼簿，現有的 `checkClipboard` 不重複處理

## 5. 錯誤處理
- 原生模組任何呼叫失敗都不讓 App 崩潰：JS 端 try/catch，失敗就「留在 Untail」
- `moveTaskToBack` 失敗：留在 Untail
- 清理逾時：沿用現有展開逾時（處理中會顯示現有的「處理中」狀態）

## 6. 隱私與政策
- 只在使用者點磚、Untail 已在前景時讀剪貼簿；沒有背景讀取
- 不新增權限。`BIND_QUICK_SETTINGS_TILE` 是系統綁定用的保護權限，不是向使用者要求的權限
- Data safety 表單不變（沒有新的資料類型）
- 隱私政策：在剪貼簿段落補一句「點『清理連結』磚時，Untail 會開啟並讀取剪貼簿中的連結」

## 7. 測試

### 7.1 單元測試（vitest）
- `decideTileOutcome` 的每一列（3.2 節表格，加上「點磚前已在前景」的變化）
- 剪貼簿讀取重試：第 N 次才拿到內容、全部失敗
- 移除項目計數與結果卡標題一致

### 7.2 實機測試
| 裝置 | 系統 |
|---|---|
| vivo V2514 | Android 16、OriginOS 6 |
| Xperia 1 V | Android 15 |
| Xperia 5 II | Android 12 |
| LG V35 | Android 10（之後 LineageOS 22.2／Android 15） |
| 模擬器 | Android 16（Medium_Phone_API_36.1） |

每台：加入磚、冷啟動與熱啟動各點一次、乾淨連結、含追蹤碼的連結、沒有連結、短網址（展開）、鎖定畫面點磚、原本就在 Untail 時點磚。記錄回到原 App 的時間與是否成功。

## 8. 不在範圍內
- iOS（另案：iOS 18 控制中心按鈕或捷徑 App）
- 方案 B（無畫面背景清理）
- 磚上顯示最近一次結果
