# -*- coding: utf-8 -*-
"""
腾讯频道短链解析: https://pd.qq.com/s/xxx -> 长链 / 帖子ID(BID)

原理: 短链无 UA 请求会触发 EdgeOne JS 挑战, 但带浏览器 User-Agent 时返回
Nuxt SSR 页面, 页面 __NUXT_DATA__ 内嵌完整分享解析数据 (link_detail.long_url
与 feedId), business_data_json 是 base64 编码的 feed_id。

用法:
    python share_resolve.py https://pd.qq.com/s/55zd3yjkz
"""
import base64
import json
import re
import subprocess
import sys

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def fetch(url):
    """EdgeOne 按 TLS 指纹识别客户端, Python urllib 会被发挑战页, 用 curl 拉取"""
    out = subprocess.run(
        ["curl", "-s", "-A", UA, url], capture_output=True, timeout=60)
    return out.stdout.decode("utf-8", "replace")


def walk(o, key, out, data):
    """Nuxt payload 里 dict 值是数组索引(如 "feedId":229), 需解析到 data[idx]"""
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key:
                val = v
                if isinstance(val, int) and 0 <= val < len(data):
                    val = data[val]
                if isinstance(val, str) and val:
                    out.add(val)
            walk(v, key, out, data)
    elif isinstance(o, list):
        for v in o:
            walk(v, key, out, data)


def resolve(short_url):
    html = fetch(short_url)

    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        print("错误: 未找到 __NUXT_DATA__ (可能触发了反爬挑战, 换 UA 试试)")
        return
    data = json.loads(m.group(1))

    feed_ids, urls = set(), set()
    walk(data, "feedId", feed_ids, data)
    walk(data, "long_url", urls, data)
    walk(data, "url", urls, data)

    # business_data_json 兜底: base64 -> {"feed_id":"B_xxx"}
    raw = html
    m2 = re.search(r'"business_data_json":"([A-Za-z0-9+/=]+)"', raw)
    if m2:
        try:
            dec = base64.b64decode(m2.group(1)).decode("utf-8", "replace")
            m3 = re.search(r'"feed_id"\s*:\s*"(B_[^"]+)"', dec)
            if m3:
                feed_ids.add(m3.group(1))
        except Exception:
            pass

    print("短链:", short_url)
    for u in sorted(urls):
        if "qunpro/share" in u or "/post/" in u or "/g/" in u:
            print("长链:", u)
    for f in sorted(feed_ids):
        print("BID :", f)
    if not feed_ids and not urls:
        print("未解析到目标 (页面里没有分享数据)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python share_resolve.py <pd.qq.com/s/ 短链>")
    else:
        resolve(sys.argv[1])
