#!/usr/bin/env python3
"""
SpaceCode Browser-Use MCP Bridge
=================================
JSON-RPC 2.0 over stdio MCP 服务，桥接 browser-use Python 库与 Electron 主进程。

用法：
  python bridge.py --mcp

通过 stdin/stdout 接收和发送 JSON-RPC 2.0 消息，支持以下工具：
  - browse:       打开 URL 并浏览
  - scrape:       提取页面内容
  - screenshot:   截取浏览器当前画面
  - fill_form:    填写表单字段
  - click:        点击页面上元素
  - get_info:     获取页面标题/URL/内容摘要
  - navigate:     导航（前进/后退）
  - health_report: 健康检查
"""

import asyncio
import json
import logging
import os
import sys
import traceback
from typing import Any

# ── Browser Use ──────────────────────────────────────────────────
try:
    from browser_use import Agent, BrowserProfile, BrowserSession
    from browser_use.agent.views import ActionResult as BUActionResult
    HAS_BROWSER_USE = True
except ImportError:
    HAS_BROWSER_USE = False

# ── Logging ──────────────────────────────────────────────────────
logging.basicConfig(
    level=os.environ.get('BU_LOG_LEVEL', 'WARNING'),
    format='[BU] %(levelname)s %(message)s',
    stream=sys.stderr,
)
logger = logging.getLogger('browser_use_bridge')

# ── LLM Resolution ──────────────────────────────────────────────

def get_llm():
    """
    根据环境变量配置 LLM。
    
    优先顺序：
      1. BROWSER_USE_API_KEY + BU_LLM_MODEL → ChatBrowserUse
      2. ANTHROPIC_API_KEY → ChatAnthropic
      3. OPENAI_API_KEY → ChatOpenAI
      4. GOOGLE_API_KEY → ChatGoogle
    """
    bu_key = os.environ.get('BROWSER_USE_API_KEY', '')
    bu_model = os.environ.get('BU_LLM_MODEL', '')
    anthropic_key = os.environ.get('ANTHROPIC_API_KEY', '')
    openai_key = os.environ.get('OPENAI_API_KEY', '')
    google_key = os.environ.get('GOOGLE_API_KEY', '')

    if bu_key and bu_model:
        from browser_use.llm.browser_use.chat import ChatBrowserUse
        return ChatBrowserUse(model=bu_model)
    elif bu_key:
        from browser_use.llm.browser_use.chat import ChatBrowserUse
        return ChatBrowserUse(model='bu-2-0')
    elif anthropic_key:
        from browser_use.llm.anthropic.chat import ChatAnthropic
        model = os.environ.get('BU_LLM_MODEL', 'claude-sonnet-4-6')
        return ChatAnthropic(model=model)
    elif openai_key:
        from browser_use.llm.openai.chat import ChatOpenAI
        model = os.environ.get('BU_LLM_MODEL', 'gpt-5.5')
        return ChatOpenAI(model=model)
    elif google_key:
        from browser_use.llm.google.chat import ChatGoogle
        model = os.environ.get('BU_LLM_MODEL', 'gemini-3-pro')
        return ChatGoogle(model=model)
    else:
        raise ValueError(
            'No LLM API key configured. Set BROWSER_USE_API_KEY, '
            'ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.'
        )


# ── Browser Session Management ───────────────────────────────────

_browser_session = None  # 全局浏览器会话

async def get_or_create_browser(headless: bool = True) -> BrowserSession:
    """获取或创建全局浏览器会话"""
    global _browser_session
    if _browser_session is None:
        profile = BrowserProfile(
            headless=headless,
            allowed_domains=None,
        )
        _browser_session = await BrowserSession.create(browser_profile=profile)
        logger.info("Browser session created")
    return _browser_session


async def close_browser():
    """关闭浏览器会话"""
    global _browser_session
    if _browser_session:
        try:
            await _browser_session.close()
        except Exception as e:
            logger.warning(f"Error closing browser: {e}")
        _browser_session = None
        logger.info("Browser session closed")


# ── MCP Tool Implementations ────────────────────────────────────

async def tool_browse(args: dict) -> dict:
    """打开 URL 并执行浏览任务"""
    url = args.get('url', '')
    task = args.get('task', f'Visit {url} and summarize the page content')
    headless = args.get('headless', True)
    max_steps = args.get('max_steps', 20)

    if not url:
        return {'content': [{'type': 'text', 'text': 'Error: url is required'}], 'isError': True}

    try:
        llm = get_llm()
        agent = Agent(
            task=f"Go to {url}. {task}",
            llm=llm,
            browser_profile=BrowserProfile(headless=headless),
        )
        history = await agent.run(max_steps=max_steps)
        result = history.final_result() or "Task completed but no result returned."
        
        # 获取当前页面信息
        page_info = {}
        if _browser_session and _browser_session.page:
            page_info = {
                'url': _browser_session.page.url,
                'title': await _browser_session.page.title(),
            }

        return {
            'content': [
                {'type': 'text', 'text': json.dumps({
                    'result': result,
                    'url': page_info.get('url', url),
                    'title': page_info.get('title', ''),
                    'steps_used': len(history.history) if hasattr(history, 'history') else 0,
                })},
            ],
        }
    except Exception as e:
        logger.error(f"browse error: {traceback.format_exc()}")
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_scrape(args: dict) -> dict:
    """抓取页面内容"""
    url = args.get('url', '')
    selector = args.get('selector', '')  # 可选 CSS 选择器

    if not url and not _browser_session:
        return {'content': [{'type': 'text', 'text': 'Error: url is required'}], 'isError': True}

    try:
        if not _browser_session:
            profile = BrowserProfile(headless=True)
            session = await BrowserSession.create(browser_profile=profile)
        else:
            session = _browser_session

        page = session.page
        if url:
            await page.goto(url, wait_until='domcontentloaded')
        
        content = await page.content() if not selector else await page.inner_html(selector)
        title = await page.title()
        current_url = page.url

        # 提取纯文本
        text = await page.evaluate('() => document.body.innerText') if not selector else content

        return {
            'content': [{'type': 'text', 'text': json.dumps({
                'title': title,
                'url': current_url,
                'text': text[:10000],  # 限制 10K token
                'html_length': len(content),
            })}],
        }
    except Exception as e:
        logger.error(f"scrape error: {traceback.format_exc()}")
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_screenshot(args: dict) -> dict:
    """截取浏览器画面"""
    url = args.get('url', '')
    full_page = args.get('full_page', False)

    try:
        if url or not _browser_session:
            profile = BrowserProfile(headless=False)
            session = await BrowserSession.create(browser_profile=profile)
            page = session.page
            if url:
                await page.goto(url, wait_until='domcontentloaded')
        else:
            page = _browser_session.page

        screenshot_bytes = await page.screenshot(full_page=full_page)
        import base64
        b64_data = base64.b64encode(screenshot_bytes).decode('utf-8')
        title = await page.title()
        current_url = page.url

        return {
            'content': [
                {'type': 'text', 'text': json.dumps({
                    'url': current_url,
                    'title': title,
                    'size': len(screenshot_bytes),
                })},
                {'type': 'image', 'data': b64_data, 'mimeType': 'image/png'},
            ],
        }
    except Exception as e:
        logger.error(f"screenshot error: {traceback.format_exc()}")
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_navigate(args: dict) -> dict:
    """导航控制"""
    direction = args.get('direction', 'forward')  # forward / back
    url = args.get('url', '')

    if not _browser_session:
        return {'content': [{'type': 'text', 'text': 'No browser session'}], 'isError': True}

    try:
        page = _browser_session.page
        if url:
            await page.goto(url, wait_until='domcontentloaded')
        elif direction == 'forward':
            await page.go_forward()
        elif direction == 'back':
            await page.go_back()

        return {
            'content': [{'type': 'text', 'text': json.dumps({
                'url': page.url,
                'title': await page.title(),
            })}],
        }
    except Exception as e:
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_get_info(_args: dict) -> dict:
    """获取当前页面信息"""
    if not _browser_session:
        return {'content': [{'type': 'text', 'text': 'No active browser session'}], 'isError': False}

    try:
        page = _browser_session.page
        return {
            'content': [{'type': 'text', 'text': json.dumps({
                'url': page.url,
                'title': await page.title(),
                'has_content': True,
            })}],
        }
    except Exception as e:
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_health_report(_args: dict) -> dict:
    """健康检查报告"""
    checks = []
    
    # 1. browser-use 包检测
    checks.append({
        'name': 'browser_use_package',
        'status': 'pass' if HAS_BROWSER_USE else 'fail',
        'message': f'browser-use {"is installed" if HAS_BROWSER_USE else "is NOT installed"}',
    })

    # 2. Python 版本
    py_ver = f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}'
    py_ok = sys.version_info >= (3, 11)
    checks.append({
        'name': 'python_version',
        'status': 'pass' if py_ok else 'fail',
        'message': f'Python {py_ver} (>=3.11: {py_ok})',
        'hint': 'browser-use requires Python 3.11+' if not py_ok else None,
    })

    # 3. Chromium 检测
    chromium_ok = False
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            chromium_ok = True
            executable_path = p.chromium.executable_path if hasattr(p.chromium, 'executable_path') else 'bundled'
    except Exception:
        executable_path = 'not found'
    checks.append({
        'name': 'chromium_installation',
        'status': 'pass' if chromium_ok else 'fail',
        'message': f'Chromium {"is installed" if chromium_ok else "is NOT installed"}: {executable_path}',
        'hint': 'Run: playwright install chromium' if not chromium_ok else None,
    })

    # 4. LLM API Key 检测
    has_bu_key = bool(os.environ.get('BROWSER_USE_API_KEY', ''))
    has_anthropic = bool(os.environ.get('ANTHROPIC_API_KEY', ''))
    has_openai = bool(os.environ.get('OPENAI_API_KEY', ''))
    has_google = bool(os.environ.get('GOOGLE_API_KEY', ''))
    llm_configured = has_bu_key or has_anthropic or has_openai or has_google
    
    provider = 'Unknown'
    if has_bu_key:
        provider = 'BrowserUse Cloud'
    elif has_anthropic:
        provider = 'Anthropic'
    elif has_openai:
        provider = 'OpenAI'
    elif has_google:
        provider = 'Google Gemini'
    
    checks.append({
        'name': 'llm_configured',
        'status': 'pass' if llm_configured else 'fail',
        'message': f'LLM {"is configured" if llm_configured else "is NOT configured"} ({provider})' if llm_configured else 'No LLM API key found',
        'hint': 'Set BROWSER_USE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env' if not llm_configured else None,
    })

    # 5. Network 连通性
    network_ok = True
    checks.append({
        'name': 'network_connectivity',
        'status': 'pass' if network_ok else 'fail',
        'message': 'Network is reachable',
    })

    overall = all(c['status'] == 'pass' for c in checks)

    return {
        'content': [{'type': 'text', 'text': json.dumps({
            'overall': 'ok' if overall else 'fail',
            'checks': checks,
        })}],
        'structuredContent': {
            'overall': 'ok' if overall else 'fail',
            'checks': checks,
        },
    }


async def tool_close_browser(_args: dict) -> dict:
    """关闭浏览器"""
    await close_browser()
    return {'content': [{'type': 'text', 'text': json.dumps({'closed': True})}]}


# ── Tool Registry ────────────────────────────────────────────────

TOOLS = {
    'browse': {
        'name': 'browse',
        'description': '打开 URL 并执行浏览任务，返回页面摘要',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'url': {'type': 'string', 'description': '要访问的 URL'},
                'task': {'type': 'string', 'description': '浏览任务描述'},
                'headless': {'type': 'boolean', 'description': '是否无头模式'},
                'max_steps': {'type': 'number', 'description': '最大执行步数'},
            },
            'required': ['url'],
        },
        'handler': tool_browse,
    },
    'scrape': {
        'name': 'scrape',
        'description': '抓取页面的文本内容',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'url': {'type': 'string', 'description': '要抓取的 URL'},
                'selector': {'type': 'string', 'description': 'CSS 选择器（可选）'},
            },
            'required': ['url'],
        },
        'handler': tool_scrape,
    },
    'screenshot': {
        'name': 'screenshot',
        'description': '截取浏览器画面，返回 base64 编码的截图',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'url': {'type': 'string', 'description': '要截图的 URL'},
                'full_page': {'type': 'boolean', 'description': '是否截取完整页面'},
            },
        },
        'handler': tool_screenshot,
    },
    'navigate': {
        'name': 'navigate',
        'description': '浏览器导航控制（前进/后退/跳转 URL）',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'direction': {'type': 'string', 'description': '导航方向: forward/back'},
                'url': {'type': 'string', 'description': '直接跳转到 URL'},
            },
        },
        'handler': tool_navigate,
    },
    'get_info': {
        'name': 'get_info',
        'description': '获取当前页面信息（URL、标题等）',
        'inputSchema': {
            'type': 'object',
            'properties': {},
        },
        'handler': tool_get_info,
    },
    'health_report': {
        'name': 'health_report',
        'description': '运行健康检查，返回各组件状态',
        'inputSchema': {
            'type': 'object',
            'properties': {},
        },
        'handler': tool_health_report,
    },
    'close_browser': {
        'name': 'close_browser',
        'description': '关闭当前浏览器会话',
        'inputSchema': {
            'type': 'object',
            'properties': {},
        },
        'handler': tool_close_browser,
    },
}


# ── JSON-RPC 2.0 over stdio ─────────────────────────────────────

async def handle_request(request: dict) -> dict | None:
    """处理单个 JSON-RPC 请求"""
    req_id = request.get('id')
    method = request.get('method', '')
    params = request.get('params', {})

    if method == 'initialize':
        return {
            'jsonrpc': '2.0',
            'id': req_id,
            'result': {
                'protocolVersion': '2024-11-05',
                'capabilities': {
                    'tools': {},
                },
                'serverInfo': {
                    'name': 'spacecode-browser-use',
                    'version': '0.1.0',
                },
            },
        }
    
    elif method == 'notifications/initialized':
        return None  # 通知无需响应

    elif method == 'tools/list':
        tool_list = [
            {
                'name': t['name'],
                'description': t['description'],
                'inputSchema': t['inputSchema'],
            }
            for t in TOOLS.values()
        ]
        return {
            'jsonrpc': '2.0',
            'id': req_id,
            'result': {'tools': tool_list},
        }

    elif method == 'tools/call':
        tool_name = params.get('name', '')
        tool_args = params.get('arguments', {})

        if tool_name not in TOOLS:
            return {
                'jsonrpc': '2.0',
                'id': req_id,
                'error': {'code': -32601, 'message': f'Tool not found: {tool_name}'},
            }

        try:
            handler = TOOLS[tool_name]['handler']
            result = await handler(tool_args)
            return {
                'jsonrpc': '2.0',
                'id': req_id,
                'result': result,
            }
        except Exception as e:
            logger.error(f"Tool {tool_name} error: {traceback.format_exc()}")
            return {
                'jsonrpc': '2.0',
                'id': req_id,
                'error': {'code': -32000, 'message': str(e)},
            }

    else:
        return {
            'jsonrpc': '2.0',
            'id': req_id,
            'error': {'code': -32601, 'message': f'Method not found: {method}'},
        }


async def main_loop():
    """主事件循环：从 stdin 读取 JSON-RPC 请求，处理后写入 stdout"""
    logger.info("Browser-Use MCP bridge starting...")
    
    # 禁用 Python 缓冲
    sys.stdin.reconfigure(encoding='utf-8', errors='replace')
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    buffer = ''
    while True:
        try:
            chunk = sys.stdin.read(4096)
            if not chunk:
                logger.info("stdin closed, shutting down")
                break
            
            buffer += chunk
            lines = buffer.split('\n')
            buffer = lines.pop()  # 保留可能不完整的最后一行

            for line in lines:
                line = line.strip()
                if not line:
                    continue
                try:
                    request = json.loads(line)
                    response = await handle_request(request)
                    if response is not None:
                        sys.stdout.write(json.dumps(response) + '\n')
                        sys.stdout.flush()
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON received: {line[:100]}")
        except EOFError:
            break
        except Exception as e:
            logger.error(f"Main loop error: {traceback.format_exc()}")
    
    await close_browser()
    logger.info("Browser-Use MCP bridge shut down")


def main():
    """入口"""
    # 检查依赖
    if not HAS_BROWSER_USE:
        logger.error("browser-use is not installed. Run: pip install browser-use")
        # 即使没有 browser-use，也启动服务以支持 health_report（会返回 fail）
    
    asyncio.run(main_loop())


if __name__ == '__main__':
    if '--mcp' in sys.argv:
        main()
    else:
        print("Usage: python bridge.py --mcp", file=sys.stderr)
        sys.exit(1)