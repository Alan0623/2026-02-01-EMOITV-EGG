# Emotiv Cortex API — Python 範例集

本專案為 **Emotiv Cortex API** 的 Python 範例程式，示範如何透過 WebSocket 連接 Emotiv Cortex 服務，訂閱腦電波裝置的各類即時資料串流，並進行訓練、錄製與匯出等操作。

---

## 目錄

- [系統需求](#系統需求)
- [安裝與設定](#安裝與設定)
- [連線方式](#連線方式)
- [可讀取的資料串流](#可讀取的資料串流)
- [各腳本功能摘要](#各腳本功能摘要)
- [NeuroRest 儀表板](#neurorest-儀表板)
- [參考資源](#參考資源)

---

## 系統需求

- Python 3.7 以上
- [Emotiv Launcher](https://www.emotiv.com/emotiv-launcher/) 已安裝並執行中
- Emotiv 頭戴式裝置（如 EPOC X）已透過藍牙或 USB 接收器連接
- **Emotiv Cortex App 憑證**：需至 Emotiv 開發者後台申請 App。
    - **App Name**: `NeuroRest-v1.1`
    - **App ID**: `com.alan623.NeuroRest-v1.1`
    - **Client ID**: (請填入您的 Client ID)
    - **Client Secret**: (請填入您的 Client Secret)

---

## 安裝與設定

```bash
# 安裝相依套件
pip install -r requirements.txt
```

在每個腳本的 `main()` 函式中，填入您的憑證：

```python
your_app_client_id     = 'put_your_app_client_id_here'
your_app_client_secret = 'put_your_app_client_secret_here'
```

---

## 連線方式

所有腳本均透過 **WebSocket** 連接本機的 Emotiv Cortex 服務：

| 項目 | 說明 |
|------|------|
| **協定** | WebSocket（`wss://`） |
| **位址** | `wss://localhost:6868` |
| **前提** | Emotiv Launcher 必須在背景執行 |
| **認證流程** | `hasAccessRight` → `authorize` → `queryHeadsets` → `createSession` → `subscribe` |

### 連線流程說明

```
啟動腳本
  └─ 開啟 WebSocket 連線至 wss://localhost:6868
       └─ 檢查存取權限 (hasAccessRight)
            └─ 授權 (authorize) → 取得 cortexToken
                 └─ 查詢頭戴裝置 (queryHeadsets)
                      └─ 建立工作階段 (createSession)
                           └─ 訂閱資料串流 (subscribe)
                                └─ 即時接收資料
```

> **注意：** 首次使用時，Emotiv Launcher 會彈出授權視窗，需手動核准應用程式存取權限。

---

## 可讀取的資料串流

透過 Cortex API 可訂閱以下 8 種資料串流：

### 1. `eeg` — 腦電波（EEG）

即時腦電位訊號，單位為微伏（μV）。

| 欄位 | 說明 |
|------|------|
| `COUNTER` | 資料封包計數器 |
| `INTERPOLATED` | 是否為插值資料 |
| `AF3`, `T7`, `Pz`, `T8`, `AF4` | 各電極電位值（μV） |
| `RAW_CQ` | 原始接觸品質 |
| `MARKER_HARDWARE` | 硬體標記 |

範例資料：
```json
{"eeg": [99, 0, 4291.8, 4371.8, 4078.5, 4036.4, 4231.8, 0.0, 0], "time": 1627457774.52}
```

---

### 2. `mot` — 動作感測（Motion）

頭部姿態、加速度計與磁力計數值。

| 欄位 | 說明 |
|------|------|
| `COUNTER_MEMS`, `INTERPOLATED_MEMS` | 計數器與插值旗標 |
| `Q0`, `Q1`, `Q2`, `Q3` | 四元數姿態 |
| `ACCX`, `ACCY`, `ACCZ` | 加速度計（X/Y/Z 軸） |
| `MAGX`, `MAGY`, `MAGZ` | 磁力計（X/Y/Z 軸） |

範例資料：
```json
{"mot": [33, 0, 0.494, 0.406, 0.469, -0.609, 0.969, 0.188, -0.250, -76.56, -19.58, 38.28], "time": 1627457508.26}
```

---

### 3. `dev` — 裝置資訊（Device Info）

電極接觸品質（CQ）與電池狀態。

| 欄位 | 說明 |
|------|------|
| `signal` | 整體訊號品質（0.0 ~ 1.0） |
| `dev` | 各電極 CQ 值：`[AF3, T7, Pz, T8, AF4, OVERALL]`（0 ~ 4） |
| `batteryPercent` | 電池電量百分比 |

範例資料：
```json
{"signal": 1.0, "dev": [4, 4, 4, 4, 4, 100], "batteryPercent": 80, "time": 1627459265.45}
```

---

### 4. `met` — 效能指標（Performance Metrics）

即時認知狀態評估，每個指標包含「是否啟用」與「數值」（0.0 ~ 1.0）。

| 欄位 | 說明 |
|------|------|
| `eng` | 投入度（Engagement） |
| `exc` | 即時興奮度（Excitement） |
| `lex` | 長期興奮度（Long-term Excitement） |
| `str` | 壓力（Stress） |
| `rel` | 放鬆度（Relaxation） |
| `int` | 興趣度（Interest） |
| `foc` | 專注度（Focus） |

> **💡 數值計算與基準值 (Baseline) 知識：**
> - **獨立計算：** 這 6 項效能指標是獨立計算的，**相加並不等於 100%**。使用者完全可以在保持高專注度 (Focus) 的同時承受高壓力 (Stress)。
> - **動態基準線 (Dynamic Baseline)：** 這些 0.0 ~ 1.0 的數值並非絕對值或與他人比較，而是相對於**使用者個人的大腦基準線**。系統會在開始測量時進行動態校準，抓取使用者的平時狀態作為 0% 的判定標準。因此，75% 的專注度代表「相較於您個人的平時狀態，您現在的專注程度達到了您潛力範圍的 75%」。

範例資料：
```json
{"met": [true, 0.5, true, 0.5, 0.0, true, 0.5, true, 0.5, true, 0.5, true, 0.5], "time": 1627459390.42}
```

---

### 5. `pow` — 頻帶功率（Band Power）

各電極在不同頻帶的腦波功率，共 25 個數值（5 電極 × 5 頻帶）。

| 頻帶 | 頻率範圍 | 說明 |
|------|----------|------|
| `theta` | 4–8 Hz | 深度放鬆、創意 |
| `alpha` | 8–12 Hz | 放鬆、閉眼靜息 |
| `betaL` | 12–16 Hz | 低 Beta，輕度專注 |
| `betaH` | 16–25 Hz | 高 Beta，主動思考 |
| `gamma` | 25–45 Hz | 高度認知處理 |

欄位順序：`AF3/theta, AF3/alpha, AF3/betaL, AF3/betaH, AF3/gamma, T7/theta, ...`

範例資料：
```json
{"pow": [5.25, 4.69, 3.20, 1.19, 0.28, 0.64, 0.93, 0.83, 0.35, 0.34, ...], "time": 1627459390.17}
```

---

### 6. `com` — 心智指令（Mental Command）

偵測使用者的心智動作意圖（需先訓練個人檔案）。

| 欄位 | 說明 |
|------|------|
| `action` | 偵測到的動作（neutral / push / pull / lift / drop / left / right） |
| `power` | 信心強度（0.0 ~ 1.0） |

範例資料：
```json
{"action": "push", "power": 0.85, "time": 1647525819.02}
```

---

### 7. `fac` — 臉部表情（Facial Expression）

偵測眼部動作與上下臉部表情（需先訓練個人檔案）。

| 欄位 | 說明 |
|------|------|
| `eyeAct` | 眼部動作（neutral / blink / winkL / winkR / lookUp / lookDown） |
| `uAct` | 上臉部動作（neutral / surprise / frown） |
| `uPow` | 上臉部動作強度（0.0 ~ 1.0） |
| `lAct` | 下臉部動作（neutral / smile / clench / smirkLeft / smirkRight） |
| `lPow` | 下臉部動作強度（0.0 ~ 1.0） |

---

### 8. `sys` — 系統事件（System Events）

訓練過程中的系統層級事件通知。

| 事件 | 說明 |
|------|------|
| `MC_Succeeded` | 心智指令訓練成功 |
| `MC_Failed` | 心智指令訓練失敗 |
| `MC_Completed` | 心智指令訓練完成 |
| `FE_Succeeded` | 臉部表情訓練成功 |
| `FE_Completed` | 臉部表情訓練完成 |

---

## 資料串流訂閱需求

各串流所需的授權等級不同，訂閱前請確認您的 Emotiv 帳戶具備對應權限：

| 串流 | 分頁 | 所需授權 | 說明 |
|------|------|----------|------|
| `eeg` | 腦電波 EEG | ⚠️ **需要 EEG 授權** | 需在 Emotiv 開發者平台啟用 Raw EEG 存取（Professional EEG 訂閱）|
| `mot` | 動作感測 | ✅ 免費 | 所有帳戶均可使用 |
| `dev` | 裝置資訊 | ✅ 免費 | 所有帳戶均可使用 |
| `met` | 效能指標 | ✅ 免費 | 所有帳戶均可使用 |
| `pow` | 頻帶功率 | ✅ 免費 | 所有帳戶均可使用 |
| `com` | 心智指令 | ⚠️ **需要個人檔案訓練** | 需先以 `mental_command_train.py` 訓練並載入個人檔案 |
| `fac` | 臉部表情 | ⚠️ **需要個人檔案訓練** | 需先以 `facial_expression_train.py` 訓練並載入個人檔案 |
| `sys` | 系統事件 | ✅ 免費 | 所有帳戶均可使用 |

> **NeuroRest 儀表板說明：** 若某串流訂閱失敗，對應分頁將顯示 **「🔒 無訂閱」** 提示，其他已訂閱的分頁仍可正常顯示資料，互不影響。

---

## 各腳本功能摘要

| 腳本 | 功能說明 |
|------|----------|
| `cortex.py` | **核心模組**：封裝 Cortex WebSocket API，處理連線、授權、工作階段建立與資料訂閱，所有腳本均依賴此模組 |
| `sub_data.py` | **資料訂閱**：示範如何同時訂閱 `eeg`、`mot`、`dev`、`met`、`pow` 等多種串流並即時輸出 |
| `live_advance.py` | **即時心智指令**：載入已訓練的個人檔案，即時接收 `com` 串流，並示範查詢與設定心智指令靈敏度 |
| `mental_command_train.py` | **心智指令訓練**：自動化訓練流程，依序訓練指定動作（如 neutral / push / pull），訓練完成後儲存個人檔案 |
| `facial_expression_train.py` | **臉部表情訓練**：自動化訓練流程，依序訓練指定表情（如 neutral / surprise / smile），訓練完成後儲存個人檔案 |
| `record.py` | **資料錄製與匯出**：建立錄製工作階段，錄製指定時長後停止，並將資料匯出為 CSV 或 EDF 格式 |
| `marker.py` | **標記注入**：在錄製過程中定時注入事件標記（Marker），方便後續分析時對齊實驗事件，支援匯出含標記的資料 |
| `query_records.py` | **查詢與下載錄製檔**：查詢帳號下的所有錄製記錄，自動下載未同步至本機的檔案，並支援匯出為 CSV |

### 執行方式

```bash
# 訂閱即時資料
python sub_data.py

# 即時心智指令（需已有訓練檔案）
python live_advance.py

# 訓練心智指令
python mental_command_train.py

# 訓練臉部表情
python facial_expression_train.py

# 錄製資料
python record.py

# 注入標記並錄製
python marker.py

# 查詢錄製記錄
python query_records.py
```

---

## NeuroRest 儀表板

本專案附帶一個網頁儀表板，可即時視覺化所有 8 種資料串流。

### 執行
1. **建立 .env 設定檔**：
   在 `dashboard` 資料夾中建立 `.env` 檔案，內容如下：
   ```ini
   CLIENT_ID=your_client_id_here
   CLIENT_SECRET=your_client_secret_here
   ```

2. **啟動伺服器**：
   使用隨附的 `server.py` 啟動（此腳本會讀取 .env 並提供給網頁端）：
   ```bash
   cd dashboard
   python3 server.py
   ```

3. 開啟瀏覽器訪問 [http://127.0.0.1:8765](http://127.0.0.1:8765)
4. 點擊 **連線至 Emotiv Cortex**（憑證會自動填入）

### 功能特色

- 🧠 **腦電波 EEG**：各電極即時波形圖
- 📐 **動作感測**：四元數、加速度計、磁力計數值
- 📡 **裝置資訊**：電極接觸品質與電池狀態
- 🎯 **效能指標**：7 項認知狀態即時評估
- ⚡ **頻帶功率**：全電極平均 theta/alpha/beta/gamma 曲線圖（betaL + betaH 合併）
- 🧩 **心智指令**：即時動作偵測與信心強度
- 😊 **臉部表情**：眼部與上下臉部動作
- ⚙️ **系統事件**：訓練事件記錄

> 支援**模擬資料模式**（無需裝置即可預覽介面）

---

## 參考資源

- [Emotiv Cortex API 官方文件](https://emotiv.gitbook.io/cortex-api/)
- [建立 Cortex 應用程式](https://emotiv.gitbook.io/cortex-api#create-a-cortex-app)
- [Emotiv 開發者平台](https://www.emotiv.com/developer/)
