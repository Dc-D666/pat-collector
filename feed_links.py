# -*- coding: utf-8 -*-
"""
提取腾讯频道帖子内嵌链接（urlContent 元素，如 AI 应用分享卡片）。

原理: tencent-channel-cli 的 get-feed-detail 展示时丢弃 urlContent 元素，
但底层 MCP 网关 (graph.qq.com/mcp_gateway/open_platform_agent_mcp/mcp) 的
原始响应中包含完整字段。本脚本把 CLI 的请求转发到本地代理捕获原始响应，
从中提取所有 urlContent.url。

用法:
    python feed_links.py <feed_id> [channel_id]
    例: python feed_links.py B_6452cd69d7f004001441152187377287410X60 658072095
"""
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.request

TARGET = "https://graph.qq.com/mcp_gateway/open_platform_agent_mcp/mcp"
CAPTURED = []

# AI 轻应用链接特征：https://pd.qq.com/launch_app/<appId>
# 帖子里的 urlContent 除轻应用卡片外还可能是普通网页/视频/分享链接等，
# 一律按此特征过滤，只保留真正的轻应用（2026-08-21 修复：此前会把任意链接都识别上来）。
APP_URL_RE = re.compile(r"^https://pd\.qq\.com/launch_app/[a-zA-Z0-9-]+(?:[?#].*)?$")


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            pass  # CLI 断开连接的正常噪音

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        req = urllib.request.Request(TARGET, data=body, method="POST")
        for k, v in self.headers.items():
            if k.lower() not in ("host", "content-length", "connection", "accept-encoding"):
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                rbody = resp.read()
                CAPTURED.append(rbody.decode("utf-8", "replace"))
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() not in ("transfer-encoding", "content-length", "connection"):
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(rbody)))
                self.end_headers()
                self.wfile.write(rbody)
        except Exception:
            self.send_response(502)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def log_message(self, *a):
        pass


def extract_urls(resp_text):
    """从 MCP 原始响应中提取 AI 轻应用链接 (displayText, url)

    只保留 pd.qq.com/launch_app/ 形式的轻应用链接；urlContent 里的普通网页/
    视频/分享链接一律过滤掉。
    """
    found = []
    try:
        data = json.loads(resp_text)
    except Exception:
        return found

    def walk(o):
        if isinstance(o, dict):
            uc = o.get("urlContent")
            if isinstance(uc, dict) and uc.get("url"):
                url = uc["url"]
                if APP_URL_RE.match(url):
                    found.append((uc.get("displayText", ""), url))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)
    # 兜底: 直接正则抓 launch_app 链接（同样按轻应用特征过滤，防截断/杂散匹配）
    for m in re.finditer(r"https://pd\.qq\.com/launch_app/[a-zA-Z0-9-]+", resp_text):
        url = m.group(0)
        if APP_URL_RE.match(url):
            found.append(("", url))
    return found


def main():
    if len(sys.argv) < 2:
        print("用法: python feed_links.py <feed_id> [channel_id]")
        return
    feed_id = sys.argv[1]
    channel_id = sys.argv[2] if len(sys.argv) > 2 else ""

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    cli = shutil.which("tencent-channel-cli")
    if not cli:
        print("错误: 未找到 tencent-channel-cli")
        return
    # 用 list 参数形式（无 shell），避免 feed_id/channel_id 拼接进 shell 命令造成命令注入
    # （--feed-id=X 等号形式与 Node 侧 qq/proxy.js 的 CLI 调用约定一致）
    cmd = [cli, "feed", "get-feed-detail", "--feed-id=" + feed_id]
    if channel_id:
        cmd.append("--channel-id=" + channel_id)
    env = dict(os.environ)
    env["QQ_AI_CONNECT_MCP_URL"] = f"http://127.0.0.1:{port}/mcp"
    subprocess.run(cmd, env=env, capture_output=True)
    server.shutdown()

    seen = set()
    for resp in CAPTURED:
        for text, url in extract_urls(resp):
            if url in seen:
                continue
            seen.add(url)
            print(f"{text}\t{url}" if text else url)


if __name__ == "__main__":
    main()
