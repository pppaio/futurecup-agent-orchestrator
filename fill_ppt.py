# -*- coding: utf-8 -*-
"""按官方模版填充讲解 PPT：封面/目录/节标题/内容页/谢谢。"""
import copy, sys
sys.stdout.reconfigure(encoding='utf-8')
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

TPL = r"C:\Users\Gandafu\.dsh\attachments\v1\files\72\72792fe34cf49d7c0b047ba4970876fca78c54d751b5db1eff40ded037ce40e9\2026未来杯PPT模版.pptx"
OUT = r"C:\Users\Gandafu\Desktop\kuangjia\docs\讲解PPT-按模版.pptx"

prs = Presentation(TPL)

# 参考几何（从模版原页读取）
def shape_geo(s):
    out = {}
    for sh in s.shapes:
        if sh.has_text_frame:
            out[sh.name] = (sh.left, sh.top, sh.width, sh.height)
    return out

s1 = prs.slides[0]
s2 = prs.slides[1]
s3 = prs.slides[2]
s4 = prs.slides[3]
geo_cover_title = shape_geo(s1).get('文本框 3')
geo_cover_meta = shape_geo(s1).get('文本框 2')
geo_toc = shape_geo(s2).get('文本框 2')
geo_sect = shape_geo(s3).get('文本框 3')
geo_content_title = shape_geo(s4).get('文本框 2')

# 取模版字体（思源黑体 Bold 等）
def font_of(sh):
    for p in sh.text_frame.paragraphs:
        for r in p.runs:
            col = None
            try:
                if r.font.color and r.font.color.type is not None:
                    col = r.font.color.rgb
            except Exception:
                col = None
            return r.font.name, r.font.size, r.font.bold, col
    return None

font_cover_title = font_of(s1.shapes[0])
font_cover_meta = font_of(s1.shapes[1])
font_sect = font_of(s3.shapes[0])
font_content_title = font_of(s4.shapes[0])

# ---------- 工具函数 ----------
def set_text(sh, lines, size=None, bold=None, font_name=None, align=None, color=None):
    tf = sh.text_frame
    tf.word_wrap = True
    for i, para in enumerate(tf.paragraphs):
        for run in para.runs:
            run.text = ''
    first = True
    for ln in lines:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        if align is not None:
            p.alignment = align
        r = p.add_run()
        r.text = ln
        f = r.font
        if font_name:
            f.name = font_name
        if size:
            f.size = Pt(size)
        if bold is not None:
            f.bold = bold
        if color is not None:
            f.color.rgb = color
    # 清掉多余段落
    while len(tf.paragraphs) > len(lines):
        p = tf.paragraphs[len(lines)]._p
        p.getparent().remove(p)

def add_box(slide, left, top, width, height, lines, size=14, bold=False, font_name='思源黑体 Normal', color=RGBColor(0x33, 0x33, 0x33), bullet=False):
    from pptx.enum.shapes import MSO_SHAPE
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    first = True
    for ln in lines:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.space_after = Pt(6)
        p.line_spacing = 1.15
        txt = ('• ' + ln) if bullet else ln
        r = p.add_run()
        r.text = txt
        r.font.name = font_name
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
    return tb

# ---------- 删除模版说明页 P5（"大会PPT提示"）：安全的做法是从 sldIdLst 中移除引用，
# 保留部件（未引用的幻灯片不会被播放），避免 partname 冲突 ----------
sldIdLst = prs.slides._sldIdLst
all_ids = list(sldIdLst)
p5_id = all_ids[4]      # P5 使用说明（隐藏）
p6_id = all_ids[5]      # P6 谢谢观看
keep_order = all_ids[:2]  # P1封面 P2目录（就地改写）；P3/P4 的模板占位页隐藏，用新增页代替

# ---------- P1 封面 ----------
set_text(prs.slides[0].shapes[0], ['一句话需求', '→ 确定可运行的软件产物'], font_name=font_cover_title[0], size=font_cover_title[1].pt if font_cover_title[1] else 32, bold=True)
set_text(prs.slides[0].shapes[1], ['多智能体编排调度平台', '团队名称：____________    演讲人：____________', '指导教师：____________    学校：____________'], font_name=font_cover_meta[0], size=font_cover_meta[1].pt if font_cover_meta[1] else 20, bold=font_cover_meta[2])

# ---------- P2 目录 ----------
set_text(prs.slides[1].shapes[0], [
    '1 项目概述',
    '     1.1 背景痛点   1.2 切入点与核心主张   1.3 应用范围',
    '2 平台功能（对齐评分五模块）',
    '3 总体架构与 Agent 团队',
    '     3.1 三层架构与事件溯源   3.2 五类角色   3.3 智能调度与多供应商',
    '4 自我循环与结果验证',
    '     4.1 两级判定   4.2 三层循环与退步回滚   4.3 Loop Watchdog',
    '5 实验成效',
    '     5.1 20 条样本实测   5.2 三策略对比   5.3 诚实局限',
    '6 人工介入与可复现',
], font_name=font_cover_meta[0], size=16, bold=False)

# ---------- 后续页构建 ----------
def new_section_slide(title):
    s = prs.slides.add_slide(prs.slide_layouts[3])  # 节标题
    if geo_sect:
        tb = s.shapes.add_textbox(*geo_sect)
        set_text(tb, [title], font_name=font_sect[0], size=font_sect[1].pt if font_sect[1] else 24, bold=True)
    new_ids.append(sldIdLst[-1])
    return s

def new_content_slide(title, bullets, size=14):
    s = prs.slides.add_slide(prs.slide_layouts[2])  # 两栏内容
    if geo_content_title:
        tb = s.shapes.add_textbox(*geo_content_title)
        set_text(tb, [title], font_name=font_content_title[0], size=font_content_title[1].pt if font_content_title[1] else 24, bold=True)
    # 正文两栏：左半右半
    half = len(bullets) // 2 + len(bullets) % 2
    left = bullets[:half]
    right = bullets[half:]
    add_box(s, Inches(0.9), Inches(1.7), Inches(5.7), Inches(5.2), left, size=size, bullet=True)
    if right:
        add_box(s, Inches(6.9), Inches(1.7), Inches(5.7), Inches(5.2), right, size=size, bullet=True)
    new_ids.append(sldIdLst[-1])
    return s

new_ids = []  # 新增页的 sldId（append 在谢谢之后，稍后统一重排顺序）

# --- 1 项目概述 ---
new_section_slide('1 项目概述：能不能跑，机器说了算')
new_content_slide('大模型应用落地的三个断点，与我们的切口', [
    '编排能力薄弱：脚本化流水线，缺条件/循环/异常回退',
    '调度策略单一：串行或广播，无能力画像与动态分配',
    '验证与可信缺失（最致命）：幻觉与错误传播难以收敛',
    '切口：把任务域收窄到「产物可被机器验收」的软件生成',
    '单文件 HTML：运行环境确定 → 能否运行是二值事实',
    '验证是硬事实，不是「另一个大模型看一眼」',
    '可扩展：配置驱动，换配置不改代码（引用核验等场景）',
    '明确不覆盖：审美创意、真实业务系统、跨会话助理',
])

# --- 2 平台功能 ---
new_section_slide('2 平台功能：对齐评分表五模块')
new_content_slide('五个核心模块齐备且逻辑连贯', [
    'Agent 团队定义与管理：AgentProfile（提示词/能力标签/模型/调度指标），动态注册与候选池',
    '工作流编排：JSON DAG——顺序/并行/条件/循环/子工作流，六类节点',
    '智能调度引擎：就绪队列+并发上限，pickAgent 按成功率·速度·成本打分，质量优先/省流双档',
    '工具与外部系统集成：多供应商 LLM 网关（DeepSeek/千问等）+ Playwright 沙箱，界面直接接入 Key',
    '执行监控与结果验证：18 类事件流 + SSE 直推 + 硬验证（非 LLM）+ 软裁判',
    '反馈与自我优化：三层循环（硬修复/评分返工/人工返工）+ 退步回滚 + 版本追溯',
    '零成本可复现：无 API Key 自动进入演示模式（Fake LLM）',
    '20 个命令行 demo + 一键启动 start.bat',
])

# --- 3 架构与角色 ---
new_section_slide('3 总体架构与 Agent 团队')
new_content_slide('三层架构 + 事件溯源（18 类事件）', [
    '前端四页：任务台 / 运行看板 / 核验报告 / 历史记录',
    '编排引擎 Core：解析→调度→执行→验证门控→三层循环→人工介入',
    '可插拔能力层：LLM 网关 / 沙箱 / 打包器',
    '唯一事实来源：append-only events.jsonl',
    '一份事件流 = 日志 + 快照 + 实时监控 + 轨迹统计 + 断点续跑',
    '控制面确定性红线：能写成 if 的判断，绝不交给模型',
    '前端不轮询：SSE 直推；每次模型调用留痕（供应商/模型可审计）',
    '约 5,900 行 TypeScript / 43 文件 / 54 次提交全可追溯',
])
new_content_slide('五类角色（1 个不是 LLM）+ 智能调度', [
    '分析师：需求→可机械验收规格；返工轮读代码+差距+指令→修订规格+具体修改要求',
    '生成者：规格→单文件 HTML；返工轮基于上一版增量修改（不推倒重做）',
    '硬校验器（确定性脚本）：加载/报错/渲染/交互判定——能否运行（阻断）',
    '软裁判：1~5 分+差距；对比历史判进步/退步——未满分自动返工',
    '修复者：错误卡片+摘要→新产物（只喂卡片，控 token）',
    '调度打分：score = w_succ·成功率 + w_speed·速度 + w_cost·便宜度',
    '实测：质量优先选 builder(0.983 vs 0.915)，省流选 builder-flash(0.768 vs 0.417)',
    '多供应商：每角色可独立配模型/供应商/思考强度，调用留痕可审计',
])

# --- 4 自我循环 ---
new_section_slide('4 自我循环与结果验证')
new_content_slide('两级判定：Fast Path / Slow Path', [
    'L1 硬验证（沙箱脚本，非 LLM）：ok = 加载成功 && 零报错 && 渲染非空 && 交互不抛错',
    '失败即回灌：N 条报错 → ≤3 张错误卡片（确定性归约器，禁用 LLM）',
    'L2 软验证（LLM 裁判）：验收条件满足度 1~5 分 + 差距，不阻断交付',
    'L3 人工：最终验收 / 中途干预 / 返工指令',
    '分工：LLM 负责生成与评价好坏，不负责判定能不能跑',
    '质量门控是确定性代码：分数阈值/版本留痕/退步回滚都不是 LLM 决策',
    '错误归一化、调度打分、回滚——全部 if 可写，绝不交给模型',
    '——这是本项目对「AI 使用合理性」的直接回答',
])
new_content_slide('三层循环 + 退步保护 + 版本追溯', [
    '硬修复循环 ≤3 轮：验证失败→错误卡片→修复者→再验证',
    '评分返工循环（默认3轮/上限9）：未达目标分→打包留痕(bundle-vN)→回分析师→生成者增量改→再评分',
    '人工返工循环 ≤5 轮：人工确认点拒绝→带指令回分析师',
    '退步自动回滚：新版比历史最优差→自动回到最优版本再改',
    '人工回滚指令：「返回第一版」→直接从 bundle-v1 恢复该版',
    '裁判对比历史：退步明确指出具体点并降分',
    '带缺陷交付：循环超限输出历史最优版+缺陷报告，绝不假装成功',
    'Loop Watchdog：外部只读观察者（轮次/指纹去重/错误不降→升级）',
])

# --- 5 实验成效 ---
new_section_slide('5 实验成效')
new_content_slide('20 条样本实测 + 三策略消融 + 诚实局限', [
    '20 条样本（5类×4条）：首轮可运行率 95%（19/20）→ 最终 100%（20/20）',
    '唯一首轮失败：贪吃蛇+排行榜（1 条报错），1 轮修复收敛 [1,0]',
    'S1 串行单 Agent：85%　S2 多 Agent 无核验：90%　S3 本方案：100%',
    '结论：软裁判 +5pp，硬验证闭环 +15pp——增益来自对抗，不是 Agent 数量',
    '累计 303 次真实运行 / 109 个版本文件 / p50=203s p95=404s / 约 ¥9.47',
    'L1 只证明「能跑」不证明「好玩」——依赖 canvas 非空等弱信号',
    '样本 20 条、单模型单次采样，结论不可外推；简单域循环触发率低',
    '高难度补充实验已备数据集与命令，受预算限制未跑完，结论留白',
])

# --- 6 人工介入 ---
new_section_slide('6 人工介入与可复现')
new_content_slide('秒级中断 · 人工确认 · 全链可复现', [
    '秒级中断：直接中止在途模型调用与浏览器验证（实测 1ms），被中止节点重新入队',
    '全双工：暂停期间可继续输入，resume 按序注入',
    '人工确认点：交付前暂停——接受，或一句指令返工（回分析师）',
    '「返回第一版」：版本文件直接恢复，作为后续修改基底',
    '历史记录：303 次运行持久落盘，回看/删除/运行中置顶自动刷新',
    '可复现三件套：run.json（模型快照/sha256/错误曲线）+ events.jsonl + hard_report.json',
    'replay 命令完整重放任意一次运行',
    '无 Key 零成本复现：评审无需充值即可验证',
])

# 保存前重排：封面/目录/节/内容 + 新增页（按序） + 谢谢；P5 说明页移出播放序列
desired = keep_order + new_ids + [p6_id]
for sldId in list(sldIdLst):
    sldIdLst.remove(sldId)
for sldId in desired:
    sldIdLst.append(sldId)

prs.save(OUT)
print('已保存:', OUT)
print('展示页数:', len(prs.slides._sldIdLst))
