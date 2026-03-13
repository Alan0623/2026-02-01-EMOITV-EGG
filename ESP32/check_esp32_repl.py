#!/usr/bin/env python3
"""
ESP32 互動式控制台
嘗試進入 REPL 並檢查 ESP32 狀態
"""

import serial
import time
import sys

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

def check_esp32_status():
    """檢查 ESP32 狀態並嘗試進入 REPL"""
    print("=" * 70)
    print("🔍 ESP32 狀態檢查與 REPL 連接")
    print("=" * 70)
    print(f"串口: {PORT}")
    print(f"波特率: {BAUDRATE}")
    print("=" * 70)
    
    try:
        ser = serial.Serial(PORT, BAUDRATE, timeout=1)
        time.sleep(0.5)
        
        print("\n✅ 串口已開啟")
        print("\n正在嘗試進入 REPL...")
        print("  1. 發送 Ctrl+C (中斷當前程式)")
        
        # 發送 Ctrl+C 來中斷當前程式
        ser.write(b'\x03\x03')
        time.sleep(1)
        
        # 讀取回應
        response = ""
        if ser.in_waiting > 0:
            response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            print(f"\n回應:\n{response}")
        
        print("\n  2. 發送 Ctrl+D (軟重啟)")
        ser.write(b'\x04')
        time.sleep(2)
        
        # 讀取啟動訊息
        startup_output = ""
        start_time = time.time()
        while time.time() - start_time < 3:
            if ser.in_waiting > 0:
                data = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                startup_output += data
                print(data, end='')
                sys.stdout.flush()
            time.sleep(0.1)
        
        if startup_output:
            print("\n\n" + "=" * 70)
            print("📋 ESP32 啟動訊息:")
            print("=" * 70)
            print(startup_output)
            
            # 分析啟動訊息
            if "MicroPython" in startup_output:
                print("\n✅ 檢測到 MicroPython")
            if "ESP32" in startup_output:
                print("✅ 確認為 ESP32 設備")
            if ">>>" in startup_output:
                print("✅ REPL 提示符已出現")
        else:
            print("\n⚠️  未收到啟動訊息")
        
        # 嘗試執行簡單命令
        print("\n" + "=" * 70)
        print("🧪 測試 REPL 命令")
        print("=" * 70)
        
        # 清空緩衝區
        ser.reset_input_buffer()
        
        # 發送簡單的 Python 命令
        test_commands = [
            ("print('Hello from ESP32')", "測試 print 函數"),
            ("import sys; print(sys.platform)", "檢查平台"),
            ("import os; print(os.listdir('/'))", "列出根目錄檔案"),
        ]
        
        for cmd, desc in test_commands:
            print(f"\n執行: {desc}")
            print(f"命令: {cmd}")
            ser.write((cmd + '\r\n').encode())
            time.sleep(0.5)
            
            if ser.in_waiting > 0:
                output = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                print(f"輸出: {output.strip()}")
        
        print("\n" + "=" * 70)
        print("📝 檢查是否有 main.py 或 integrated_health_monitor.py")
        print("=" * 70)
        
        ser.reset_input_buffer()
        ser.write(b"import os; files = os.listdir('/'); print(files)\r\n")
        time.sleep(0.5)
        
        if ser.in_waiting > 0:
            output = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            print(f"檔案列表:\n{output}")
            
            if 'main.py' in output:
                print("\n✅ 找到 main.py")
            elif 'integrated_health_monitor.py' in output:
                print("\n✅ 找到 integrated_health_monitor.py")
            else:
                print("\n⚠️  未找到健康監測程式")
                print("\n建議:")
                print("  1. 使用 Thonny IDE 上傳 integrated_health_monitor.py")
                print("  2. 將檔案重命名為 main.py 以自動執行")
        
        ser.close()
        print("\n" + "=" * 70)
        print("✅ 檢查完成")
        print("=" * 70)
        
    except serial.SerialException as e:
        print(f"\n❌ 串口錯誤: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\n⏹️  使用者中斷")
        if 'ser' in locals() and ser.is_open:
            ser.close()
        sys.exit(0)

if __name__ == '__main__':
    check_esp32_status()
