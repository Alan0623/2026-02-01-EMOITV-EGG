#!/usr/bin/env python3
"""
ESP32 健康監測數據監聽器
持續監聽並顯示 ESP32 輸出的健康監測數據
"""

import serial
import time
import sys
from datetime import datetime

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

def monitor_esp32():
    """監聽 ESP32 輸出"""
    print("=" * 70)
    print("🏥 ESP32 健康監測數據監聽器")
    print("=" * 70)
    print(f"串口: {PORT}")
    print(f"波特率: {BAUDRATE}")
    print(f"開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    print("按 Ctrl+C 停止監聽")
    print("=" * 70)
    print()
    
    try:
        ser = serial.Serial(PORT, BAUDRATE, timeout=1)
        time.sleep(1)
        
        print("✅ 已連接到 ESP32，正在監聽數據...\n")
        
        # 清空緩衝區
        ser.reset_input_buffer()
        
        line_count = 0
        last_data_time = time.time()
        
        while True:
            if ser.in_waiting > 0:
                try:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        timestamp = datetime.now().strftime('%H:%M:%S')
                        print(f"[{timestamp}] {line}")
                        sys.stdout.flush()
                        line_count += 1
                        last_data_time = time.time()
                        
                        # 特別標記重要數據
                        if 'SpO2' in line or '血氧' in line:
                            print("  └─ 🩸 血氧數據")
                        elif '心率' in line or 'bpm' in line:
                            print("  └─ ❤️  心率數據")
                        elif '呼吸' in line:
                            print("  └─ 🌬️  呼吸數據")
                        elif 'WiFi' in line or 'ip' in line or '連接' in line:
                            print("  └─ 📡 網路狀態")
                        elif 'error' in line.lower() or 'fail' in line.lower():
                            print("  └─ ⚠️  錯誤訊息")
                
                except UnicodeDecodeError:
                    pass
            
            # 如果 30 秒沒有收到數據，顯示提示
            if time.time() - last_data_time > 30 and line_count > 0:
                print(f"\n⚠️  已 30 秒未收到新數據 (共收到 {line_count} 行)")
                last_data_time = time.time()
            
            time.sleep(0.05)
    
    except serial.SerialException as e:
        print(f"\n❌ 串口錯誤: {e}")
        print("\n可能的原因:")
        print("  1. ESP32 已斷開連接")
        print("  2. 串口被其他程式佔用")
        print("  3. USB 連接不穩定")
        sys.exit(1)
    
    except KeyboardInterrupt:
        print(f"\n\n{'=' * 70}")
        print(f"⏹️  監聽已停止")
        print(f"總共接收: {line_count} 行數據")
        print(f"結束時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 70)
        if 'ser' in locals() and ser.is_open:
            ser.close()
        sys.exit(0)

if __name__ == '__main__':
    monitor_esp32()
