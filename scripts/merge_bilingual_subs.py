#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 B 站下载的双语字幕（en-US + zh-Hans / ai-zh）合并成"中文在上、英文在下"的 ASS 字幕。

用法::

    python scripts/merge_bilingual_subs.py "<字幕目录>"
    python scripts/merge_bilingual_subs.py "<字幕目录>" --zh ai --fmt ass
    python scripts/merge_bilingual_subs.py "<字幕目录>" --outdir out --only p14

设计要点
--------
1. en-US.srt 是时间轴母版，它带真正的句子标点，用它切出"句子"。
2. 中文按句子整段挂接，绝不在词中间切断：
   - zh-Hans 与 en-US 的分句表一一对应，按标点把它的每条字幕拆成小句再对齐；
   - ai-zh 是 B 站自己的 AI 字幕，分句更碎，因此整条按中点归属到英文句子里。
3. 找不到中文的子句直接跳过，不硬凑。
4. 只有一句话长得超过两行才拆成两条字幕，且只在标点处拆。

输出：与视频同名的 ``xxx.zh-en.ass``（默认）或 ``.srt``。
"""
from __future__ import annotations

import argparse
import bisect
import math
import os
import re
from dataclasses import dataclass, field
from statistics import median

CUE_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"
)
CJK_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
TERM_EN_RE = re.compile(r"[.!?][\"'”’\)\]]*$")
TERM_ZH = "。！？!?"
SOFT_ZH = "，、；：,;:"


# ------------------------------------------------------------------ 解析
@dataclass
class Cue:
    start: int
    end: int
    text: str


def _ms(h, m, s, ms) -> int:
    return ((int(h) * 60 + int(m)) * 60 + int(s)) * 1000 + int(ms)


def parse_srt(path: str) -> list[Cue]:
    with open(path, "r", encoding="utf-8-sig", errors="replace") as fh:
        raw = fh.read().replace("\r\n", "\n").replace("\r", "\n")
    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", raw.strip()):
        lines = block.split("\n")
        ti = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if ti is None:
            continue
        m = CUE_RE.search(lines[ti])
        if not m:
            continue
        g = m.groups()
        text = re.sub(r"\s+", " ", " ".join(ln.strip() for ln in lines[ti + 1:])).strip()
        if text:
            cues.append(Cue(_ms(*g[0:4]), _ms(*g[4:8]), text))
    cues.sort(key=lambda c: c.start)
    return cues


# -------------------------------------------------------------- 英文分句
def split_en_sentences(text: str) -> list[str]:
    """按句末标点切句，标点保留在句子里。"""
    out, start = [], 0
    for m in re.finditer(r"[.!?]+[\"'”’\)\]]*(?=\s|$)", text):
        out.append(text[start:m.end()].strip())
        start = m.end()
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return [f for f in out if f]


def word_times(cue: Cue) -> list[tuple[str, int, int]]:
    """把一条字幕按词长比例分配成带时间的词。"""
    words = cue.text.split()
    if not words:
        return []
    weights = [len(w) + 1 for w in words]
    total = sum(weights)
    span = max(1, cue.end - cue.start)
    acc, out = 0, []
    for w, wt in zip(words, weights):
        s = cue.start + span * acc // total
        acc += wt
        e = cue.start + span * acc // total
        out.append((w, s, e))
    return out


def style_of(cues: list[Cue]) -> str:
    """句子级字幕（一条一句、整段无标点）还是滚动式字幕（5 秒一条、断句落在句中间）。"""
    if not cues:
        return "rolling"
    text = " ".join(c.text for c in cues)
    ends = len(re.findall(r"[.!?](?=\s|$)", text))
    return "sentence" if ends / len(cues) < 0.45 else "rolling"


# ---------------------------------------------------------------- 中文处理
def split_zh_clauses(text: str) -> list[str]:
    out, start = [], 0
    for i, ch in enumerate(text):
        if ch in "。！？；，、：,;:":
            out.append(text[start:i + 1].strip())
            start = i + 1
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return [f for f in out if f]


def zw(text: str) -> float:
    """中文显示宽度（全角字 = 1）。"""
    return sum(1.0 if CJK_RE.match(c) else (0.0 if c.isspace() else 0.55) for c in text)


def group_atoms(atoms: list[str], k: int, targets: list[float]) -> list[str]:
    """把中文小句合并成 k 组，组宽按 targets 比例。"""
    if k <= 0:
        return []
    if k == 1:
        return ["".join(atoms)]
    if len(atoms) < k:
        atoms = list(atoms)
        while len(atoms) < k:
            i = max(range(len(atoms)), key=lambda j: len(atoms[j]))
            if len(atoms[i]) < 4:
                break
            cut = len(atoms[i]) // 2
            atoms[i:i + 1] = [atoms[i][:cut], atoms[i][cut:]]
        return atoms
    total = sum(targets) or 1.0
    want = [t / total * sum(zw(a) for a in atoms) for t in targets]
    groups, cur, cur_w, gi = [], [], 0.0, 0
    for atom in atoms:
        w = zw(atom)
        hard = atom and atom[-1] in "。！？；"
        if cur and gi < k - 1 and (cur_w + w / 2 > want[gi] or (hard and cur_w >= want[gi] * 0.7)):
            groups.append("".join(cur))
            cur, cur_w, gi = [], 0.0, gi + 1
        cur.append(atom)
        cur_w += w
    if cur:
        groups.append("".join(cur))
    while len(groups) > k:
        groups[-2] += groups[-1]
        groups.pop()
    while len(groups) < k:
        groups.append("")
    return groups


# ---------------------------------------------------------------- 句子模型
@dataclass
class Sent:
    start: int
    end: int
    en: str
    zh: str = ""
    pauses: list[int] = field(default_factory=list)


def build_sentences(en: list[Cue], zh_kind: str, zh: list[Cue]) -> list[Sent]:
    """zh_kind: 'ai'（ai-zh，整条归属）或 'hans'（zh-Hans，逐句对齐）。"""
    style = style_of(en)

    if style == "sentence":
        # 一条字幕本来就是一句：直接一条一单位
        sents = [Sent(c.start, c.end, c.text) for c in en]
        if zh_kind == "hans":
            for i, s in enumerate(sents):
                if i < len(zh):
                    s.zh = zh[i].text
        for i, c in enumerate(en):
            sents[i].pauses = [wt[2] for wt in word_times(c)
                               if re.search(r"[,;:!?.]$", wt[0])]
    else:
        # 每条字幕切成句片，跨条未完结的句片与下一条粘连
        per_cue: dict[int, list[tuple[str, int]]] = {}
        for i, cue in enumerate(en):
            pos = 0
            for f in split_en_sentences(cue.text):
                off = cue.text.find(f, pos)
                off = pos if off < 0 else off
                per_cue.setdefault(i, []).append((f, off))
                pos = off + len(f)
        chunks: list[list[tuple[int, int]]] = []
        buf: list[tuple[int, int]] = []
        for ci, items in per_cue.items():
            for fi, (f, _off) in enumerate(items):
                buf.append((ci, fi))
                if TERM_EN_RE.search(f):
                    chunks.append(buf)
                    buf = []
        if buf:
            chunks.append(buf)

        zh_groups: dict[tuple[int, int], str] = {}
        if zh_kind == "hans":
            for ci, items in per_cue.items():
                ztext = zh[ci].text if ci < len(zh) else ""
                parts = group_atoms(split_zh_clauses(ztext), len(items),
                                    [zw(f) for f, _o in items])
                for fi, part in enumerate(parts):
                    zh_groups[(ci, fi)] = part

        sents = []
        for grp in chunks:
            (fci, ffi), (lci, lfi) = grp[0], grp[-1]
            c0, c1 = en[fci], en[lci]
            off0 = per_cue[fci][ffi][1]
            s = c0.start + (c0.end - c0.start) * off0 // max(1, len(c0.text))
            ltxt, loff = per_cue[lci][lfi]
            off1 = loff + len(ltxt)
            e = c1.start + (c1.end - c1.start) * off1 // max(1, len(c1.text))
            if e <= s:
                e = s + 400
            en_text = re.sub(r"\s+", " ", " ".join(per_cue[ci][fi][0] for ci, fi in grp))
            zh_text = "".join(zh_groups.get(k, "") for k in grp) if zh_kind == "hans" else ""
            pauses = []
            for ci, fi in grp:
                for w, _ws, we in word_times(en[ci]):
                    if re.search(r"[,;:!?.]$", w):
                        pauses.append(we)
            sents.append(Sent(s, e, en_text, zh_text, pauses))

    if zh_kind == "ai":
        _attach_ai(sents, zh)
    return sents


def _explode(ai: list[Cue]) -> list[tuple[str, int, int]]:
    """把 ai-zh 的大条在中文句号处拆细，并按字数比例分配时间。

    返回 (文本, 起, 止) 列表。拆细后做全局对齐会准得多。
    B 站 AI 有时会把同一句连写两条，这里顺手把相邻的重复句去掉。
    """
    out: list[tuple[str, int, int]] = []
    for c in ai:
        text = c.text.strip()
        if not text:
            continue
        chunks = [x.strip() for x in re.split(r"(?<=[。！？])", text) if x.strip()]
        if len(chunks) <= 1:
            if out and _is_dupe(out[-1][0], text):
                continue
            out.append((text, c.start, c.end))
            continue
        weights = [max(1.0, zw(x)) for x in chunks]
        total = sum(weights)
        acc = 0.0
        for ch, w in zip(chunks, weights):
            a = c.start + (c.end - c.start) * acc / total
            acc += w
            b = c.start + (c.end - c.start) * acc / total
            if not (out and _is_dupe(out[-1][0], ch)):
                out.append((ch, int(a), int(b)))
    return out


def _is_dupe(prev: str, cur: str) -> bool:
    """相邻两条内容重复（AI 轨常见的连写）时返回 True。只在整句相同的时候合并。"""
    a = re.sub(r"[，。！？、；：\s]", "", prev)
    b = re.sub(r"[，。！？、；：\s]", "", cur)
    return len(b) >= 4 and a == b



def _attach_ai(sents: list[Sent], ai: list[Cue]) -> None:
    """把中文轨单调地分配到英文句子上（动态规划）。

    ai-zh 与 en-US 是两条独立生成的轨道：分句粒度不同，局部还会有 1~3 秒的
    漂移。这里不按时间硬切，而是找一条"每句中文字数与英文字数成比例"的
    单调最优分配，既不会把整句中文塞进上一句，也不会让中文重复。
    """
    if not sents:
        return
    pieces = _explode(ai)
    n, m = len(sents), len(pieces)
    if m == 0:
        return

    en_len = [max(1, len(s.en)) for s in sents]
    dur = [max(200, s.end - s.start) for s in sents]
    tot_chars = sum(zw(t) for t, _a, _b in pieces)
    alpha = tot_chars / max(1, sum(en_len))
    zh_w = [max(0.5, zw(t)) for t, _a, _b in pieces]
    pc_start = [st for _t, st, _e in pieces]
    pc_dur = [max(100, en - st) for _t, st, en in pieces]
    pref = [0.0]
    for w in zh_w:
        pref.append(pref[-1] + w)

    INF = float("inf")
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
    back: list[list[int]] = [[-1] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    MAXB = 6
    for i in range(1, n + 1):
        si, ei, di = sents[i - 1].start, sents[i - 1].end, dur[i - 1]
        want = alpha * en_len[i - 1]
        for j in range(m + 1):
            # 这句没有分到中文
            if dp[i - 1][j] + 1.0 < dp[i][j]:
                dp[i][j] = dp[i - 1][j] + 1.0
                back[i][j] = 0
            for L in range(1, min(MAXB, j) + 1):
                j0 = j - L
                base = dp[i - 1][j0]
                if base == INF:
                    continue
                chars = pref[j] - pref[j0]
                cost = abs(chars - want) / max(1.0, want)
                ov = 0
                for k in range(j0, j):
                    ov += max(0, min(ei, pc_start[k] + pc_dur[k]) - max(si, pc_start[k]))
                span = sum(pc_dur[j0:j])
                cost += 0.4 * (1 - ov / max(1, span))
                if base + cost < dp[i][j]:
                    dp[i][j] = base + cost
                    back[i][j] = L

    assign: list[list[int]] = [[] for _ in range(n)]
    j = m
    for i in range(n, 0, -1):
        L = back[i][j]
        if L is None or L < 0:
            L = 0
        if L:
            assign[i - 1] = list(range(j - L, j))
        j -= L
    if j:                       # 兜底：剩余的都挂到最后一句
        assign[-1].extend(range(0, j))

    for s, idxs in zip(sents, assign):
        out: list[str] = []
        for k in idxs:
            text, st, _e = pieces[k]
            if out and out[-1][-1:] not in TERM_ZH + SOFT_ZH and _near_pause(s.pauses, st):
                out.append("，")
            out.append(text)
        s.zh = "".join(out)


def _near_pause(pauses: list[int], t: int, tol: int = 380) -> bool:
    if not pauses:
        return False
    k = bisect.bisect_left(pauses, t)
    near = 10 ** 9
    if k > 0:
        near = abs(pauses[k - 1] - t)
    if k < len(pauses):
        near = min(near, abs(pauses[k] - t))
    return near <= tol


# ---------------------------------------------------------------- 排版
def clean_zh(text: str) -> str:
    """去空白、去首尾多余标点；不补句号（补句号由 layout 决定，只补在句尾）。"""
    text = re.sub(r"\s+", "", text)
    return text.strip("，、；：,;: ")


def cut_at(text: str, frac: float, hard: str, soft: str, min_side: int = 2) -> int | None:
    """在 fraction 附近找标点切点，找不到就返回 None（宁可不切）。"""
    L = len(text)
    target = L * frac
    window = max(6, int(L * 0.3))
    cands = [i + 1 for i, ch in enumerate(text) if ch in hard]
    if not cands:
        cands = [i + 1 for i, ch in enumerate(text) if ch in soft]
    cands = [p for p in cands if min_side <= p <= L - min_side]
    if not cands:
        return None
    best = min(cands, key=lambda p: abs(p - target))
    return best if abs(best - target) <= window else None


_PARTICLES = "的了是在和并但而就都也很将会把被对从给时又还"
_CONJ = ("因为", "所以", "如果", "但是", "然后", "并且", "而且", "或者", "不过",
         "因此", "这样", "这就", "同时", "这时", "这里", "这种", "其中", "比如")


def cut_zh_loose(text: str, frac: float) -> int | None:
    """没有标点可用时的下策：在虚词/连词处分句，再不行就按字数切。"""
    L = len(text)
    target = L * frac
    win = max(4, int(L * 0.2))
    cands = [i + 1 for i, ch in enumerate(text) if ch in TERM_ZH + SOFT_ZH]
    for i in range(1, L):
        if text[i - 1] in _PARTICLES:
            cands.append(i)
        if text[i:i + 2] in _CONJ:
            cands.append(i)
    cands = [c for c in cands if 3 <= c <= L - 3 and abs(c - target) <= win]
    if cands:
        return min(cands, key=lambda c: abs(c - target))
    return int(round(target)) if 4 <= target <= L - 4 else None


def _split_once(a: int, b: int, en: str, zh: str,
                max_zh: float = 62.0, max_en: int = 190) -> list[tuple[int, int, str, str]]:
    """过长的一对中英文，在标点处切成两半。

    两边都要能切才切：中文找不到标点就整条保留，绝不在词中间下刀。
    实在长到没边（超过两屏）才退一步用虚词/连词位置切。
    """
    n = max(math.ceil(max(zw(zh), 1e-6) / max_zh),
            math.ceil(len(en) / max_en) if max_en else 1)
    if n < 2:
        return [(a, b, en, zh)]
    zc = None
    if zh:
        zc = cut_at(zh, 1 / n, TERM_ZH, SOFT_ZH)
        if zc is None:
            zc = cut_zh_loose(zh, 1 / n)
        if zc is None:
            return [(a, b, en, zh)]
        frac = zc / len(zh)
    else:
        frac = 1 / n
    ec = cut_at(en, frac, ",;:!?.", " ", min_side=8)
    if ec is None:
        return [(a, b, en, zh)]
    t = a + int((b - a) * frac)
    return [(a, t, en[:ec].strip(), zh[:zc].strip() if zc else zh),
            (t, b, en[ec:].strip(), zh[zc:].strip() if zc else "")]


def layout(sents: list[Sent], max_zh: float = 62.0, max_en: int = 190) -> list[Sent]:
    units: list[Sent] = []
    for s in sents:
        en = re.sub(r"\s+", " ", s.en).strip()
        zh = clean_zh(s.zh)
        if not en and not zh:
            continue
        queue = [(s.start, s.end, en, zh)]
        parts: list[tuple[int, int, str, str]] = []
        while queue:
            item = queue.pop(0)
            if len(parts) + len(queue) >= 4:      # 一条字幕最多拆 4 段
                parts.append(item)
                continue
            pieces = _split_once(*item, max_zh=max_zh, max_en=max_en)
            if len(pieces) == 1:
                parts.append(pieces[0])
            else:
                queue[:0] = pieces
        if parts:
            a, b, e, z = parts[-1]
            if z and z[-1] not in TERM_ZH:
                parts[-1] = (a, b, e, z + "。")
        units.extend(Sent(a, b, e, z) for a, b, e, z in parts)
    units.sort(key=lambda u: u.start)
    for i in range(1, len(units)):
        if units[i].start < units[i - 1].end:
            units[i].start = units[i - 1].end
    return [u for u in units if u.end > u.start and (u.en or u.zh)]


# ---------------------------------------------------------------- 输出
def ass_time(ms: int) -> str:
    h, rest = divmod(max(0, ms), 3600000)
    m, rest = divmod(rest, 60000)
    s, cs = divmod(rest, 1000)
    return f"{h:d}:{m:02d}:{s:02d}.{cs // 10:02d}"


def ass_escape(t: str) -> str:
    return t.replace("\\", "＼").replace("{", "｛").replace("}", "｝")


ASS_TPL = """[Script Info]
; 中英双语字幕 - merge_bilingual_subs.py
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ZH,{zh_font},{zh_size},&H00FFFFFF,&H000000FF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,{outline},1.0,2,110,110,{margin},1
Style: EN,{en_font},{en_size},&H00DCDCDC,&H000000FF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,{outline2},0.8,2,110,110,{margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def write_ass(units: list[Sent], path: str, cfg: "Config") -> None:
    head = ASS_TPL.format(
        zh_font=cfg.zh_font, en_font=cfg.en_font,
        zh_size=cfg.zh_size, en_size=cfg.en_size,
        outline=cfg.outline, outline2=round(max(1.0, cfg.outline - 0.8), 1),
        margin=cfg.margin_v,
    )
    ztag = "{\\fs%d}" % cfg.zh_size
    etag = "{\\fs%d\\fn%s\\b0}" % (cfg.en_size, cfg.en_font)
    lines = [head]
    for u in units:
        body = (ztag + ass_escape(u.zh)) if u.zh else ""
        if u.en:
            body += ("\\N" if body else "") + etag + ass_escape(u.en)
        lines.append(f"Dialogue: 0,{ass_time(u.start)},{ass_time(u.end)},ZH,,0,0,0,,{body}")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")


def srt_time(ms: int) -> str:
    h, rest = divmod(max(0, ms), 3600000)
    m, rest = divmod(rest, 60000)
    s, ms2 = divmod(rest, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms2:03d}"


def write_srt(units: list[Sent], path: str) -> None:
    out, i = [], 1
    for u in units:
        body = "\n".join(x for x in (u.zh, u.en) if x)
        if not body:
            continue
        out.append(f"{i}\n{srt_time(u.start)} --> {srt_time(u.end)}\n{body}\n")
        i += 1
    with open(path, "w", encoding="utf-8-sig", newline="\r\n") as fh:
        fh.write("\n".join(out))


# ------------------------------------------------------------------- CLI
@dataclass
class Config:
    zh_font: str = "Microsoft YaHei"
    en_font: str = "Segoe UI"
    zh_size: int = 56
    en_size: int = 36
    outline: float = 2.4
    margin_v: int = 46
    max_zh: float = 62.0
    max_en: int = 190


def find_pairs(root: str) -> dict[str, dict[str, str]]:
    table: dict[str, dict[str, str]] = {}
    for fn in sorted(os.listdir(root)):
        m = re.match(r"^(?P<base>.+?)\.(?P<kind>en-US|zh-Hans|ai-zh)\.srt$", fn)
        if m:
            table.setdefault(m.group("base"), {})[m.group("kind")] = os.path.join(root, fn)
    return table


def run(root: str, zh: str = "auto", fmt: str = "ass", suffix: str = ".zh-en",
        outdir: str | None = None, cfg: Config | None = None,
        only: str | None = None, quiet: bool = False) -> dict:
    cfg = cfg or Config()
    pairs = find_pairs(root)
    if only:
        rx = re.compile(only, re.I)
        pairs = {k: v for k, v in pairs.items() if rx.search(k)}
    outdir = outdir or root
    os.makedirs(outdir, exist_ok=True)
    stats = {"files": 0, "cues": 0, "skipped": []}
    for base, files in sorted(pairs.items()):
        if zh == "hans":
            kind = "zh-Hans"
        elif zh == "ai":
            kind = "ai-zh"
        else:
            kind = "ai-zh" if "ai-zh" in files else "zh-Hans"
        if "en-US" not in files:
            if kind not in files:
                stats["skipped"].append((base, "没有字幕"))
                continue
            # 没有英文轨：退化为纯中文字幕，仍然按同一套排版输出
            zhc = parse_srt(files[kind])
            units = [Sent(c.start, c.end, "", clean_zh(c.text) or c.text) for c in zhc]
            stats["files"] += 1
            stats["cues"] += len(units)
            stats.setdefault("zh_only", []).append(base)
            target = os.path.join(outdir, base + suffix)
            if fmt in ("ass", "both"):
                write_ass(units, target + ".ass", cfg)
            if fmt in ("srt", "both"):
                write_srt(units, target + ".srt")
            continue
        if kind not in files:
            stats["skipped"].append((base, "没有 " + kind))
            continue
        en = parse_srt(files["en-US"])
        zhc = parse_srt(files[kind])
        if not en or not zhc:
            stats["skipped"].append((base, "字幕为空"))
            continue
        sents = build_sentences(en, "ai" if kind == "ai-zh" else "hans", zhc)
        units = layout(sents, cfg.max_zh, cfg.max_en)
        stats["files"] += 1
        stats["cues"] += len(units)
        target = os.path.join(outdir, base + suffix)
        if fmt in ("ass", "both"):
            write_ass(units, target + ".ass", cfg)
        if fmt in ("srt", "both"):
            write_srt(units, target + ".srt")
    if not quiet:
        print(f"合并 {stats['files']} 集，共 {stats['cues']} 条字幕 -> {outdir}")
        for b in stats.get("zh_only", []):
            print("  仅中文(缺英文轨):", b[:80])
        for b, why in stats["skipped"]:
            print("  跳过:", b[:80], "-", why)
    return stats


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="合并中英字幕为双语 ASS")
    ap.add_argument("root", help="包含 *.en-US.srt 的目录")
    ap.add_argument("--zh", default="auto", choices=["auto", "ai", "hans"],
                    help="中文来源：ai=ai-zh（推荐），hans=zh-Hans，auto=有 ai 就用 ai")
    ap.add_argument("--fmt", default="ass", choices=["ass", "srt", "both"])
    ap.add_argument("--suffix", default=".zh-en")
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--only", default=None, help="只处理文件名匹配该正则的集数")
    ap.add_argument("--zh-size", type=int, default=56)
    ap.add_argument("--en-size", type=int, default=36)
    ap.add_argument("--zh-font", default="Microsoft YaHei")
    ap.add_argument("--en-font", default="Segoe UI")
    ap.add_argument("--margin-v", type=int, default=46)
    ap.add_argument("--max-zh", type=float, default=62.0, help="每条字幕中文最多几行×1 行宽")
    ap.add_argument("--max-en", type=int, default=190)
    a = ap.parse_args(argv)
    cfg = Config(zh_font=a.zh_font, en_font=a.en_font, zh_size=a.zh_size,
                 en_size=a.en_size, margin_v=a.margin_v,
                 max_zh=a.max_zh, max_en=a.max_en)
    run(a.root, a.zh, a.fmt, a.suffix, a.outdir, cfg, a.only)


if __name__ == "__main__":
    main()
