# 快速設定磚「清理連結」— 設計文件

- 日期：2026-10-19（同日依 codex／agy 設計審查修訂為第 2 版）
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
- Android 10 起，只有「取得視窗焦點的前景 App」與預設輸入法能讀剪貼簿；背景監聽剪貼簿不可行
- 無障礙服務用於非輔助用途違反 Google Play 政策，不用
- vivo OriginOS 6 沒有 Android 原廠的剪貼簿預覽（實測：複製時只有 Gboard 的剪貼簿建議事件，SystemUI 沒有事件），所以「預覽上的分享按鈕」在使用者的主力機上不可用
- iOS 沒有快速設定磚：本設計不含 iOS

### 1.3 成功標準
1. vivo（Android 16、OriginOS 6）：複製含追蹤碼的連結後點磚，App 已在記憶體中時約 2 秒內回到原本的 App，剪貼簿已是乾淨連結
2. 第 7.2 節所有裝置都實測過；不行的地方明確記錄
3. 不新增任何需要使用者同意的權限；不在背景讀剪貼簿

## 2. 做法：點磚就打開 Untail，沿用現有清理流程（方案 A）

點磚會把 Untail 帶到前景（取得視窗焦點後才能讀剪貼簿），用現有的清理流程處理，成功後退回原本的 App。

不採用的做法：
- B：透明畫面讀剪貼簿＋背景 JS 任務清理。完全看不到 Untail 畫面，但原生程式碼多、背景任務在各廠商系統上行為不一。若 A 的畫面閃動被認為太干擾，再升級成 B，磚可沿用
- C：用 Kotlin 重寫清理邏輯。規則要維護兩份，不做

已知代價：點磚時會看到 Untail 畫面短暫出現；App 不在記憶體中時要冷啟動（約 1～2 秒）。

## 3. 使用者行為

### 3.1 磚
- 名稱：清理連結／Clean link／リンクをクリーン（依系統語言）
- 圖示：Untail 單色壁虎，24dp 向量圖（由 `assets/monochrome.png` 的造型重畫）
- 外觀永遠是「未啟用」（這是動作，不是開關）
- 鎖定畫面時點磚：先要求解鎖，解鎖後才執行
- 處理中又點一次磚：視為同一個請求，不重複處理

### 3.2 點磚後的結果

前提：「本來在其他 App」＝點磚時 Untail 不在前景（由原生端判斷，見 4.3）。

| # | 剪貼簿內容／處理結果 | Untail 自己的提示（Toast） | 本來在其他 App | 本來就在 Untail |
|---|---|---|---|---|
| 1 | 清理後網址有改變（移除追蹤碼、隱藏字元，或短網址展開），且已成功複製 | 有移除項目：「已複製乾淨連結（移除 N 項）」；N＝0（只展開）：「已展開並複製連結」 | 退回原本的 App | 留在首頁，顯示結果卡 |
| 2 | 本來就乾淨（本機檢查就能確定，不需展開） | 「沒有找到追蹤碼」 | 退回原本的 App；**不寫剪貼簿、不寫歷史** | 留在首頁 |
| 3 | 剪貼簿沒有連結（空的、圖片、純文字） | 無 | 留在首頁，顯示「剪貼簿裡沒有連結」 | 同左 |
| 4 | 讀不到剪貼簿（等不到視窗焦點，或系統拒絕） | 無 | 留在首頁，顯示「讀不到剪貼簿，請再點一次磚或手動貼上」 | 同左 |
| 5 | 清理後網址有改變，但複製失敗 | 無 | 留在首頁，顯示結果卡（可手動複製） | 同左 |
| 6 | 只完成一部分（partial）或無法處理（failed） | 無 | 留在首頁，顯示結果卡與原因（現有 UI） | 同左 |
| 7 | 處理途中使用者離開 Untail、或開始別的操作（見 4.6） | 無 | 不退回、不提示、不寫剪貼簿；結果留在首頁，下次打開可看到 | 同左 |

- 點磚＝使用者明確要求清理：不看「偵測剪貼簿」「自動處理剪貼簿連結」兩個設定，一律執行
- 留在 Untail 時一律回到首頁（關掉設定、歷史、舊結果等頁面），讓結果或說明一定看得到
- 純文字（第 3 列）不放進首頁輸入框，避免顯示剪貼簿裡的私人文字
- 歷史紀錄：第 1、5、6 列照現有「歷史紀錄」設定；第 2、3、4、7 列不寫
- 「N 項」：結果中被移除的項目數（追蹤參數＋隱藏字元種類），與結果卡標題用同一個計數
- 上表只列 Untail 自己的提示；Android 系統另外會顯示的提示見 3.4

### 3.3 讓使用者加入磚
- 設定頁新增一列「加入快速設定」，下方固定顯示文字說明「拉下通知列 → 編輯 → 把『清理連結』拖進去」
- Android 13 以上點這列：呼叫系統的「加入磚」對話框；結果：
  - 已加入／原本就有：顯示「已加入」
  - 使用者取消，或對話框被返回鍵關掉：不顯示任何東西
  - 系統回報錯誤，或廠商系統不支援：不顯示錯誤，使用者看下方文字說明
- Android 12 以下：這列只顯示文字說明
- 首頁「三種用法」說明中，Android 加上第四種：快速設定磚

### 3.4 系統提示（Android 本身的行為，不是 Untail 的）
- Android 12 以上：讀剪貼簿時，系統會顯示「Untail 已貼上剪貼簿內容」
- Android 13 以上（原廠系統）：寫入剪貼簿後，系統可能在左下角顯示剪貼簿預覽（vivo OriginOS 6 實測沒有）
- 系統提示和 Untail 的提示會排隊，Untail 的提示可能晚 2～3 秒才出現
- Untail 的提示一律用短時間（LENGTH_SHORT）
- 實測時記錄每台裝置實際看到的提示

## 4. 架構

### 4.1 元件

```
[CleanLinkTileService (Kotlin)]
   onClick：讀「Untail 是否在前景」→ 以 intent 啟動 MainActivity（帶 extra）
        │
        ▼
[MainActivity, singleTask] ──onCreate／onNewIntent──▶ [TileLaunchStore (Kotlin，行程內單例)]
                                                           │ 存一筆待處理請求（覆蓋，不累加）
                                                           │ 送出 onTileLaunch 事件（只是通知）
                                                           ▼
[AppProvider（JS）] 啟動時與收到事件時呼叫 consumeTileLaunch()（原子取出並清空）
   └─ cleanFromTile()：等視窗焦點 → 讀剪貼簿 → 本機檢查 → 清理 → 決定結果（decideTileOutcome）
        → Toast ＋ moveTaskToBack(true)，或回首頁顯示結果
```

| 元件 | 位置 | 職責 |
|---|---|---|
| `CleanLinkTileService` | `apps/mobile/modules/untail-tile/android/` | 磚；見 4.2 |
| `ForegroundTracker` | 同上 | 用 `ActivityLifecycleCallbacks` 記錄 MainActivity 是否處於 started 狀態（onStart 之後、onStop 之前）；透過 Expo `ApplicationLifecycleListener` 註冊 |
| `TileLaunchActivityListener` | 同上 | Expo `ReactActivityLifecycleListener`：在 Activity `onCreate`、`onNewIntent` 讀取 extra，存入 `TileLaunchStore`，並從新 intent 與 `activity.intent` 兩者都移除 extra（避免畫面重建時再觸發） |
| `TileLaunchStore` | 同上 | 行程內單例，最多存一筆 `{ wasInForeground: Boolean }`；`consume()` 原子取出並清空 |
| `UntailTileModule` | 同上 | Expo 原生模組，提供給 JS：`consumeTileLaunch()`、事件 `onTileLaunch`、`waitForWindowFocus(timeoutMs)`、`moveTaskToBack()`、`requestAddTile()` |
| 模組內 `AndroidManifest.xml` | 同上 | 宣告 service（見 4.2） |
| 字串資源 | 模組 `res/values`、`values-b+zh+Hant`、`values-zh-rTW`、`values-ja` | 磚名稱（專案語系設定是 `zh-Hant`，release 版會依此過濾資源，所以一定要有 `b+zh+Hant`） |
| `modules/untail-tile/index.ts` | JS 介面 | Android 以外平台：全部回傳「不支援」或 no-op |
| `cleanFromTile` | `apps/mobile/src/state/AppContext.tsx` | 協調整個流程，與現有剪貼簿監看共用狀態（見 4.5） |
| `decideTileOutcome` | `apps/mobile/src/lib/tileOutcome.ts` | 純函式：輸入（讀取結果、本機檢查、清理結果、是否複製成功、wasInForeground、請求是否仍有效），輸出 3.2 表格的列號與動作 |

### 4.2 磚與啟動 MainActivity
- service 宣告：`android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"`、`exported=true`、intent filter `android.service.quicksettings.action.QS_TILE`、meta-data `android.service.quicksettings.TOGGLEABLE_TILE=false`、icon、label
- `onStartListening()`：把磚設為 `STATE_INACTIVE` 並 `updateTile()`
- `onClick()`：
  1. 讀 `ForegroundTracker.isStarted`（行程不存在時為 false），放進 extra `untail_tile_was_foreground`；另帶 `untail_tile_launch=true`
  2. intent：明確指定 MainActivity，flag `FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_SINGLE_TOP`；MainActivity 維持現有的 `launchMode="singleTask"`（`android/app/src/main/AndroidManifest.xml`，由 Expo 產生）
  3. API 34 以上：`PendingIntent.getActivity(context = 這個 service, requestCode = 0, intent = 第 2 步的 intent, flags = FLAG_IMMUTABLE | FLAG_UPDATE_CURRENT, options = ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle())`，再呼叫 `startActivityAndCollapse(pendingIntent)`；API 33 以下：`startActivityAndCollapse(intent)`
  4. 若 `isLocked`：把第 1～3 步放進 `unlockAndRun { }` 的回呼裡，解鎖後才執行
  5. 整個 onClick 包 try/catch；失敗只寫 log，不讓服務崩潰

### 4.3 「本來在其他 App」怎麼判斷
- 判斷點在磚的 `onClick()`，不在 JS：拉下通知列不一定會讓 Activity 暫停，JS 的 `AppState` 分辨不出來
- `ForegroundTracker.isStarted == true` → 本來就在 Untail（被通知列蓋住，但沒有停止）
- 行程不存在、或 Activity 已停止 → 本來在其他 App
- 不確定時（例如取不到值）一律當作「本來就在 Untail」，也就是留下不退回

### 4.4 讀剪貼簿的時機
- `waitForWindowFocus(1500)`：原生端若 `hasWindowFocus()` 已是 true 就立即回傳；否則監聽視窗焦點變化，最多等 1.5 秒
- 取得焦點後立刻讀一次；讀到空字串時 100 ms 後再讀一次，仍是空的就視為「剪貼簿沒有連結」（第 3 列）
- 等不到焦點：第 4 列

### 4.5 與現有剪貼簿監看、分享流程的協調
- `AppProvider` 啟動時與每次回到 `active` 時，**先**呼叫 `consumeTileLaunch()`；有磚請求就走 `cleanFromTile`，本次不執行現有的 `checkClipboard`
- `cleanFromTile` 開始時清掉 `clipboardOffer`、`autoCleaned`、`cleanClipboardLink`
- 不論結果如何，都用讀到的剪貼簿內容更新剪貼簿監看狀態（`watch`），之後回到前景不會對同一個內容再提示
- 本機檢查用與 `decideText` 相同的判斷（`extractUrlDetailed`、`needsCleaning`、會被移除的隱藏字元），但**不套用「已看過這段文字」的過濾**：使用者點磚就是要處理，即使 App 先前已經偵測過同一段內容。沒有連結→第 3 列；本機就能確定乾淨→第 2 列（不呼叫 `enqueue`，不寫剪貼簿、不寫歷史）；其餘才清理
- 剪貼簿裡是 Untail 先前寫入的乾淨連結時，本機檢查會判定為乾淨，走第 2 列
- 清理用新增的「磚專用」複製規則：只有在 `status === 'clean'` 且清理後網址與原網址不同時才複製
- 分享與磚同時發生（極少見）：先到先處理；後到的照常排進現有佇列，但只有最後一個磚請求可以觸發退回

### 4.6 請求的有效期間
每個磚請求有一個編號。以下情況發生時，該請求失效：
- 使用者離開 Untail（App 進入 background）
- 收到新的分享、使用者手動送出連結、或又點了一次磚（新請求取代舊的）
- 使用者在 Untail 裡操作（例如在輸入框打字、切換頁面）

失效的請求：不寫剪貼簿、不顯示提示、不退回；結果仍顯示在首頁。
寫剪貼簿、顯示提示、退回前，各再檢查一次請求是否仍有效。

## 5. 錯誤處理
- 原生端：磚的 `onClick`、`unlockAndRun` 回呼、模組每個函式都在 Kotlin 內 try/catch
- JS 端：原生呼叫失敗一律走「留在 Untail」
- `moveTaskToBack(true)` 回傳 false 或失敗：留在 Untail
- `requestAddTile()`：系統回呼 → 對應結果；返回鍵關掉對話框時系統不會回呼，因此在 MainActivity 重新取得視窗焦點時（或 30 秒後）以「取消」結束，Promise 不會永遠掛著
- 清理逾時：沿用現有展開逾時

## 6. 隱私與政策
- 只在使用者點磚、Untail 已在前景並取得焦點後讀剪貼簿；沒有背景讀取
- 不新增權限。`BIND_QUICK_SETTINGS_TILE` 是系統綁定用的保護權限，不是向使用者要求的權限
- 隱私政策剪貼簿段落補充：
  - 點「清理連結」磚時，Untail 會開啟並讀取剪貼簿中的連結，即使「偵測剪貼簿」設定是關閉的
  - 若連結是短網址且「展開短網址」是開啟的，會連線到短網址服務（與目前的展開行為相同）
  - 清理成功時會用乾淨連結取代剪貼簿內容；是否寫入歷史紀錄依設定
- Data safety：目前已申報「網頁瀏覽紀錄（短網址展開），選填、不分享」。磚沒有新的資料類型或用途：剪貼簿內容只在手機上處理、不傳出（短網址展開除外，已申報）。實作完成後再對照一次表單，確認不需變更

## 7. 測試

### 7.1 單元測試（vitest）
- `decideTileOutcome`：3.2 表格每一列 × wasInForeground 兩種 × 請求有效／失效
- 「磚專用」複製規則：網址未改變不複製、改變才複製、複製失敗
- `cleanFromTile` 協調：有磚請求時不跑 `checkClipboard`；`watch` 一定更新；純文字不進輸入框；本來乾淨時不寫歷史
- 請求失效：離開、新分享、新磚、使用者操作
- `requestAddTile` 結果對應

### 7.2 實機與模擬器
| 裝置 | 系統 |
|---|---|
| vivo V2514 | Android 16、OriginOS 6 |
| Xperia 1 V | Android 15 |
| Xperia 5 II | Android 12 |
| LG V35 | Android 10（之後 LineageOS 22.2／Android 15） |
| 模擬器 | Android 13（API 33）、Android 14（API 34）、Android 16（API 36） |

每台都測：
- 加入磚（含 13 以上的系統對話框，以及按返回鍵關掉）
- 冷啟動、熱啟動各點一次
- 3.2 表格第 1～6 列各一次（含短網址展開）
- 鎖定畫面點磚
- 本來就在 Untail（首頁、設定頁、歷史頁）時點磚
- 處理中離開 Untail；處理中再點一次磚；連點兩下
- 退回的目的地是否為原本的 App（不是桌面）——**這是驗收條件**
- 記錄實際看到的系統提示（3.4）
- release 版確認磚名稱在繁中、英、日系統下都正確

## 8. 不在範圍內
- iOS（另案：iOS 18 控制中心按鈕或捷徑 App）
- 方案 B（無畫面背景清理）
- 磚上顯示最近一次結果
