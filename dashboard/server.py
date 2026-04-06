import http.server
import socketserver
import json
import os
import sys
import threading
import time
import re
import glob
import subprocess
import signal

PORT = 8765

# ─────────────────────────────────────────
# ESP32 Serial Reader (Background Thread)
# ─────────────────────────────────────────
esp32_data = {
    "heart_rate": None,
    "spo2": None,
    "rsp_rate": None,
    "ppg": None,
    "rsp_raw": None,
    "connected": False,
    "last_update": 0,
    "raw_lines": []
}
esp32_lock = threading.Lock()

def find_esp32_port():
    """自動偵測 ESP32 序列埠"""
    patterns = ['/dev/cu.usbserial-*', '/dev/cu.wchusbserial*', '/dev/cu.SLAB_USBtoUART*']
    for pattern in patterns:
        ports = glob.glob(pattern)
        if ports:
            return ports[0]
    return None

def esp32_reader_thread():
    """背景執行緒：持續讀取 ESP32 序列埠"""
    import serial
    
    port = find_esp32_port()
    if not port:
        print("[WARN] 找不到 ESP32 序列埠，ESP32 功能已停用")
        return
    
    print(f"[INFO] 找到 ESP32 序列埠: {port}")
    
    while True:
        try:
            ser = serial.Serial(port, 115200, timeout=2)
            print(f"[OK] ESP32 已連線: {port}")
            with esp32_lock:
                esp32_data["connected"] = True
            
            # 發送啟動指令
            time.sleep(0.5)
            ser.write(b'\x03')  # Ctrl+C
            time.sleep(0.5)
            ser.write(b'\x02')  # Ctrl+B
            time.sleep(0.5)
            ser.write(b'import integrated_health_monitor\r\n')
            print("[INFO] 已發送啟動指令: import integrated_health_monitor")
            
            while True:
                if ser.in_waiting > 0:
                    try:
                        line = ser.readline().decode('utf-8', errors='ignore').strip()
                        if not line:
                            continue
                        
                        with esp32_lock:
                            esp32_data["last_update"] = time.time()
                            esp32_data["raw_lines"].append(line)
                            if len(esp32_data["raw_lines"]) > 50:
                                esp32_data["raw_lines"] = esp32_data["raw_lines"][-50:]
                        
                        # 解析心率
                        if '心率:' in line:
                            m = re.search(r'心率:\s*([\d.]+)\s*bpm', line)
                            if m:
                                with esp32_lock:
                                    esp32_data["heart_rate"] = float(m.group(1))
                                print(f"  [HR] 心率: {m.group(1)} bpm")
                        
                        # 解析血氧
                        if 'SpO2:' in line:
                            m = re.search(r'SpO2:\s*([\d.]+)\s*%', line)
                            if m:
                                with esp32_lock:
                                    esp32_data["spo2"] = float(m.group(1))
                                print(f"  [SpO2] SpO2: {m.group(1)}%")
                        
                        # 解析呼吸速率
                        if '呼吸速率:' in line:
                            m = re.search(r'呼吸速率:\s*([\d.]+)\s*次/分', line)
                            if m:
                                with esp32_lock:
                                    esp32_data["rsp_rate"] = float(m.group(1))
                                print(f"  [RSP] 呼吸速率: {m.group(1)} 次/分")
                        
                    except Exception as e:
                        pass
                else:
                    time.sleep(0.05)
                    
        except Exception as e:
            print(f"[WARN] ESP32 連線中斷: {e}")
            with esp32_lock:
                esp32_data["connected"] = False
            time.sleep(3)  # 3 秒後重試
            print("[INFO] 嘗試重新連接 ESP32...")


# ─────────────────────────────────────────
# .env loader
# ─────────────────────────────────────────
def load_env():
    """Simple .env loader"""
    env = {}
    try:
        with open('.env', 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'): continue
                if '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    except FileNotFoundError:
        print("Warning: .env file not found")
    return env

# ─────────────────────────────────────────
# HTTP Handler
# ─────────────────────────────────────────
class ConfigHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if self.path == '/config':
            env = load_env()
            config = {
                "clientId": env.get("CLIENT_ID", ""),
                "clientSecret": env.get("CLIENT_SECRET", "")
            }
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(config).encode('utf-8'))
        
        elif self.path == '/esp32':
            with esp32_lock:
                data = {
                    "heart_rate": esp32_data["heart_rate"],
                    "spo2": esp32_data["spo2"],
                    "rsp_rate": esp32_data["rsp_rate"],
                    "connected": esp32_data["connected"],
                    "last_update": esp32_data["last_update"],
                    "raw_lines": esp32_data["raw_lines"][-10:]
                }
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        
        elif self.path == '/esp32/release':
            # 釋放佔用序列埠的程序
            port = find_esp32_port()
            result = {"success": False, "message": "", "port": port}
            if not port:
                result["message"] = "找不到 ESP32 序列埠"
            else:
                try:
                    out = subprocess.check_output(['lsof', port], stderr=subprocess.DEVNULL).decode()
                    pids = set()
                    for line in out.strip().split('\n')[1:]:
                        parts = line.split()
                        if len(parts) >= 2:
                            pid = int(parts[1])
                            if pid != os.getpid():  # 不殺自己
                                pids.add(pid)
                    if pids:
                        for pid in pids:
                            try:
                                os.kill(pid, signal.SIGTERM)
                                print(f"[OK] 已釋放序列埠佔用程序 PID={pid}")
                            except ProcessLookupError:
                                pass
                        result["success"] = True
                        result["message"] = f"已釋放 {len(pids)} 個佔用程序 (PIDs: {list(pids)})"
                    else:
                        result["success"] = True
                        result["message"] = "序列埠未被其他程序佔用"
                except subprocess.CalledProcessError:
                    result["success"] = True
                    result["message"] = "序列埠未被其他程序佔用"
                except Exception as e:
                    result["message"] = f"釋放失敗: {str(e)}"
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))
        
        else:
            return http.server.SimpleHTTPRequestHandler.do_GET(self)
            
    def do_POST(self):
        if self.path == '/api/mne_analysis':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data)
                eeg_data = data.get('eeg_data', [])
                
                if not eeg_data or len(eeg_data) < 5 or len(eeg_data[0]) < 128:
                    print("No raw EEG recorded, synthesizing 10 seconds of mock data for MNE analysis demonstration...")
                    import numpy as np
                    times = np.arange(0, 10, 1/128)
                    mock_array = np.random.randn(5, len(times)) * 20
                    mock_array[:, int(2*128):int(2.5*128)] += 50
                    eeg_data = mock_array.tolist()
                
                # advanced_eeg_analysis.py is in the parent directory
                parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                if parent_dir not in sys.path:
                    sys.path.insert(0, parent_dir)
                    
                import advanced_eeg_analysis
                # Run the 4 advanced analysis processes on the live memory buffer
                report_file = advanced_eeg_analysis.run_analysis_from_data(eeg_data)
                
                import shutil
                src_path = os.path.join(parent_dir, report_file)
                dst_path = os.path.join(os.getcwd(), report_file)
                # Ensure the report HTML is moved to the dashboard directory so it can be served
                if os.path.exists(src_path):
                    shutil.move(src_path, dst_path)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "report_url": f"/{report_file}"}).encode('utf-8'))
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
        else:
            self.send_error(404, "File not found")
    
    def log_message(self, format, *args):
        # 過濾掉 /esp32 的輪詢 log 避免洗版
        if '/esp32' in str(args):
            return
        super().log_message(format, *args)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # 啟動 ESP32 背景讀取執行緒
    esp_thread = threading.Thread(target=esp32_reader_thread, daemon=True)
    esp_thread.start()
    
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), ConfigHandler) as httpd:
        print(f"[SERVER] Serving at http://localhost:{PORT}")
        print("Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
