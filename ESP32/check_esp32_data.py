#!/usr/bin/env python3
"""
ESP32 快速數據檢查
檢查 ESP32 在 10 秒內的輸出
"""

import serial
import time
from datetime import datetime

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200
TEST_DURATION = 10  # 秒

print("=" * 60)
print("🔍 ESP32 快速數據檢查 (10秒)")
print("=" * 60)

try:
    ser = serial.Serial(PORT, BAUDRATE, timeout=0.5)
    print(f"✅ 已連接到 {PORT}")
    print(f"⏱️  監聽 {TEST_DURATION} 秒...\n")
    
    ser.reset_input_buffer()
    
    start_time = time.time()
    lines = []
    
    while time.time() - start_time < TEST_DURATION:
        if ser.in_waiting > 0:
            try:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
                    print(f"[{timestamp}] {line}")
                    lines.append(line)
            except:
                pass
        time.sleep(0.05)
    
    ser.close()
    
    print("\n" + "=" * 60)
    print(f"📊 結果: 收到 {len(lines)} 行數據")
    
    if len(lines) == 0:
        print("\n⚠️  未收到任何數據")
        print("\n可能的情況:")
        print("  1. ESP32 上沒有運行程式")
        print("  2. 程式正在運行但沒有 print 輸出")
        print("  3. 程式已經運行完畢")
        print("  4. 波特率不匹配")
        print("\n建議:")
        print("  1. 按 ESP32 上的 RESET 按鈕重啟")
        print("  2. 使用 Thonny 或其他工具上傳程式")
        print("  3. 檢查程式是否設定為自動執行 (main.py)")
    else:
        print("\n✅ ESP32 正在輸出數據！")
        print("\n最近的幾行數據:")
        for line in lines[-5:]:
            print(f"  • {line}")
    
    print("=" * 60)

except serial.SerialException as e:
    print(f"❌ 錯誤: {e}")
except KeyboardInterrupt:
    print("\n⏹️  已中斷")
    if 'ser' in locals() and ser.is_open:
        ser.close()
