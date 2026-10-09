# orca-High-Sierra

讓 macOS 10.13 High Sierra 的機器也能使用 [Orca](https://github.com/stablyai/orca)。

Orca 本體（Electron 43、Node 24、Swift 6 原生工具）無法在 10.13 執行，因此這個專案不做完整移植，
而是做一個**精簡 client**：以 Electron 26（最後支援 10.13 的版本）包一個殼，連到跑在現代 Mac 上的
Remote Orca Server。專案、worktree、終端、agent 全在 server 端執行，10.13 機器只負責顯示與輸入。

## 目錄

- `apps/hs-client/` — 精簡 client 的原始碼與 build script（見該目錄 README）。

## 分支

- `master` — 穩定版。
- `develop` — 整合分支，功能分支以 `--no-ff` merge 進來。

## 限制

- Electron 26 已停止維護，只在私網（LAN / VPN / SSH 隧道）使用。
- 10.13 機器上不安裝任何工具鏈；開發與打包都在現代 Mac 進行，只把成品複製過去。
