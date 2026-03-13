# 整合健康監測系統 (Integrated Health Monitor)

本專案將 SpO2 血氧監測、心率監測與呼吸速率監測整合於單一 ESP32 系統中，並透過 Web Server 提供即時數據 API。

## 📋 專案功能

- **血氧濃度 (SpO2)**: 使用 MAX30102 感測器測量。
- **心率 (Heart Rate)**: 即時計算心率並提供 PPG 波形數據。
- **呼吸速率 (Respiratory Rate)**: 使用類比感測器 (ADC) 測量呼吸頻率與波形。
- **Web API**: 提供 RESTful API 獲取所有感測數據。

## 🛠 硬體需求

| 元件 | 數量 | 備註 |
|Data Source|Qty|Note|
|---|---|---|
| ESP32 開發板 | 1 | 核心控制器 |
| MAX30102 模組 | 1 | I2C 介面，用於血氧與心率 |
| 呼吸感測器 / 可變電阻 | 1 | 類比輸出，用於模擬或測量呼吸 |
| LED 指示燈 | 1 | 用於心跳指示 |
| 連接線 | 若干 | 杜邦線 |

## 🔌 接線指南 (Wiring Guide)

| ESP32 Pin | 連接元件 | 功能說明 |
|---|---|---|
| **GPIO 25** | MAX30102 SCL | I2C Clock |
| **GPIO 26** | MAX30102 SDA | I2C Data |
| **GPIO 36 (VP)** | 呼吸感測器 AO | 類比輸入 (ADC) |
| **GPIO 5** | LED 正極 | 心跳指示燈 (高電位觸發) |
| **3V3 / 5V** | VCC | 電源 |
| **GND** | GND | 接地 |

> ⚠️ **注意**: 請確認 MAX30102 的電壓需求 (通常為 3.3V 或 5V)，錯誤的電壓可能損壞模組。

## 📦 軟體依賴

本專案基於 MicroPython 開發，需安裝以下檔案至 ESP32：

1.  `integrated_health_monitor.py` (主程式)
2.  `max30102.py` (驅動程式)
3.  `pulse_oximeter.py` (演算法庫)
4.  `ESPWebServer.py` (Web Server 庫)

## 🚀 安裝與設定

1.  **燒錄 MicroPython**: 確保 ESP32 已燒錄 MicroPython 韌體。
2.  **上傳檔案**: 將所有 `.py` 檔案上傳至 ESP32 根目錄。
3.  **設定 Wi-Fi**:
    打開 `integrated_health_monitor.py`，找到以下段落並填入您的 Wi-Fi 資訊：
    ```python
    # integrated_health_monitor.py 約第 130 行
    sta.connect("您的SSID", "您的密碼")
    ```

## ▶️ 如何執行

您可以透過 REPL 或開機自動執行：

**方法 1: 透過 REPL 執行**
連線到 ESP32 後，輸入：
```python
import integrated_health_monitor
```

**方法 2: PC 端監控執行**
若有 `start_health_monitor.py`，可在電腦端執行該腳本以接收數據並監控輸出。

## 📡 API 參考文件

ESP32 連上網路後會顯示 IP 位址，您可以透過瀏覽器或程式呼叫以下 URL：

| 方法 | 端點 (Endpoint) | 描述 | 回傳範例 |
|---|---|---|---|
| GET | `/spo2` | 取得血氧濃度 (%) | `98` |
| GET | `/hr` | 取得心率 (bpm) | `72` |
| GET | `/ppg` | 取得 PPG 波形數值 | `1205` |
| GET | `/rsp_rate` | 取得呼吸速率 (次/分) | `16` |
| GET | `/rsp` | 取得呼吸波形數值 | `512` |
| GET | `/all` | 取得所有數據 (JSON) | `{"spo2": 98, "heart_rate": 72, ...}` |

## 💡 常見問題

- **數值為 0?**
    - 系統設有自動歸零機制，若 5 秒內無有效讀數 (如手指移開)，數值會重置為 0。
- **Wi-Fi 連不上?**
    - 請檢查 SSID 與密碼是否正確，並確認 ESP32 位於 Wi-Fi 訊號範圍內 (僅支援 2.4GHz)。

## 📁 檔案說明 (File Descriptions)

本專案包含以下重要檔案，依據執行位置分類：


### 🖥️ ESP32 端 (需上傳至開發板)

| 檔案名稱 | 用途說明 | 關聯性 |
|---|---|---|
| `integrated_health_monitor.py` | **[主程式]** 整合血氧、心率、呼吸監測與 Web Server | 匯入 `max30102`, `pulse_oximeter`, `ESPWebServer` |
| `max30102.py` | MAX30102 感測器硬體驅動程式 | 被 `integrated_health_monitor` 與 `pulse_oximeter` 匯入 |
| `pulse_oximeter.py` | 血氧與心率計算演算法庫 | 被 `integrated_health_monitor` 匯入 |
| `ESPWebServer.py` | 輕量級 Web Server 程式庫 | 被 `integrated_health_monitor` 匯入，負責提供 `index.html` |
| `index.html` | **[網頁介面]** 用戶端瀏覽器顯示的 HTML 頁面 | 被 `ESPWebServer` 讀取並傳送給瀏覽器 |

### 💻 PC 端 (電腦執行工具)

| 檔案名稱 | 用途說明 | 備註 |
|---|---|---|
| `start_health_monitor.py` | **[監控工具]** 連接 ESP32 串口，顯示即時數據並監聽 IP | 推薦使用，匯入 `serial` |
| `upload_to_esp32.py` | **[上傳工具]** 透過串口將檔案寫入 ESP32 (使用 ampy 或 raw REPL) | 輔助工具，匯入 `serial`, `ampy` |
| `check_esp32_repl.py` | **[診斷工具]** 檢查 ESP32 連線狀態與檔案列表 | 故障排除用，匯入 `serial` |
| `README.md` | 本說明文件 | 交接與參考 |

