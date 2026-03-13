#!/usr/bin/env python3
"""
更新 ESP32 上的 WiFi 設定並重新連接
"""

import serial
import time
import sys
from datetime import datetime

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

print("=" * 70)
print("📡 更新 ESP32 WiFi 設定")
print("=" * 70)

try:
    ser = serial.Serial(PORT, BAUDRATE, timeout=1)
    time.sleep(0.5)
    
    # 中斷當前程式
    print("\n中斷當前程式...")
    ser.write(b'\x03\x03')
    time.sleep(1)
    ser.reset_input_buffer()
    
    # 嘗試連接到正確的 WiFi
    print("\n正在連接到 WiFi: Lin")
    print("密碼: 0932090300\n")
    
    commands = [
        "import network",
        "sta = network.WLAN(network.STA_IF)",
        "sta.active(True)",
        "sta.disconnect()",  # 先斷開舊連接
        "import time; time.sleep(1)",
        "print('開始連接...')",
        "sta.connect('Lin', '0932090300')",
        "import time",
        "for i in range(15):",
        "    if sta.isconnected():",
        "        print('✅ 已連接!')",
        "        print('IP 位址:', sta.ifconfig()[0])",
        "        break",
        "    print('等待連接...', i+1, '/15')",
        "    time.sleep(1)",
        "",
        "if not sta.isconnected():",
        "    print('❌ 連接失敗')",
        "else:",
        "    print('\\n網路配置:')",
        "    config = sta.ifconfig()",
        "    print('  IP:', config[0])",
        "    print('  子網路遮罩:', config[1])",
        "    print('  閘道:', config[2])",
        "    print('  DNS:', config[3])",
    ]
    
    for cmd in commands:
        if cmd:  # 跳過空行
            ser.write((cmd + '\r\n').encode())
            time.sleep(0.2)
    
    # 讀取輸出
    print("\n連接過程:")
    print("-" * 70)
    time.sleep(5)
    
    output_lines = []
    while ser.in_waiting > 0:
        try:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line and not line.startswith('>>>'):
                print(line)
                output_lines.append(line)
        except:
            pass
    
    print("-" * 70)
    
    # 檢查是否成功連接
    if any('✅' in line or 'IP' in line for line in output_lines):
        print("\n" + "=" * 70)
        print("🎉 WiFi 連接成功！")
        print("=" * 70)
        
        # 提取 IP 位址
        for line in output_lines:
            if 'IP' in line and '位址' in line:
                ip_addr = line.split(':')[-1].strip()
                print(f"\n📍 ESP32 IP 位址: {ip_addr}")
                print(f"\n您現在可以在瀏覽器中訪問:")
                print(f"  http://{ip_addr}/")
                print(f"  http://{ip_addr}/all")
                break
        
        print("\n下一步:")
        print("  1. 停止測試伺服器 (Ctrl+C)")
        print("  2. 更新 index.html 中的 API 端點為 ESP32 的 IP")
        print("  3. 或直接訪問 ESP32 的 IP 查看數據")
        
    else:
        print("\n" + "=" * 70)
        print("⚠️  WiFi 連接可能失敗")
        print("=" * 70)
        print("\n請檢查:")
        print("  1. WiFi 名稱是否正確: Lin")
        print("  2. WiFi 密碼是否正確: 0932090300")
        print("  3. ESP32 是否在 WiFi 訊號範圍內")
        print("  4. WiFi 路由器是否正常運作")
    
    ser.close()
    print("\n" + "=" * 70)

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
    import traceback
    traceback.print_exc()
    if 'ser' in locals() and ser.is_open:
        ser.close()
