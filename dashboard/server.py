import http.server
import socketserver
import json
import os
import sys

PORT = 8765

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

class ConfigHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 允許 blob: URL 下載和 SharedArrayBuffer（解決 CSV 無法下載問題）
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        self.send_header('Access-Control-Allow-Origin', '*')
        # 不快取，確保每次都載入最新 HTML/CSS/JS
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
        else:
            return http.server.SimpleHTTPRequestHandler.do_GET(self)

if __name__ == "__main__":
    # Ensure current directory is served
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), ConfigHandler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        print("Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
