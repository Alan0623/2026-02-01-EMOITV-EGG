#!/usr/bin/env python3
"""
檢查 ESP32 WiFi 狀態並提供診斷
"""

import serial
import time

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

print("=" * 70)
print("📡 ESP32 WiFi 診斷工具")
print("=" * 70)

try:
    ser = serial.Serial(PORT, BAUDRATE, timeout=1)
    time.sleep(0.5)
    
    print("\n中斷當前程式...")
    ser.write(b'\x03\x03')
    time.sleep(1)
    
    # 清空緩衝區
    if ser.in_waiting > 0:
        ser.read(ser.in_waiting)
    
    print("檢查 WiFi 狀態...\n")
    
    commands = [
        ("import network", "導入 network 模組"),
        ("sta = network.WLAN(network.STA_IF)", "獲取 WiFi 介面"),
        ("print('WiFi 已啟用:', sta.active())", "檢查 WiFi 是否啟用"),
        ("print('是否已連接:', sta.isconnected())", "檢查連接狀態"),
        ("print('WiFi 配置:', sta.ifconfig() if sta.isconnected() else 'Not connected')", "獲取 IP 配置"),
        ("print('SSID:', sta.config('essid') if sta.isconnected() else 'Not connected')", "獲取 SSID"),
    ]
    
    for cmd, desc in commands:
        print(f"{desc}...")
        ser.write((cmd + '\r\n').encode())
        time.sleep(0.5)
        
        if ser.in_waiting > 0:
            output = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            # 只顯示結果行
            lines = output.strip().split('\n')
            for line in lines:
                if line and not line.startswith('>>>') and cmd not in line:
                    print(f"  → {line}")
    
    print("\n" + "=" * 70)
    print("嘗試手動連接 WiFi...")
    print("=" * 70)
    
    wifi_commands = [
        "sta.active(True)",
        "print('正在連接到 Lin_5G...')",
        "sta.connect('Lin_5G', '0932090300')",
        "import time",
        "for i in range(10):",
        "    if sta.isconnected():",
        "        print('已連接!')",
        "        print('IP:', sta.ifconfig()[0])",
        "        break",
        "    print('等待連接...', i+1)",
        "    time.sleep(1)",
        "",
        "if not sta.isconnected():",
        "    print('連接失敗')",
        "    print('可能的原因:')",
        "    print('  1. WiFi 名稱或密碼錯誤')",
        "    print('  2. WiFi 訊號太弱')",
        "    print('  3. WiFi 路由器問題')",
    ]
    
    for cmd in wifi_commands:
        if cmd:  # 跳過空行
            ser.write((cmd + '\r\n').encode())
            time.sleep(0.3)
    
    # 讀取所有輸出
    time.sleep(3)
    if ser.in_waiting > 0:
        output = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        print("\n連接嘗試結果:")
        print(output)
    
    ser.close()
    print("\n" + "=" * 70)
    print("診斷完成")
    print("=" * 70)

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
    if 'ser' in locals() and ser.is_open:
        ser.close()
