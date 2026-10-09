# orca-High-Sierra

讓 macOS 10.13 High Sierra 的機器也能使用 [Orca](https://github.com/stablyai/orca)。

Orca 本體（Electron 43、Node 24、Swift 6 原生工具）無法在 10.13 執行，因此這個專案不做完整移植，
而是做一個**精簡 client**：以 Electron 26.6.10（最後支援 10.13 的版本，Chromium 116）包一個殼，
連到跑在現代 Mac 上的 Remote Orca Server。專案、worktree、終端、agent 全在 server 端執行，
10.13 機器只負責顯示與輸入。

狀態（2026-10-09）：在 MacBook9,1 / 10.13.6 上對 Orca 1.4.223 完成配對、顯示完整 UI、遠端終端與中文輸入。

## 目錄

```
app/
  main.js             Electron 主行程：視窗、路徑隔離、log、剪貼簿 IPC
  preload.js          Chromium 116 缺的 ES2024 polyfill、write-only 剪貼簿 shim
  pair-link.js        把 orca://pair 連結 / browser URL / 裸 code 轉成 web client URL
  clipboard-policy.js 剪貼簿寫入的驗證規則
  prompt.html         首次啟動的貼連結頁
  offline.html        server 連不上時的重試 / 換 server 頁
  package.json        Electron 入口宣告
test/                 node:test 單元測試
build.sh              在現代 Mac 上下載 Electron 26、驗 checksum、組 OrcaHS.app、打 zip
```

## 建置（在現代 Mac 上）

```bash
./build.sh            # 產出 dist/OrcaHS.zip
```

## 安裝與執行（在 10.13 機器上）

app 所有寫入都在 `--base-dir` 之下，不碰其他路徑。

```bash
mkdir -p ~/Desktop/OrcaHS && cd ~/Desktop/OrcaHS && unzip OrcaHS.zip
open -na ~/Desktop/OrcaHS/OrcaHS.app --args --base-dir=$HOME/Desktop/OrcaHS/data
```

首次啟動出現貼連結頁，可貼：

- `orca://pair?code=…`（Settings → Remote Orca Servers → Pair another Orca client）
- `orca serve` 印出的 browser URL（`http://<server>:6768/#code=…`）
- 裸 pairing code
- 已配對過的 server URL（`http://<server>:6768/`）

四種輸入是同一份 payload，`app/pair-link.js` 負責轉換。`--url=` 參數與 `data/server-url.txt` 也接受同樣輸入。
server 頁載入後只把 origin 寫回 `server-url.txt`（mode 600）；pairing code 留在頁面的 localStorage，與上游 web client 行為相同。

## 除錯

加 `--hs-debug` 會在 `data/logs/` 多寫：啟動後 8/25/60 秒的視窗截圖、頁面能力探針（WebGL、polyfill、secure context）、
所有 console 訊息。不加時只記錄 warning 以上的 console 訊息與載入事件。
旗標名刻意不用 `--debug`，那個會被 Electron 當成 Node 旗標攔走。

## 連不上 server 時

主頁載入失敗（連線被拒、逾時、renderer 當掉）會切到殼自己的 `offline.html`：顯示錯誤碼、每 10 秒自動探測一次
server、可手動重試或回到貼連結頁。失敗的位址不會被記進 `server-url.txt`。
server 執行中斷線（WebSocket 掉線）由 Orca 自己的 UI 處理重連，殼不介入。

## 測試

```bash
node --test test/*.test.js
```

## 分支

- `master` — 穩定版。
- `develop` — 整合分支，feature / fix 分支以 `--no-ff` merge 進來。

## 公開 repo 前

- 不要 commit：`dist/`、`data/`、log、截圖、任何 pairing code 或 `server-url.txt`（`.gitignore` 已擋）。
- 文件與測試只用保留位址（`192.0.2.x`）與 `<server>` 佔位，不寫實際網段、機器名、路徑。
- 簽章是 ad-hoc（`codesign --sign -`），repo 內沒有 Apple ID、Team ID、憑證或 provisioning profile。
  將來若改用 Developer ID，身份只能從環境變數（如 `CSC_NAME`）帶入，不得寫進 repo。
- 推上去前跑一次 `gitleaks detect` 或同類工具掃整個歷史。

## 已知限制

- Electron 26 已停止維護，只在私網（LAN / VPN / SSH 隧道）使用。
- 純 `http://` 不是 secure context：Chromium 移除 `navigator.clipboard` 與 `crypto.subtle`。
  殼補一個 write-only 剪貼簿 shim，`writeText` 經 IPC 由主行程依 `app/clipboard-policy.js` 驗證
  （只限 client 視窗、main frame、精確 server origin、1 MiB、10 秒 20 次）。`readText`/`read`/`write` 拒絕，貼上用 Cmd+V。
- PDF 預覽預期失敗：`pdf.worker.min-*.mjs` 在 Worker 內執行，preload polyfill 進不去，而它用到 `Promise.withResolvers`。
- 10.13 機器上不安裝任何工具鏈；開發與打包都在現代 Mac 進行，只複製成品過去。
