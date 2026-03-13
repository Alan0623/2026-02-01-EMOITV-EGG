#!/usr/bin/env python3
"""
簡單獲取 ESP32 IP 位址
"""

import serial
import time
import re

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

print("=" * 70)
print("📍 獲取 ESP32 IP 位址")
print("=" * 70)

try:
    ser = serial.Serial(PORT, BAUDRATE, timeout=1)
    time.sleep(0.5)
    
    # 中斷
    ser.write(b'\x03')
    time.sleep(0.5)
    ser.reset_input_buffer()
    
    print("\n查詢 IP 位址...")
    
    # 直接獲取 IP
    ser.write(b"import network; sta = network.WLAN(network.STA_IF); sta.ifconfig()[0]\r\n")
    time.sleep(1)
    
    # 讀取輸出
    output = ""
    while ser.in_waiting > 0:
        data = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        output += data
        time.sleep(0.1)
    
    print("\n原始輸出:")
    print(output)
    print()
    
    # 使用正則表達式找出 IP 位址
    ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
    ip_matches = re.findall(ip_pattern, output)
    
    if ip_matches:
        ip_address = ip_matches[0]  # 取第一個匹配的 IP
        print("=" * 70)
        print(f"✅ 找到 ESP32 IP 位址: {ip_address}")
        print("=" * 70)
        print("\n您可以在瀏覽器中訪問:")
        print(f"  • 主頁: http://{ip_address}/")
        print(f"  • 所有數據: http://{ip_address}/all")
        print(f"  • 血氧: http://{ip_address}/spo2")
        print(f"  • 心率: http://{ip_address}/hr")
        print(f"  • PPG波形: http://{ip_address}/ppg")
        print(f"  • 呼吸速率: http://{ip_address}/rsp_rate")
        print(f"  • 呼吸波形: http://{ip_address}/rsp")
        print("\n" + "=" * 70)
        print("🎯 下一步:")
        print("  1. 在瀏覽器中訪問上述網址測試 API")
        print("  2. 或者將 index.html 中的 API 端點更新為此 IP")
        print("=" * 70)
    else:
        print("=" * 70)
        print("❌ 未找到 IP 位址")
        print("=" * 70)
        print("\nESP32 可能未連接到 WiFi")
        print("請檢查 WiFi 設定並重試")
    
    ser.close()

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
    import traceback
    traceback.print_exc()
    if 'ser' in locals() and ser.is_open:
        ser.close()
