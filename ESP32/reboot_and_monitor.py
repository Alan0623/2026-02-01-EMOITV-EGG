#!/usr/bin/env python3
"""
重啟 ESP32 並監聽輸出
"""

import serial
import time
import sys
from datetime import datetime

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

print("=" * 70)
print("🔄 重啟 ESP32 並監聽輸出")
print("=" * 70)

try:
    ser = serial.Serial(PORT, BAUDRATE, timeout=1)
    time.sleep(0.5)
    
    print("發送軟重啟命令 (Ctrl+D)...")
    ser.write(b'\x04')
    
    print("\n" + "=" * 70)
    print("📡 ESP32 輸出:")
    print("=" * 70)
    print("按 Ctrl+C 停止監聽\n")
    
    start_time = time.time()
    line_count = 0
    
    while True:
        if ser.in_waiting > 0:
            try:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    timestamp = datetime.now().strftime('%H:%M:%S')
                    print(f"[{timestamp}] {line}")
                    sys.stdout.flush()
                    line_count += 1
                    
                    # 標記重要訊息
                    if 'WiFi' in line or 'ip' in line or '連接' in line:
                        print("  └─ 📡 網路訊息")
                    elif 'SpO2' in line or '血氧' in line:
                        print("  └─ 🩸 血氧數據")
                    elif '心率' in line or 'bpm' in line:
                        print("  └─ ❤️  心率數據")
                    elif '呼吸' in line:
                        print("  └─ 🌬️  呼吸數據")
                    elif 'error' in line.lower() or 'fail' in line.lower():
                        print("  └─ ⚠️  錯誤")
            except:
                pass
        
        time.sleep(0.05)

except serial.SerialException as e:
    print(f"\n❌ 串口錯誤: {e}")
except KeyboardInterrupt:
    print(f"\n\n{'=' * 70}")
    print(f"⏹️  監聽已停止")
    print(f"總共接收: {line_count} 行數據")
    print(f"運行時間: {int(time.time() - start_time)} 秒")
    print("=" * 70)
    if 'ser' in locals() and ser.is_open:
        ser.close()
