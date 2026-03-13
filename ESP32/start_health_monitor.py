#!/usr/bin/env python3
"""
啟動 ESP32 健康監測程式並監聽輸出
"""

import serial
import time
import sys
from datetime import datetime

PORT = '/dev/cu.usbserial-14240'
BAUDRATE = 115200

print("=" * 70)
print("🚀 啟動 ESP32 健康監測程式")
print("=" * 70)

try:
    ser = serial.Serial(PORT, BAUDRATE, timeout=1)
    ser.setDTR(False)
    ser.setRTS(False)
    time.sleep(0.5)
    
    # 軟重啟 (Ctrl+D) 並等待
    ser.write(b'\x04')
    time.sleep(1)
    
    # 嘗試退出 Raw REPL 模式 (Ctrl+B)
    ser.write(b'\x02')
    time.sleep(0.5)
    
    # 中斷當前程式 (Ctrl+C)
    ser.write(b'\x03')
    time.sleep(0.5)
    ser.reset_input_buffer()
    
    print("\n執行 integrated_health_monitor.py...")
    ser.write(b"import integrated_health_monitor\r\n")
    
    print("\n" + "=" * 70)
    print("📡 ESP32 輸出 (按 Ctrl+C 停止):")
    print("=" * 70)
    print()
    
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
                    if 'ip' in line.lower() or 'IP' in line:
                        print("  └─ 📡 網路資訊")
                    elif 'SpO2' in line or '血氧' in line:
                        print("  └─ 🩸 血氧數據")
                    elif '心率' in line or 'bpm' in line:
                        print("  └─ ❤️  心率數據")
                    elif '呼吸' in line:
                        print("  └─ 🌬️  呼吸數據")
                    elif 'error' in line.lower() or 'fail' in line.lower():
                        print("  └─ ⚠️  錯誤")
                    elif '啟動' in line or 'start' in line.lower():
                        print("  └─ ✅ 系統啟動")
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
    print("\n💡 提示:")
    print(f"  ESP32 仍在 USB 模式運行，請保持序列埠開啟以接收數據。")
    print("=" * 70)
    if 'ser' in locals() and ser.is_open:
        ser.close()
