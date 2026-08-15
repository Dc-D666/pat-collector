#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
姓名 → 拼音首字母候选（方案二：昵称=姓名缩写，多音字展开全部读音供选择）。
用法: python3 pinyin_initials.py <姓名>
输出: {"name": "单依纯", "candidates": ["DYC", "CYC", "SYC"]}

规则:
- 中文按 pypinyin heteronym 展开全部读音首字母（如 单依纯 → D/S/C + Y + C）
- 连续 ASCII 字母视为一个英文词，取首字母（如 Mike → M）
- 数字/空格/符号跳过
- 候选最多 6 个，去重保序
"""
import itertools
import json
import sys

try:
    from pypinyin import pinyin, Style
except ImportError:
    pinyin = None
    Style = None


def char_initials(ch):
    """返回单字符的全部首字母候选（大写集合）；无候选返回空集"""
    if ch.isspace() or ch.isdigit() or not ch.isalpha():
        return set()
    if ch.isascii():
        return {ch.upper()}
    if pinyin is None:
        return set()
    try:
        readings = pinyin(ch, style=Style.FIRST_LETTER, heteronym=True)
        letters = set()
        for r in (readings[0] if readings else []):
            r = (r or '').strip()
            if not r:
                continue
            if len(r) == 1 and r.isalpha():
                letters.add(r.upper())
            elif r.isalpha():
                letters.add(r[0].upper())  # 未收录字原样返回等异常情况取首字母
        return letters
    except Exception:
        return set()


def candidates(name):
    parts = []
    buf = ''
    for ch in str(name or ''):
        if ch.isascii() and ch.isalpha():
            buf += ch
            continue
        if buf:
            parts.append({buf[0].upper()})
            buf = ''
        s = char_initials(ch)
        if s:
            parts.append(sorted(s))
    if buf:
        parts.append({buf[0].upper()})
    if not parts:
        return []
    out = []
    for combo in itertools.product(*parts):
        s = ''.join(combo)
        if s not in out:
            out.append(s)
        if len(out) >= 6:
            break
    return out


if __name__ == '__main__':
    name = sys.argv[1] if len(sys.argv) > 1 else ''
    print(json.dumps({'name': name, 'candidates': candidates(name)}, ensure_ascii=False))
