# ESP32 健康監測系統 - 連接測試報告

## ✅ 測試結果

### 硬體連接狀態
- **串口設備**: `/dev/tty.usbserial-14110`
- **連接狀態**: ✅ **成功連接**
- **波特率**: 115200
- **串口可用性**: ✅ **可以正常開啟和關閉**

### 數據接收狀態
- **數據輸出**: ⚠️ **目前未收到任何數據**
- **可能原因**: ESP32 上可能沒有運行程式，或程式沒有輸出

---

## 📁 已建立的工具

### 1. 測試工具
- `quick_esp32_test.py` - 快速連接測試
- `check_esp32_data.py` - 10秒數據檢查
- `monitor_esp32.py` - 持續監聽 ESP32 輸出
- `esp32_repl.py` - 互動式 REPL 連接

### 2. 網頁介面
- `index.html` - 整合健康監測儀表板（已刪除，需重新創建）
- `test_server.py` - 測試伺服器（模擬數據）

### 3. ESP32 程式
- `integrated_health_monitor.py` - 整合健康監測主程式

---

## 🚀 下一步操作建議

### 選項 1: 檢查 ESP32 當前狀態
```bash
# 監聽 ESP32 輸出（按 Ctrl+C 停止）
python3 monitor_esp32.py
```

### 選項 2: 上傳程式到 ESP32

#### 方法 A: 使用 Thonny IDE（推薦）
1. 開啟 Thonny IDE
2. 選擇 Tools → Options → Interpreter
3. 選擇 "MicroPython (ESP32)"
4. 選擇串口: `/dev/tty.usbserial-14110`
5. 上傳 `integrated_health_monitor.py` 並重命名為 `main.py`

#### 方法 B: 使用命令列工具
```bash
# 安裝 ampy（如果尚未安裝）
pip3 install adafruit-ampy

# 上傳程式
ampy --port /dev/tty.usbserial-14110 put integrated_health_monitor.py /main.py

# 重啟 ESP32
ampy --port /dev/tty.usbserial-14110 reset
```

### 選項 3: 測試網頁介面（使用模擬數據）
```bash
# 啟動測試伺服器
python3 test_server.py

# 然後在瀏覽器開啟
# http://localhost:8080
```

---

## 📊 系統架構

```
┌─────────────────────────────────────────────────────────┐
│                    ESP32 硬體                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ MAX30102     │  │ ADC 呼吸     │  │ WiFi 模組    │  │
│  │ (心率/血氧)  │  │ 感測器       │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         integrated_health_monitor.py (MicroPython)      │
│                                                          │
│  API 端點:                                               │
│  • /spo2      - 血氧濃度                                 │
│  • /hr        - 心率                                     │
│  • /ppg       - 心電圖波形                               │
│  • /rsp_rate  - 呼吸速率                                 │
│  • /rsp       - 呼吸波形                                 │
│  • /all       - 所有資料 (JSON)                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              整合健康監測儀表板 (HTML)                   │
│                                                          │
│  • 即時顯示三大生理指標                                  │
│  • 波形圖表 (PPG + 呼吸)                                 │
│  • 現代化玻璃擬態設計                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 常見問題排解

### Q1: ESP32 連接成功但沒有數據輸出
**解決方案**:
1. 按 ESP32 的 RESET 按鈕
2. 檢查是否已上傳程式
3. 確認程式檔名為 `main.py`（自動執行）

### Q2: 串口被佔用 (Resource busy)
**解決方案**:
1. 關閉 Thonny、Arduino IDE 等工具
2. 執行: `ps aux | grep tty.usbserial` 找出佔用的程式
3. 拔掉 USB 重新插入

### Q3: 無法連接到 WiFi
**解決方案**:
1. 檢查 `integrated_health_monitor.py` 中的 WiFi 設定
2. 確認 SSID 和密碼正確
3. 檢查 WiFi 是否為 2.4GHz（ESP32 不支援 5GHz）

### Q4: 網頁無法顯示數據
**解決方案**:
1. 確認 ESP32 已連接到 WiFi
2. 檢查 ESP32 的 IP 位址
3. 在瀏覽器中訪問: `http://<ESP32_IP>/all`
4. 檢查瀏覽器控制台是否有錯誤訊息

---

## 📝 使用流程

### 完整部署流程

1. **上傳程式到 ESP32**
   ```bash
   # 使用 Thonny 或 ampy 上傳 integrated_health_monitor.py
   ```

2. **檢查 ESP32 輸出**
   ```bash
   python3 monitor_esp32.py
   # 應該會看到 WiFi 連接訊息和 IP 位址
   ```

3. **重新創建整合儀表板**
   - 需要重新創建 `integrated_health_dashboard.html`
   - 或使用測試伺服器進行測試

4. **訪問網頁介面**
   - 開啟瀏覽器訪問 ESP32 的 IP 位址
   - 點擊「開始監測」按鈕
   - 查看即時生理數據

---

## 📞 技術支援

如需進一步協助，請提供以下資訊：
1. `monitor_esp32.py` 的完整輸出
2. ESP32 型號和韌體版本
3. 錯誤訊息截圖

---

**建立時間**: 2026-01-25 19:43
**測試狀態**: ✅ 硬體連接正常，等待程式上傳
