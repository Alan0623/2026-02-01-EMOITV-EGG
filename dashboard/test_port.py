import serial, time
try:
    with serial.Serial('/dev/cu.usbserial-14240', 115200, timeout=1) as ser:
        print("Connected.")
        ser.write(b'\x03') # Ctrl-C
        time.sleep(0.5)
        ser.write(b'\x04') # Soft Reset
        time.sleep(1)
        while ser.in_waiting:
            print(ser.readline().decode('utf-8', errors='ignore').strip())
            
        print("Sending import integrated_health_monitor")
        ser.write(b'import integrated_health_monitor\n')
        
        start = time.time()
        while time.time() - start < 15:
            if ser.in_waiting:
                print(ser.readline().decode('utf-8', errors='ignore').strip())
            time.sleep(0.1)
except Exception as e:
    print(e)
