import serial
import time
import os
import sys

PORT = '/dev/cu.usbserial-14240'
BAUDRATE = 115200
FILENAME = 'integrated_health_monitor.py'
SRC_PATH = f'/Users/alan/Downloads/2025-02-01-ESP32-MAX30102/{FILENAME}'

def upload_file():
    print("=" * 70)
    print(f"📤 開始上傳 {FILENAME} 到 ESP32")
    print("=" * 70)
    
    if not os.path.exists(SRC_PATH):
        print(f"❌ 找不到來源檔案: {SRC_PATH}")
        return

    try:
        with open(SRC_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
            
        print(f"檔案大小: {len(content)} bytes")
        
        ser = serial.Serial(PORT, BAUDRATE, timeout=1)
        ser.setDTR(False)
        ser.setRTS(False)
        time.sleep(0.5)
        
        # 進入 Raw REPL
        print("正在進入 Raw REPL 模式...")
        ser.write(b'\x03')  # Ctrl-C
        time.sleep(0.1)
        ser.write(b'\x03')  # Ctrl-C
        time.sleep(0.1)
        ser.write(b'\x01')  # Ctrl-A (Enter Raw REPL)
        time.sleep(0.5)
        
        if ser.in_waiting > 0:
            resp = ser.read(ser.in_waiting).decode(errors='ignore')
            if 'raw REPL; CTRL-B to exit' not in resp:
                print("⚠️  無法進入 Raw REPL 模式，嘗試重試...")
                ser.write(b'\x02') # Ctrl-B
                time.sleep(0.5)
                ser.write(b'\x03')
                time.sleep(0.1)
                ser.write(b'\x01')
                time.sleep(0.5)
        
        # 準備寫入檔案的 Python 代碼
        print("正在寫入檔案...")
        
        # 分塊寫入以避免緩衝區溢出
        chunk_size = 256
        chunks = [content[i:i+chunk_size] for i in range(0, len(content), chunk_size)]
        
        # 1. 開啟檔案
        cmd = f"f = open('{FILENAME}', 'w', encoding='utf-8')".encode()
        ser.write(cmd + b'\x04')
        time.sleep(0.2)
        resp = ser.read_all()
        
        # 2. 寫入內容
        total_chunks = len(chunks)
        for i, chunk in enumerate(chunks):
            # 對 chunk 進行跳脫處理 (repr)
            escaped_chunk = repr(chunk)
            write_cmd = f"f.write({escaped_chunk})".encode()
            
            ser.write(write_cmd + b'\x04')
            time.sleep(0.1)
            
            # 讀取回應確認寫入成功 (OK)
            while ser.in_waiting > 0:
                ser.read(ser.in_waiting)
                
            print(f"\r進度: {int((i+1)/total_chunks*100)}%", end='')
            sys.stdout.flush()
            
        print()
            
        # 3. 關閉檔案
        ser.write(b"f.close()\x04")
        time.sleep(0.2)
        resp = ser.read_all()
        
        # 退出 Raw REPL
        print("退出 Raw REPL 模式...")
        ser.write(b'\x02')  # Ctrl-B
        time.sleep(1)
        
        # 軟重啟
        print("正在重啟 ESP32...")
        ser.write(b'\x04')  # Ctrl-D
        
        ser.close()
        print("\n✅ 上傳完成！")
        print("=" * 70)
        
    except serial.SerialException as e:
        print(f"\n❌ 串口錯誤: {e}")
        print("請確認串口未被其他程式佔用 (如 Thonny 或監控終端機)")
    except Exception as e:
        print(f"\n❌ 操作失敗: {e}")

if __name__ == '__main__':
    upload_file()
