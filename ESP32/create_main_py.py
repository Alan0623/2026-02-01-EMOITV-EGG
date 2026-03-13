#!/usr/bin/env python3
"""
在 ESP32 上創建 main.py 來自動執行健康監測程式
"""

import serial
import time

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

print("=" * 70)
print("📝 在 ESP32 上創建 main.py")
print("=" * 70)

try:
    ser = serial.Serial(PORT, BAUDRATE, timeout=1)
    time.sleep(0.5)
    
    # 進入 REPL
    ser.write(b'\x03\x03')
    time.sleep(0.5)
    ser.reset_input_buffer()
    
    print("正在創建 main.py...")
    
    # 創建 main.py 來執行 integrated_health_monitor.py
    main_py_content = """# main.py - 自動執行健康監測程式
import integrated_health_monitor
"""
    
    # 寫入檔案的命令
    commands = [
        "f = open('main.py', 'w')",
        f"f.write({repr(main_py_content)})",
        "f.close()",
        "print('main.py created successfully')",
    ]
    
    for cmd in commands:
        print(f"執行: {cmd}")
        ser.write((cmd + '\r\n').encode())
        time.sleep(0.3)
        
        if ser.in_waiting > 0:
            output = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            print(f"  → {output.strip()}")
    
    # 驗證檔案
    print("\n驗證 main.py...")
    ser.write(b"import os; print('main.py' in os.listdir('/'))\r\n")
    time.sleep(0.5)
    
    if ser.in_waiting > 0:
        output = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        if 'True' in output:
            print("✅ main.py 創建成功！")
        else:
            print("❌ main.py 創建失敗")
    
    # 讀取並顯示 main.py 內容
    print("\n讀取 main.py 內容...")
    ser.write(b"f = open('main.py'); print(f.read()); f.close()\r\n")
    time.sleep(0.5)
    
    if ser.in_waiting > 0:
        output = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        print(f"main.py 內容:\n{output}")
    
    print("\n" + "=" * 70)
    print("✅ 完成！")
    print("=" * 70)
    print("\n下一步:")
    print("  1. 重啟 ESP32 (按 RESET 按鈕或執行軟重啟)")
    print("  2. 程式將自動執行")
    print("  3. 使用 monitor_esp32.py 查看輸出")
    print("=" * 70)
    
    ser.close()

except Exception as e:
    print(f"❌ 錯誤: {e}")
    if 'ser' in locals() and ser.is_open:
        ser.close()
