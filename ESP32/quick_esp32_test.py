#!/usr/bin/env python3
"""
簡單的 ESP32 串口測試
嘗試開啟並立即關閉串口以測試可用性
"""

import serial
import time

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

print("=" * 60)
print("🔌 ESP32 快速連接測試")
print("=" * 60)
print(f"串口: {PORT}")
print(f"波特率: {BAUDRATE}")
print()

try:
    print("嘗試開啟串口...")
    ser = serial.Serial(PORT, BAUDRATE, timeout=1)
    print("✅ 成功開啟串口！")
    
    print(f"串口資訊:")
    print(f"  - 名稱: {ser.name}")
    print(f"  - 是否開啟: {ser.is_open}")
    print(f"  - 波特率: {ser.baudrate}")
    
    print("\n等待 2 秒...")
    time.sleep(2)
    
    print("嘗試讀取數據...")
    ser.reset_input_buffer()
    
    # 嘗試讀取 5 秒
    start = time.time()
    lines_read = 0
    
    while time.time() - start < 5:
        if ser.in_waiting > 0:
            try:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    print(f"  📥 {line}")
                    lines_read += 1
            except:
                pass
        time.sleep(0.1)
    
    print(f"\n✅ 在 5 秒內讀取到 {lines_read} 行數據")
    
    if lines_read == 0:
        print("\n⚠️  注意: 未收到任何數據")
        print("可能原因:")
        print("  1. ESP32 程式未運行或未輸出數據")
        print("  2. 波特率設定不匹配")
        print("  3. ESP32 正在等待輸入")
    else:
        print("\n✅ ESP32 連接正常，可以接收數據！")
    
    ser.close()
    print("\n串口已關閉")
    
except serial.SerialException as e:
    print(f"❌ 錯誤: {e}")
    print("\n可能的原因:")
    print("  1. 串口正被其他程式使用")
    print("  2. 沒有權限訪問串口")
    print("  3. ESP32 未正確連接")
    
    print("\n建議:")
    print("  1. 拔掉 USB 重新插入")
    print("  2. 關閉可能使用串口的程式 (Arduino IDE, Thonny, etc.)")
    print("  3. 重新啟動終端機")

except KeyboardInterrupt:
    print("\n\n⏹️  使用者中斷")
    if 'ser' in locals() and ser.is_open:
        ser.close()

print("=" * 60)
