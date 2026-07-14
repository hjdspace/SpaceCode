---
name: berkshire-shared
description: "AI Berkshire 共享工具库：金融严谨性验证工具（financial_rigor.py）、A股数据获取（ashare_data.py）、雪球爬虫（xueqiu_scraper.py）、股票筛选器（stock_screener.py）、动量回测（momentum_backtest.py）、晨星公允价值（morningstar_fair_value.py）、报告审计（report_audit.py）等。所有 berkshire-* 技能依赖此共享工具。"
---

# AI Berkshire 共享工具库

本技能包包含 AI Berkshire 投研框架的全部共享工具和数据文件。其他 `berkshire-*` 技能通过这些工具进行精确的金融计算、数据获取和报告审计。

## 工具清单

### `tools/financial_rigor.py` — 金融严谨性验证工具
所有计算使用 Python `decimal.Decimal`（精确十进制），杜绝 LLM 心算误差。

| 子命令 | 用途 | 示例 |
|--------|------|------|
| `verify-market-cap` | 市值验算（股价×总股本 vs 报告市值） | `python3 tools/financial_rigor.py verify-market-cap --price 510 --shares 9.11e9 --reported 4.65e12 --currency HKD` |
| `verify-valuation` | 估值验算（PE/PB/ROE/FCF Yield） | `python3 tools/financial_rigor.py verify-valuation --price 510 --eps 23.5 --bvps 120 --fcf-per-share 18 --dividend 2.4` |
| `cross-validate` | 多源交叉验证 | `python3 tools/financial_rigor.py cross-validate --field revenue --values '{"年报": 7518, "Yahoo": 7500}' --unit 亿` |
| `three-scenario` | 三情景估值（乐观/中性/悲观） | `python3 tools/financial_rigor.py three-scenario --base-earnings 100 --growth-low 0.05 --growth-mid 0.10 --growth-high 0.15` |
| `benford` | Benford定律检测 | `python3 tools/financial_rigor.py benford --values '[1234, 2345, 3456]'` |
| `calc` | 精确计算器 | `python3 tools/financial_rigor.py calc --expr '510 * 9.11e9'` |

### `tools/ashare_data.py` — A股数据获取
从东方财富等来源获取A股历史行情和财务数据。

### `tools/xueqiu_scraper.py` — 雪球数据爬虫
从雪球网获取股票实时行情、财务指标和公司基本信息。

### `tools/stock_screener.py` — 股票筛选器
按多条件筛选股票（市值、PE、PB、ROE、行业等）。

### `tools/morningstar_fair_value.py` — 晨星公允价值
获取 Morningstar 公允价值数据，与当前股价对比。

### `tools/momentum_backtest.py` / `tools/momentum_backtest_v2.py` — 动量回测
动量策略历史回测工具。

### `tools/report_audit.py` — 报告审计
对生成的投研报告进行质量审计：检查数据一致性、来源标注、格式规范。

### `tools/financial_rigor.py` — 金融严谨性验证（核心工具）
零外部依赖，仅使用 Python 标准库。要求 Python >= 3.7。

## 数据文件

### `data/fundamentals.json` — 基础财务数据
### `data/watchlist.json` — 观察列表
### `data/morningstar_fair_value_20260519.csv` — 晨星公允价值数据
### `data/correlation_3stocks_2021-2026.csv` — 三股票相关性数据
### `data/cross_asset_10y_2016-2026.csv` — 跨资产10年数据

## 使用方式

其他 `berkshire-*` 技能安装后，本共享工具包位于：
```
.claude/skills/berkshire-shared/tools/financial_rigor.py
.claude/skills/berkshire-shared/data/fundamentals.json
```

在技能中引用工具时，使用相对于会话工作目录的路径：
```bash
python3 .claude/skills/berkshire-shared/tools/financial_rigor.py verify-market-cap --price 510 --shares 9.11e9 --reported 4.65e12 --currency HKD
```

## 研究质量规则

1. **金融数据必须来自至少两个独立来源**，误差>1%须标记
2. **所有计算使用精确十进制工具**，不用 LLM 心算
3. **报告发布前须运行审计工具**：`python3 .claude/skills/berkshire-shared/tools/report_audit.py`
4. **低置信度结论须明确标注**，不使用推测伪装确定性
5. **本项目仅供学习和研究**，不构成任何投资建议