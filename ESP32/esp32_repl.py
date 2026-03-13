#!/usr/bin/env python3
"""
ESP32 MicroPython REPL 連接工具
允許與 ESP32 進行互動式通訊
"""

import serial
import sys
import time
import select

PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200

def connect_repl():
    """連接到 ESP32 REPL"""
    print("=" * 60)
    print("🔌 ESP32 MicroPython REPL")
    print("=" * 60)
    print(f"串口: {PORT}")
    print(f"波特率: {BAUDRATE}")
    print()
    print("提示:")
    print("  - 按 Ctrl+C 可以中斷 ESP32 程式")
    print("  - 按 Ctrl+D 可以軟重啟 ESP32")
    print("  - 輸入 'exit()' 或按 Ctrl+] 退出")
    print("=" * 60)
    print()
    
    try:
        ser = serial.Serial(PORT, BAUDRATE, timeout=0.1)
        time.sleep(0.5)
        
        print("✅ 已連接到 ESP32")
        print("正在嘗試進入 REPL...")
        
        # 發送 Ctrl+C 來中斷當前程式
        ser.write(b'\x03')
        time.sleep(0.5)
        
        # 清空緩衝區並讀取回應
        while ser.in_waiting > 0:
            data = ser.read(ser.in_waiting)
            try:
                print(data.decode('utf-8', errors='ignore'), end='')
            except:
                pass
        
        print("\n" + "-" * 60)
        print("REPL 已就緒，您可以輸入 MicroPython 指令")
        print("-" * 60)
        
        # 互動式 REPL
        while True:
            # 讀取 ESP32 輸出
            if ser.in_waiting > 0:
                data = ser.read(ser.in_waiting)
                try:
                    output = data.decode('utf-8', errors='ignore')
                    print(output, end='')
                    sys.stdout.flush()
                except:
                    pass
            
            # 檢查是否有鍵盤輸入 (非阻塞)
            if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
                line = sys.stdin.readline()
                if line.strip() == 'exit()':
                    break
                ser.write(line.encode('utf-8'))
            
            time.sleep(0.01)
        
        ser.close()
        print("\n已斷開連接")
        
    except serial.SerialException as e:
        print(f"❌ 連接失敗: {e}")
        sys.exit(1)
    
    except KeyboardInterrupt:
        print("\n\n⏹️  使用者中斷")
        if 'ser' in locals() and ser.is_open:
            ser.close()
        sys.exit(0)

if __name__ == '__main__':
    connect_repl()
