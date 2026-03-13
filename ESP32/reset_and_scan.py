import serial, time, sys

PORT = '/dev/cu.usbserial-14240'
ser = serial.Serial(PORT, 115200, timeout=2)
time.sleep(0.3)

# 中斷目前程式
ser.write(b'\x03\x03')
time.sleep(0.5)
ser.read_all()

# 完整重啟 ESP32
print("Resetting ESP32 via machine.reset()...")
ser.write(b'import machine; machine.reset()\r\n')
time.sleep(0.5)
ser.close()

# 等待重啟
print("Waiting for reboot (6 sec)...")
time.sleep(6)

# 重新連接
ser = serial.Serial(PORT, 115200, timeout=2)
time.sleep(0.3)

# 送出 Ctrl-C 阻止 boot.py 自動執行
print("Sending Ctrl-C to interrupt boot...")
for _ in range(15):
    ser.write(b'\x03')
    time.sleep(0.1)

time.sleep(2)
buf = ser.read_all().decode(errors='ignore')
print("Boot output:", buf[:400])

# 掃描 WiFi
print("\nScanning WiFi...")
cmd = b"import network; sta=network.WLAN(network.STA_IF); sta.active(True); import time; time.sleep(3); nets=sta.scan(); print(len(nets)); [print(n[0]) for n in nets]\r\n"
ser.write(cmd)
time.sleep(8)
buf = ser.read_all().decode(errors='ignore')
print("Scan result:")
print(buf)

# 嘗試連線
print("\nConnecting to hotspot...")
ssid = "林位青的iPhone15"
pw   = "0966429500"
cmd2 = f"sta.connect('{ssid}', '{pw}')\r\n".encode('utf-8')
ser.write(cmd2)
time.sleep(2)
ser.read_all()

# 等待連線結果
print("Waiting for connection (30 sec)...")
for i in range(15):
    ser.write(b"print(sta.isconnected(), sta.ifconfig())\r\n")
    time.sleep(2)
    buf = ser.read_all().decode(errors='ignore')
    lines = [l.strip() for l in buf.split('\n') if l.strip() and '>>>' not in l and 'print' not in l]
    for l in lines:
        print(f"  [{i+1}] {l}")
        sys.stdout.flush()
    if 'True' in buf:
        print("\nConnected! Starting monitor...")
        ser.write(b"import integrated_health_monitor\r\n")
        start = time.time()
        while time.time() - start < 60:
            if ser.in_waiting > 0:
                line = ser.readline().decode(errors='ignore').strip()
                if line:
                    print(f"  ESP32>> {line}")
                    sys.stdout.flush()
            time.sleep(0.05)
        break

ser.close()
print("Done.")
