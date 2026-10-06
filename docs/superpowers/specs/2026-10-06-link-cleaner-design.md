# 連結去追蹤 App — 設計文件

- 日期：2026-10-06
- 狀態：待審閱
- 工作名稱：**LinkClean**（暫定，上架前可改）

## 1. 目標與範圍

### 1.1 目標
一個上架 App Store / Google Play 的雙平台 App：用戶從任何 App 分享或貼上連結，App 移除追蹤碼（含展開短網址），並說明每個被移除的追蹤碼是什麼、有什麼風險，然後讓用戶複製或再分享乾淨連結。

定位：**對台灣用戶常用平台（FB、Threads、IG、蝦皮等）清理效果最好的去追蹤工具**。

### 1.2 MVP 功能
1. 從其他 App 分享連結進來 → 清理
2. App 內貼上連結 → 清理
3. 清理後複製 / 再分享 / 用瀏覽器開啟
4. 結果頁列出被移除的參數，附用途、所屬公司、風險等級，可點開看詳細說明
5. 本機歷史紀錄（可關閉、可清空）
6. 短網址在手機端展開（可在設定關閉）
7. 介面與追蹤碼說明支援 **繁體中文 / English / 日本語**（見 §6.4）

### 1.3 不在 MVP 範圍
- 付費 / Pro / RevenueCat（架構保留 `isPro` 開關，見 §8）
- Android `PROCESS_TEXT`（選取文字選單），列為 Android 第二版
- 統計儀表板、自訂規則、批次清理

### 1.4 原則
- **不使用任何第三方分析 / 廣告 / 崩潰回報 SDK**
- 不設後端伺服器；只會連到兩個地方：(a) GitHub Pages 拉規則包 (b) 展開白名單內的短網址網域
- App 只說明參數用途，**不嘗試反查分享者身分**
- 無法完全清理時要明確告知，**不可回傳看似乾淨、實際仍帶分享者 ID 的網址**

## 2. 技術選型

| 項目 | 選擇 |
|---|---|
| App | Expo（開專案時的最新穩定 SDK）+ Expo Router + TypeScript |
| 接收分享 | `expo-share-intent`（Android intent filter、iOS Share Extension 透過 config plugin） |
| 歷史紀錄 | `expo-sqlite` |
| 剪貼簿 / 分享 | `expo-clipboard`、RN `Share` |
| 規則快取 | `expo-file-system` |
| 多語系 | `expo-localization` + `i18next` |
| Monorepo | pnpm workspaces |
| 測試 | Vitest（core 與規則建置）|
| 規則發佈 | GitHub Actions → GitHub Pages |
| 建置上架 | EAS Build / EAS Submit |

> 風險：`expo-share-intent` 要搭配目前的 Expo SDK 版本。實作第一步就先在實機上驗證 iOS Share Extension 能不能用；如果不行，改成自己寫 config plugin。

## 3. 專案結構

```
trackurlapp/
├── packages/core/          # Pure TS cleaning engine, zero RN deps
│   └── src/{extract,unwrap,expand,clean,analyze,process,types}.ts
├── apps/mobile/            # Expo app (iOS + Android)
├── rules/
│   ├── overrides.json      # Extra ClearURLs-format providers / rules (merged)
│   ├── knowledge.json      # Param explanations (zh-TW / en / ja)
│   ├── expanders.json      # Per-site expander config
│   ├── regression.json     # Real links + expected output (live tests)
│   ├── fixtures/           # Recorded redirect chains (offline tests)
│   └── src/                # build / merge / bundle / CLI / live check scripts
├── .github/workflows/rules.yml
└── docs/
```

## 4. 核心引擎（packages/core）

### 4.1 對外介面

```ts
type FetchFn = (url: string, init: { method: 'HEAD' | 'GET'; headers: Record<string, string>; signal: AbortSignal })
  => Promise<{ url: string; status: number; text?: () => Promise<string> }>;

function processUrl(
  input: string,
  rules: RuleBundle,
  opts: { expand: boolean; locale: string; fetch?: FetchFn; userAgent?: string; timeoutMs?: number },
): Promise<ProcessResult>;

interface ProcessResult {
  originalUrl: string;
  cleanUrl: string;
  status: 'clean' | 'partial' | 'failed';
  reason?: 'expand_disabled' | 'expand_timeout' | 'unresolved' | 'network' | 'invalid_input';
  removed: AnalyzedParam[];   // every removed param / path segment (rawRules hits use key "raw"), with explanation
  hops: string[];             // redirect chain, for display
}

interface AnalyzedParam {
  key: string;                // e.g. "xmt", or "share-id" for path-based IDs
  value: string;
  owner?: string;             // e.g. "Meta"
  category: 'sharer_id' | 'ad_click' | 'affiliate' | 'campaign' | 'session' | 'unknown';
  risk: 'high' | 'medium' | 'low';
  desc?: string;              // resolved for current locale (fallback: en)
}
```

### 4.2 處理流程

```
input text
  → extract   取出文字裡第一個 http(s) 網址（分享內容常帶標題）；找不到 → failed/invalid_input
  → unwrap    拆外連包裝（l.facebook.com/l.php?u=、google.com/url?q= 等，用 provider 的 `redirections`）
  → expand    只有網域在 bundle 的「展開白名單」內才會連網（見 4.3）
  → unwrap    展開後可能又是包裝網址，再拆一次
  → clean     套用合併後的 providers（rules / referralMarketing / rawRules / exceptions），刪 query 參數
  → analyze   每個被刪的項目對照 knowledge.json，未知的標成 category=unknown, risk=low
  → result
```

### 4.3 短網址展開（expand）

- **只展開白名單網域**（`expanders.json`；通用短網址 bit.ly、t.co、lnkd.in、amzn.to、shp.ee、fb.me 等也是其中一個 expander）。其他網址一律不連網，避免把用戶的連結送到任意網站。
- **白名單只約束第一個請求**：之後的跳轉由短網址服務決定，平台的 fetch 會自動跟隨（RN 的 fetch 無法逐跳控制），等同用戶自己點開連結會經過的網址；App 先送 `HEAD`；只有伺服器回 405（不支援 HEAD）時才改送 `GET`，此時會下載頁面內容但不解析、不執行。隱私政策要照這個範圍寫。
- 展開後若仍是另一個 expander 的網址（例如 `fb.me` → FB `/share/`）就繼續展開，最多 3 次；超過仍未解開 → `partial / unresolved`。外連包裝最多拆 3 層，超過同樣回報 `unresolved`。
- 固定 UA：`LinkClean/<version>`，兩個平台都明確設定。**不可用瀏覽器 UA**（spike 證實 FB 對瀏覽器 UA 不會 302）。
- 方法：先送 `HEAD`，由平台的 fetch 自動跟著跳轉，取最終 `response.url`；如果回應是 405，改用 `GET`。
- 總逾時 5 秒（跳轉次數由平台 fetch 的上限控制）。
- core 不使用 `URL` / `URLSearchParams`（RN 實作不完整，且重新序列化會改變其他參數編碼），一律手動切 query 字串，保留的參數原樣不動。
- 站點專用設定由 `expanders.json` 提供，不寫死在程式碼裡。**展開器只負責展開，刪參數一律交給 providers**（`overrides.json` 補上 Threads 的 `xmt`/`slof`、FB 的 `rdid`/`share_url` 等）：

```json
{
  "facebook": {
    "match": "^https://(www|m)\\.facebook\\.com/share/",
    "loginWall": { "match": "^https://(www|m)\\.facebook\\.com/login", "param": "next" },
    "normalizeHost": { "m.facebook.com": "www.facebook.com" },
    "shareId": "/share/(?:[a-z]/)?([^/?#]+)"
  },
  "threads": {
    "match": "^https://www\\.threads\\.(com|net)/share/",
    "shareId": "/share/([^/?#]+)"
  },
  "generic": {
    "match": "^https?://(bit\\.ly|t\\.co|lnkd\\.in|amzn\\.to|shp\\.ee|fb\\.me)/"
  }
}
```

- 結果判定：
  - 最終網址仍符合 `match`（仍是 `/share/`）或停在登入頁但解析不出 `next` → `partial / unresolved`
  - 逾時 / 網路錯誤 → `partial / expand_timeout` 或 `network`
  - 用戶關閉展開，但網址符合白名單 → `partial / expand_disabled`
  - `partial` 時 `cleanUrl` 仍會清掉看得到的參數，但 UI 必須顯示警告（§6.3）

### 4.4 Spike 依據（2026-10-06，從 Mac 網路實測，單一樣本）

| 平台 | 結果 |
|---|---|
| Threads `/share/<id>/` | 任何 UA 都一次 302 → `/@user/post/<id>?xmt=…&slof=1`；清理後網址直接 200 |
| FB `/share/p/<id>/` | 瀏覽器 UA：200 不跳轉（原始網址只在 `og:url`）；CFNetwork / curl UA：一次 302 → `/groups/…/permalink/<id>/?rdid=…&share_url=…`；okhttp UA：→ `m.facebook.com` → permalink → `login.php?next=…` |

`og:url` 的 HTML 解析備案**不放進 MVP**，等 FB 行為變了再加（由 §7 的 live 測試偵測）。

## 5. 規則包（rules/ + GitHub Actions）

### 5.1 發佈檔案（GitHub Pages）

- `rules.meta.json`：`{ schemaVersion, version, sha256, generatedAt }`
- `rules.json`：

```ts
interface RuleBundle {
  schemaVersion: 1;
  version: string;              // e.g. "2026.10.06.1"
  providers: Record<string, Provider>;   // ClearURLs providers merged with overrides.json
  expanders: Record<string, Expander>;
  knowledge: Record<string, KnowledgeEntry>;
}

interface KnowledgeEntry {
  owner?: string;
  category: AnalyzedParam['category'];
  risk: AnalyzedParam['risk'];
  desc: { 'zh-TW'?: string; en?: string; ja?: string };
}
```

### 5.2 CI 流程（`rules.yml`）

觸發：每天排程 + push 到 `rules/` 或 `packages/core/`。

1. 下載 ClearURLs 官方 `data.min.json`
2. 合併 → 產出 `rules.json`
3. **離線測試**（決定是否發佈）：`packages/core` 單元測試，以及用 `fixtures/` 錄好的跳轉鏈跑回歸測試，不連網，結果固定
4. 通過 → 計算 sha256、發佈到 GitHub Pages
5. **翻譯檢查**（不影響發佈）：列出 `knowledge.json` 缺 `zh-TW` / `en` / `ja` 翻譯的條目，輸出成 workflow 警告
6. **線上測試**（不影響發佈）：用 `regression.json` 的真實連結實際連網跑一次。失敗就讓 workflow 標紅，GitHub 寄通知信 → 代表 Meta 等平台改了行為，需要人工處理

> 注意：`regression.json` 放在公開 repo。裡面的分享連結帶有分享者 ID，**只能放可以公開的連結**（例如專門建來測試的帳號分享出來的連結）。

### 5.3 App 端更新

- App 內打包一份 `rules.json` 當離線備援
- 啟動或回到前景時，距上次檢查超過 24 小時才檢查：拉 `rules.meta.json` → `sha256` 與目前快取不同 → 拉 `rules.json` → 驗證 sha256 → 寫入快取並替換（`version` 只用於顯示，不用來比大小）
- `schemaVersion` 大於 App 支援的版本 → 忽略，繼續用舊規則
- 任何失敗都不打擾用戶，靜默沿用現有規則
- 設定頁顯示目前規則版本，提供「立即更新」按鈕

### 5.4 授權
ClearURLs 規則為 **LGPL-3.0**。repo 與 App 的「開源授權」頁都要標示來源與授權條款。上架前再確認一次授權義務（此處不構成法律意見）。

## 6. App（apps/mobile）

### 6.1 畫面

| 畫面 | 內容 |
|---|---|
| 首頁 | 輸入框 + 貼上按鈕（iOS 用系統 PasteButton 避免跳出貼上提示）+ 清理結果卡片 |
| 結果卡片 | 乾淨網址、`複製` / `分享` / `開啟`；「移除了 N 個追蹤碼」清單，每項顯示風險標籤，點開 bottom sheet 看說明；可展開檢視跳轉鏈 |
| 歷史 | 清單（時間、乾淨網址、移除數量），點進去看結果卡片；左滑刪除；全部清空 |
| 設定 | 展開短網址（預設開）、自動複製（預設開）、歷史紀錄（預設開）、規則版本 + 立即更新、隱私政策、開源授權 |

### 6.2 分享進來的流程
其他 App 分享 → 開啟 LinkClean → 自動處理 → 顯示結果卡片；開啟「自動複製」時直接把乾淨網址複製到剪貼簿，並顯示 toast「已複製乾淨連結」。

### 6.3 狀態呈現
- `clean`：綠色「已清理」
- `partial`：黃色警告，依 `reason` 顯示原因，例如「無法展開 Facebook 分享連結，網址中仍可能含有分享者資訊」；**`partial` 時不自動複製**，需要用戶手動按
- `failed`：「找不到有效網址」

### 6.4 多語系
- 支援 `zh-TW`、`en`、`ja`，跟隨系統語言；不支援的語言用 `en`。所有中文系統（含 zh-CN、zh-HK）MVP 一律顯示繁體中文
- App 內不做語言切換；`app.json` 宣告支援的 locales，讓 iOS 與 Android 13+ 可以在系統設定裡針對單一 App 切換語言
- UI 字串：`apps/mobile/src/i18n/{zh-TW,en,ja}.json`
- 知識庫說明 fallback：目前語言 → `en` → 只顯示參數名稱與分類
- `core` 不處理語言：`analyze` 接收 `locale` 參數，回傳解析後的 `desc`

### 6.5 歷史紀錄（SQLite）

```sql
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  original_url TEXT NOT NULL,
  clean_url TEXT NOT NULL,
  status TEXT NOT NULL,
  removed_json TEXT NOT NULL
);
```

只保留最近 200 筆，超過就刪掉最舊的。關閉歷史紀錄時不再寫入，已存在的紀錄保留，直到用戶清空。

## 7. 測試

| 層級 | 內容 |
|---|---|
| core 單元測試（Vitest） | extract / unwrap / clean / analyze 各自的測試案例；expand 用假的 `fetch` 模擬 302、登入牆、逾時、405 |
| 規則回歸（離線） | `fixtures/` 錄製的真實跳轉鏈 → 預期乾淨網址，CI 擋發佈 |
| 規則回歸（線上） | `regression.json` 真實連結，每天跑，失敗只通知 |
| App | 不寫 UI 自動化測試；改用實機手動檢查清單：iOS / Android 分享進來、貼上、複製、再分享、歷史、規則更新、關閉展開 |

上架前需在**實機 + 行動網路**重驗 FB / Threads 展開（spike 只在 Mac 家用網路測過）。

## 8. 未來擴充預留
- `isPro` 開關（目前固定 false），之後接 RevenueCat 一次性買斷
- Android `PROCESS_TEXT`
- FB `og:url` HTML 解析備案
- 統計儀表板、自訂規則、更多語系

## 9. 上架準備
- 商店頁面（名稱、描述、截圖）準備 zh-TW / en / ja 三種語言
- 隱私政策：放在 GitHub Pages，提供三種語言，說明「不收集資料；只會連到規則更新網址與短網址服務；歷史紀錄只存本機」
- App Store 隱私標籤：Data Not Collected
- Google Play：新個人開發者帳號需要先做封閉測試（12 名測試者 / 14 天，申請前到 Play Console 確認最新門檻），要提早開始找人
- 費用：Apple USD 99/年，Google USD 25 一次性
