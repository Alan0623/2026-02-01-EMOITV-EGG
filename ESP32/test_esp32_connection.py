#!/usr/bin/env python3
"""
ESP32 連接測試腳本
測試與 ESP32 的串口通訊
"""

import serial
import time
import sys

# ESP32 串口設定
PORT = '/dev/tty.usbserial-14110'
BAUDRATE = 115200  # ESP32 預設波特率

def test_esp32_connection():
    """測試 ESP32 連接"""
    print("=" * 60)
    print("🔌 ESP32 連接測試")
    print("=" * 60)
    print(f"串口設備: {PORT}")
    print(f"波特率: {BAUDRATE}")
    print("-" * 60)
    
    try:
        # 開啟串口
        print("正在連接 ESP32...")
        ser = serial.Serial(PORT, BAUDRATE, timeout=1)
        time.sleep(2)  # 等待連接穩定
        
        print("✅ 成功連接到 ESP32!")
        print("-" * 60)
        print("正在讀取 ESP32 輸出 (按 Ctrl+C 停止)...")
        print("-" * 60)
        
        # 清空緩衝區
        ser.reset_input_buffer()
        
        # 讀取並顯示輸出
        line_count = 0
        start_time = time.time()
        
        while True:
            if ser.in_waiting > 0:
                try:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        print(f"[{time.time() - start_time:.1f}s] {line}")
                        line_count += 1
                        
                        # 如果讀取到 20 行後自動停止（用於測試）
                        if line_count >= 20:
                            print("-" * 60)
                            print(f"✅ 已成功讀取 {line_count} 行數據")
                            print("ESP32 連接正常！")
                            break
                except UnicodeDecodeError:
                    pass
            
            # 超時檢查（30秒）
            if time.time() - start_time > 30:
                print("-" * 60)
                if line_count > 0:
                    print(f"✅ 在 30 秒內讀取到 {line_count} 行數據")
                    print("ESP32 連接正常！")
                else:
                    print("⚠️  30 秒內未收到任何數據")
                    print("可能原因：")
                    print("  1. ESP32 程式未運行")
                    print("  2. 波特率設定不正確")
                    print("  3. ESP32 未輸出任何訊息")
                break
            
            time.sleep(0.1)
        
        ser.close()
        print("=" * 60)
        
    except serial.SerialException as e:
        print(f"❌ 連接失敗: {e}")
        print("\n可能的解決方案：")
        print("  1. 確認 ESP32 已正確連接到 USB")
        print("  2. 檢查是否有其他程式正在使用該串口")
        print("  3. 嘗試拔掉 USB 重新插入")
        print("  4. 確認串口設備路徑是否正確")
        sys.exit(1)
    
    except KeyboardInterrupt:
        print("\n\n⏹️  使用者中斷")
        ser.close()
        print("=" * 60)
        sys.exit(0)


def check_esp32_info():
    """檢查 ESP32 基本資訊"""
    try:
        ser = serial.Serial(PORT, BAUDRATE, timeout=2)
        time.sleep(1)
        
        print("\n📋 ESP32 串口資訊:")
        print(f"  設備名稱: {ser.name}")
        print(f"  波特率: {ser.baudrate}")
        print(f"  數據位: {ser.bytesize}")
        print(f"  停止位: {ser.stopbits}")
        print(f"  校驗位: {ser.parity}")
        print(f"  是否開啟: {ser.is_open}")
        
        ser.close()
        return True
    except Exception as e:
        print(f"❌ 無法獲取 ESP32 資訊: {e}")
        return False


if __name__ == '__main__':
    # 先檢查基本資訊
    if check_esp32_info():
        print()
        # 然後測試連接
        test_esp32_connection()
    else:
        print("\n請檢查 ESP32 連接後重試")
        sys.exit(1)
