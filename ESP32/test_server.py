#!/usr/bin/env python3
"""
測試伺服器 - 用於測試整合健康監測儀表板
模擬 integrated_health_monitor.py 的 API 端點
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import random
import time

class HealthMonitorHandler(SimpleHTTPRequestHandler):
    """自訂 HTTP 請求處理器"""
    
    # 模擬數據
    spo2 = 98
    heart_rate = 75
    ppg = 500
    rsp_rate = 16
    rsp = 512
    
    def do_GET(self):
        """處理 GET 請求"""
        
        if self.path == '/':
            # 提供主頁面
            self.path = '/index.html'
            return SimpleHTTPRequestHandler.do_GET(self)
        
        elif self.path == '/spo2':
            # 血氧濃度 (95-100%)
            self.spo2 = max(95, min(100, self.spo2 + random.randint(-1, 1)))
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(str(self.spo2).encode())
        
        elif self.path == '/hr':
            # 心率 (60-100 bpm)
            self.heart_rate = max(60, min(100, self.heart_rate + random.randint(-2, 2)))
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(str(self.heart_rate).encode())
        
        elif self.path == '/ppg':
            # PPG 波形數據 (模擬心跳波形)
            self.ppg = 500 + int(200 * abs(random.gauss(0, 1)))
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(str(self.ppg).encode())
        
        elif self.path == '/rsp_rate':
            # 呼吸速率 (12-20 次/分)
            self.rsp_rate = max(12, min(20, self.rsp_rate + random.randint(-1, 1)))
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(str(self.rsp_rate).encode())
        
        elif self.path == '/rsp':
            # 呼吸波形數據
            self.rsp = 512 + int(100 * random.gauss(0, 1))
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(str(self.rsp).encode())
        
        elif self.path == '/all':
            # 所有數據 (JSON 格式)
            data = {
                'spo2': self.spo2,
                'heart_rate': self.heart_rate,
                'ppg': self.ppg,
                'rsp_rate': self.rsp_rate,
                'rsp': self.rsp
            }
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        
        else:
            # 其他請求使用預設處理
            return SimpleHTTPRequestHandler.do_GET(self)
    
    def log_message(self, format, *args):
        """自訂日誌輸出"""
        # 只顯示 API 請求
        if args[0].startswith('GET /'):
            path = args[0].split()[1]
            if path in ['/spo2', '/hr', '/ppg', '/rsp_rate', '/rsp', '/all']:
                return
        return SimpleHTTPRequestHandler.log_message(self, format, *args)


def run_server(port=8080):
    """啟動測試伺服器"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, HealthMonitorHandler)
    
    print("=" * 60)
    print("🏥 整合健康監測測試伺服器")
    print("=" * 60)
    print(f"伺服器運行於: http://localhost:{port}")
    print(f"儀表板網址: http://localhost:{port}/index.html")
    print("\n可用的 API 端點:")
    print("  /spo2      - 血氧濃度")
    print("  /hr        - 心率")
    print("  /ppg       - 心電圖波形")
    print("  /rsp_rate  - 呼吸速率")
    print("  /rsp       - 呼吸波形")
    print("  /all       - 所有資料 (JSON格式)")
    print("\n按 Ctrl+C 停止伺服器")
    print("=" * 60)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n伺服器已停止")
        httpd.shutdown()


if __name__ == '__main__':
    run_server()
