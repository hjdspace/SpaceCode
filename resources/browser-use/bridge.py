#!/usr/bin/env python3
"""
SpaceCode Browser-Use MCP Bridge
=================================
JSON-RPC 2.0 over stdio MCP 服务，桥接 browser-use Python 库与 Electron 主进程。

用法：
  python bridge.py --mcp

通过 stdin/stdout 接收和发送 JSON-RPC 2.0 消息，支持以下工具：
  - run_session:          创建会话并运行任务（支持 keep_alive、结构化输出）
  - get_session:          轮询会话状态和输出
  - send_task:            向空闲 keep-alive 会话发送后续任务
  - stop_session:         停止会话
  - get_session_messages: 获取 agent 消息（推理、动作、结果）
  - browse:               打开 URL 并浏览（兼容旧接口）
  - scrape:               提取页面内容
  - screenshot:           截取浏览器当前画面
  - navigate:             导航（前进/后退/跳转 URL）
  - get_info:             获取页面标题/URL/内容摘要
  - health_report:        健康检查
  - close_browser:        关闭浏览器会话

环境变量配置（由 Electron buildBUEnv 注入）：
  BROWSER_USE_API_KEY     → ChatBrowserUse 云服务 API Key
  ANTHROPIC_API_KEY       → Anthropic API Key
  OPENAI_API_KEY          → OpenAI API Key
  GOOGLE_API_KEY          → Google Gemini API Key
  BU_LLM_MODEL            → LLM 模型名称
  BU_LLM_PROVIDER         → LLM Provider（ChatBrowserUse/Anthropic/OpenAI/Google）
  BU_HEADLESS             → 是否无头模式 ('true'/'false')
  BU_USE_VISION           → 是否使用视觉 ('true'/'false'/'auto')
  BU_TEMPERATURE          → LLM 温度 (float)
  BU_MAX_STEPS            → 最大执行步数 (int)
  BU_MAX_ACTIONS_PER_STEP → 每步最大动作数 (int)
  BU_MAX_FAILURES         → 最大重试次数 (int)
  BU_USE_THINKING         → 是否使用推理模式 ('true'/'false')
  BU_FLASH_MODE           → 快速模式 ('true'/'false')
  BU_ALLOWED_DOMAINS      → 允许的域名白名单（逗号分隔）
  BU_USER_DATA_DIR        → 用户数据目录（复用 Chrome 登录态）
  BU_DOWNLOADS_PATH       → 下载目录
  BU_USE_CLOUD            → 是否使用 Cloud Browser ('true'/'false')
  BU_SAVE_CONVERSATION_PATH → 保存对话历史的路径
  BU_EXTEND_SYSTEM_MESSAGE → 扩展系统提示
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

# ── Config Resolution ────────────────────────────────────────────

def _env_bool(name: str, default: bool = False) -> bool:
    """从环境变量读取布尔值"""
    val = os.environ.get(name, '').strip().lower()
    if not val:
        return default
    return val in ('true', '1', 'yes', 'on')

def _env_int(name: str, default: int) -> int:
    """从环境变量读取整数"""
    try:
        return int(os.environ.get(name, str(default)))
    except (ValueError, TypeError):
        return default

def _env_float(name: str, default: float) -> float:
    """从环境变量读取浮点数"""
    try:
        return float(os.environ.get(name, str(default)))
    except (ValueError, TypeError):
        return default

def _env_list(name: str, default: list = None) -> list:
    """从环境变量读取逗号分隔的列表"""
    val = os.environ.get(name, '').strip()
    if not val:
        return default or []
    return [item.strip() for item in val.split(',') if item.strip()]


# ── LLM Resolution ──────────────────────────────────────────────

def get_llm(temperature: float = None):
    """
    根据环境变量配置 LLM。

    优先顺序：
      1. BU_LLM_PROVIDER 显式指定
      2. BROWSER_USE_API_KEY → ChatBrowserUse
      3. ANTHROPIC_API_KEY → ChatAnthropic
      4. OPENAI_API_KEY → ChatOpenAI
      5. GOOGLE_API_KEY → ChatGoogle
    """
    bu_key = os.environ.get('BROWSER_USE_API_KEY', '')
    bu_model = os.environ.get('BU_LLM_MODEL', '')
    provider = os.environ.get('BU_LLM_PROVIDER', '').strip()
    anthropic_key = os.environ.get('ANTHROPIC_API_KEY', '')
    openai_key = os.environ.get('OPENAI_API_KEY', '')
    google_key = os.environ.get('GOOGLE_API_KEY', '')
    temp = temperature if temperature is not None else _env_float('BU_TEMPERATURE', 0.1)

    # 显式指定 provider
    if provider:
        if provider == 'ChatBrowserUse' and bu_key:
            from browser_use.llm.browser_use.chat import ChatBrowserUse
            return ChatBrowserUse(model=bu_model or 'bu-2-0')
        elif provider == 'Anthropic' and anthropic_key:
            from browser_use.llm.anthropic.chat import ChatAnthropic
            model = bu_model or 'claude-sonnet-4-6'
            return ChatAnthropic(model=model, temperature=temp)
        elif provider == 'OpenAI' and openai_key:
            from browser_use.llm.openai.chat import ChatOpenAI
            model = bu_model or 'gpt-4.1-mini'
            return ChatOpenAI(model=model, temperature=temp)
        elif provider == 'Google' and google_key:
            from browser_use.llm.google.chat import ChatGoogle
            model = bu_model or 'gemini-2.5-flash'
            return ChatGoogle(model=model, temperature=temp)

    # 自动检测
    if bu_key:
        from browser_use.llm.browser_use.chat import ChatBrowserUse
        return ChatBrowserUse(model=bu_model or 'bu-2-0')
    elif anthropic_key:
        from browser_use.llm.anthropic.chat import ChatAnthropic
        model = bu_model or 'claude-sonnet-4-6'
        return ChatAnthropic(model=model, temperature=temp)
    elif openai_key:
        from browser_use.llm.openai.chat import ChatOpenAI
        model = bu_model or 'gpt-4.1-mini'
        return ChatOpenAI(model=model, temperature=temp)
    elif google_key:
        from browser_use.llm.google.chat import ChatGoogle
        model = bu_model or 'gemini-2.5-flash'
        return ChatGoogle(model=model, temperature=temp)
    else:
        raise ValueError(
            'No LLM API key configured. Set BROWSER_USE_API_KEY, '
            'ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.'
        )


# ── Browser Session Management ───────────────────────────────────

_browser_session = None  # 全局浏览器会话

def _build_browser_profile(headless: bool = None) -> 'BrowserProfile':
    """根据环境变量构建 BrowserProfile"""
    if headless is None:
        headless = _env_bool('BU_HEADLESS', True)

    allowed_domains = _env_list('BU_ALLOWED_DOMAINS')
    user_data_dir = os.environ.get('BU_USER_DATA_DIR', '').strip() or None
    downloads_path = os.environ.get('BU_DOWNLOADS_PATH', '').strip() or None
    use_cloud = _env_bool('BU_USE_CLOUD', False)

    kwargs = {
        'headless': headless,
        'allowed_domains': allowed_domains if allowed_domains else None,
    }

    # Cloud Browser 支持
    if use_cloud and HAS_BROWSER_USE:
        kwargs['use_cloud'] = True

    if user_data_dir:
        kwargs['user_data_dir'] = user_data_dir
    if downloads_path:
        kwargs['downloads_path'] = downloads_path

    try:
        return BrowserProfile(**kwargs)
    except TypeError:
        # 某些参数可能不被当前版本支持，降级
        kwargs.pop('use_cloud', None)
        kwargs.pop('downloads_path', None)
        kwargs.pop('user_data_dir', None)
        return BrowserProfile(**kwargs)


async def get_or_create_browser(headless: bool = None) -> 'BrowserSession':
    """获取或创建全局浏览器会话"""
    global _browser_session
    if _browser_session is not None and not _browser_session._closed:
        return _browser_session
    if _browser_session is not None:
        await close_browser()

    profile = _build_browser_profile(headless=headless)
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


# ── Session Management ──────────────────────────────────────────

# 会话存储：session_id → { agent, history, status, messages, created_at }
_sessions: dict = {}

def _gen_session_id() -> str:
    """生成简短会话 ID"""
    import uuid
    return uuid.uuid4().hex[:12]


def _build_agent_kwargs(task: str, llm, headless: bool = None, output_schema_str: str = None) -> dict:
    """构建 Agent 参数，从环境变量读取所有配置"""
    kwargs = {
        'task': task,
        'llm': llm,
    }

    # 使用全局浏览器会话（共享状态）
    # 不在这里传 browser，而是在 run 之前确保会话存在

    # Vision
    use_vision_env = os.environ.get('BU_USE_VISION', 'auto').strip().lower()
    if use_vision_env in ('true', '1', 'yes'):
        kwargs['use_vision'] = True
    elif use_vision_env in ('false', '0', 'no'):
        kwargs['use_vision'] = False
    elif use_vision_env == 'auto':
        kwargs['use_vision'] = 'auto'

    # Actions & Behavior
    max_actions = _env_int('BU_MAX_ACTIONS_PER_STEP', 3)
    if max_actions != 3:
        kwargs['max_actions_per_step'] = max_actions

    max_failures = _env_int('BU_MAX_FAILURES', 3)
    if max_failures != 3:
        kwargs['max_failures'] = max_failures

    # Thinking & Flash mode
    if _env_bool('BU_USE_THINKING', True) is False:
        kwargs['use_thinking'] = False
    if _env_bool('BU_FLASH_MODE', False):
        kwargs['flash_mode'] = True

    # System message extension
    extend_msg = os.environ.get('BU_EXTEND_SYSTEM_MESSAGE', '').strip()
    if extend_msg:
        kwargs['extend_system_message'] = extend_msg

    # Conversation saving
    save_path = os.environ.get('BU_SAVE_CONVERSATION_PATH', '').strip()
    if save_path:
        kwargs['save_conversation_path'] = save_path

    # Cost tracking
    if _env_bool('BU_CALCULATE_COST', False):
        kwargs['calculate_cost'] = True

    # Timeout
    llm_timeout = _env_int('BU_LLM_TIMEOUT', 0)
    if llm_timeout > 0:
        kwargs['llm_timeout'] = llm_timeout
    step_timeout = _env_int('BU_STEP_TIMEOUT', 0)
    if step_timeout > 0:
        kwargs['step_timeout'] = step_timeout

    # Directly open URL
    directly_open_url = os.environ.get('BU_DIRECTLY_OPEN_URL', '').strip().lower()
    if directly_open_url in ('false', '0', 'no'):
        kwargs['directly_open_url'] = False
    elif directly_open_url in ('true', '1', 'yes'):
        kwargs['directly_open_url'] = True

    # Structured output
    if output_schema_str:
        try:
            # 尝试从 JSON 字符串构建 Pydantic 模型
            from pydantic import create_model
            import json as _json
            schema = _json.loads(output_schema_str)
            if isinstance(schema, dict) and 'properties' in schema:
                # 从 JSON Schema 构建简单的 Pydantic 模型
                fields = {}
                for field_name, field_def in schema.get('properties', {}).items():
                    field_type = str  # 默认 string
                    fields[field_name] = (field_type, ...)
                output_model = create_model('DynamicOutput', **fields)
                kwargs['output_model_schema'] = output_model
        except Exception as e:
            logger.warning(f"Failed to parse output_schema: {e}")

    # Browser profile（确保使用共享会话）
    headless_val = headless if headless is not None else _env_bool('BU_HEADLESS', True)
    kwargs['browser_profile'] = _build_browser_profile(headless=headless_val)

    return kwargs


async def tool_run_session(args: dict) -> dict:
    """创建会话并运行任务"""
    task = args.get('task', '')
    if not task:
        return {'content': [{'type': 'text', 'text': 'Error: task is required'}], 'isError': True}

    max_steps = args.get('max_steps', _env_int('BU_MAX_STEPS', 100))
    keep_alive = args.get('keep_alive', False)
    output_schema = args.get('output_schema')  # JSON Schema 字符串
    headless = args.get('headless')
    if headless is None:
        headless = _env_bool('BU_HEADLESS', True)

    try:
        temperature = _env_float('BU_TEMPERATURE', 0.1)
        llm = get_llm(temperature=temperature)
        agent_kwargs = _build_agent_kwargs(task, llm, headless=headless, output_schema_str=output_schema)
        agent = Agent(**agent_kwargs)
        history = await agent.run(max_steps=max_steps)

        session_id = _gen_session_id()
        _sessions[session_id] = {
            'agent': agent if keep_alive else None,
            'history': history,
            'status': 'done' if history.is_done() else 'failed',
            'task': task,
            'keep_alive': keep_alive,
            'steps': history.number_of_steps() if hasattr(history, 'number_of_steps') else 0,
            'final_result': history.final_result(),
            'errors': history.errors() if hasattr(history, 'errors') else [],
            'urls': history.urls() if hasattr(history, 'urls') else [],
            'action_names': history.action_names() if hasattr(history, 'action_names') else [],
        }

        # 获取当前页面信息
        page_info = {}
        if _browser_session and hasattr(_browser_session, 'page') and _browser_session.page:
            try:
                page_info = {
                    'url': _browser_session.page.url,
                    'title': await _browser_session.page.title(),
                }
            except Exception:
                pass

        result_data = {
            'session_id': session_id,
            'status': _sessions[session_id]['status'],
            'result': history.final_result() or "Task completed but no result returned.",
            'steps': _sessions[session_id]['steps'],
            'urls': _sessions[session_id]['urls'],
            'has_errors': len(_sessions[session_id]['errors']) > 0,
            **page_info,
        }

        # 结构化输出
        if hasattr(history, 'structured_output') and history.structured_output:
            result_data['structured_output'] = history.structured_output

        return {
            'content': [{'type': 'text', 'text': json.dumps(result_data, default=str)}],
        }
    except Exception as e:
        logger.error(f"run_session error: {traceback.format_exc()}")
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_get_session(args: dict) -> dict:
    """轮询会话状态和输出"""
    session_id = args.get('session_id', '')
    if not session_id or session_id not in _sessions:
        return {'content': [{'type': 'text', 'text': f'Error: session not found: {session_id}'}], 'isError': True}

    sess = _sessions[session_id]
    result_data = {
        'session_id': session_id,
        'status': sess['status'],
        'task': sess['task'],
        'steps': sess['steps'],
        'final_result': sess['final_result'],
        'has_errors': len(sess['errors']) > 0,
        'errors': sess['errors'][:5] if sess['errors'] else [],  # 限制返回数量
        'urls': sess['urls'],
    }
    return {'content': [{'type': 'text', 'text': json.dumps(result_data, default=str)}]}


async def tool_send_task(args: dict) -> dict:
    """向空闲 keep-alive 会话发送后续任务"""
    session_id = args.get('session_id', '')
    task = args.get('task', '')
    max_steps = args.get('max_steps', _env_int('BU_MAX_STEPS', 100))

    if not session_id or session_id not in _sessions:
        return {'content': [{'type': 'text', 'text': f'Error: session not found: {session_id}'}], 'isError': True}

    sess = _sessions[session_id]
    if not sess.get('keep_alive') or not sess.get('agent'):
        return {'content': [{'type': 'text', 'text': 'Error: session does not support follow-up tasks (not keep_alive or agent closed)'}], 'isError': True}

    try:
        agent = sess['agent']
        history = await agent.run(max_steps=max_steps, task=task)

        sess['history'] = history
        sess['status'] = 'done' if history.is_done() else 'failed'
        sess['task'] = task
        sess['steps'] = history.number_of_steps() if hasattr(history, 'number_of_steps') else 0
        sess['final_result'] = history.final_result()
        sess['errors'] = history.errors() if hasattr(history, 'errors') else []
        sess['urls'] = history.urls() if hasattr(history, 'urls') else []

        result_data = {
            'session_id': session_id,
            'status': sess['status'],
            'result': history.final_result() or "Task completed.",
            'steps': sess['steps'],
        }
        return {'content': [{'type': 'text', 'text': json.dumps(result_data, default=str)}]}
    except Exception as e:
        logger.error(f"send_task error: {traceback.format_exc()}")
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_stop_session(args: dict) -> dict:
    """停止会话"""
    session_id = args.get('session_id', '')
    strategy = args.get('strategy', 'task')  # task | session

    if not session_id or session_id not in _sessions:
        return {'content': [{'type': 'text', 'text': f'Error: session not found: {session_id}'}], 'isError': True}

    sess = _sessions[session_id]
    if strategy == 'session':
        # 完全销毁：关闭 agent 和浏览器
        if sess.get('agent'):
            try:
                # Agent 没有显式的 close 方法，但可以清理引用
                sess['agent'] = None
            except Exception:
                pass
        await close_browser()
        del _sessions[session_id]
        return {'content': [{'type': 'text', 'text': json.dumps({'session_id': session_id, 'stopped': True, 'strategy': 'session'})}]}
    else:
        # 仅停止当前任务
        sess['status'] = 'stopped'
        if sess.get('agent'):
            sess['agent'] = None
        return {'content': [{'type': 'text', 'text': json.dumps({'session_id': session_id, 'stopped': True, 'strategy': 'task'})}]}


async def tool_get_session_messages(args: dict) -> dict:
    """获取 agent 消息（推理、动作、结果）"""
    session_id = args.get('session_id', '')
    if not session_id or session_id not in _sessions:
        return {'content': [{'type': 'text', 'text': f'Error: session not found: {session_id}'}], 'isError': True}

    sess = _sessions[session_id]
    history = sess.get('history')

    messages = []
    if history:
        try:
            # 获取模型输出（推理过程）
            model_outputs = history.model_outputs() if hasattr(history, 'model_outputs') else []
            for i, output in enumerate(model_outputs):
                msg = {'step': i + 1}
                if hasattr(output, 'current_state'):
                    state = output.current_state
                    if hasattr(state, 'evaluation_previous_goal'):
                        msg['evaluation'] = state.evaluation_previous_goal
                    if hasattr(state, 'memory'):
                        msg['memory'] = state.memory
                    if hasattr(state, 'next_goal'):
                        msg['next_goal'] = state.next_goal
                if hasattr(output, 'action'):
                    msg['action'] = str(output.action)
                messages.append(msg)
        except Exception as e:
            logger.warning(f"Failed to extract messages: {e}")

        try:
            actions = history.action_names() if hasattr(history, 'action_names') else []
            for i, action in enumerate(actions):
                if i < len(messages):
                    messages[i]['action_name'] = action
                else:
                    messages.append({'step': i + 1, 'action_name': action})
        except Exception:
            pass

    return {'content': [{'type': 'text', 'text': json.dumps({
        'session_id': session_id,
        'messages': messages[:50],  # 限制返回数量
        'total_steps': len(messages),
    }, default=str)}]}


# ── Legacy Tools (兼容旧接口) ────────────────────────────────────

async def tool_browse(args: dict) -> dict:
    """打开 URL 并执行浏览任务（使用共享浏览器会话）"""
    url = args.get('url', '')
    task = args.get('task', f'Visit {url} and summarize the page content')
    headless = args.get('headless')
    if headless is None:
        headless = _env_bool('BU_HEADLESS', True)
    max_steps = args.get('max_steps', _env_int('BU_MAX_STEPS', 50))

    if not url:
        return {'content': [{'type': 'text', 'text': 'Error: url is required'}], 'isError': True}

    try:
        # 确保全局浏览器会话存在（共享状态）
        await get_or_create_browser(headless=headless)

        temperature = _env_float('BU_TEMPERATURE', 0.1)
        llm = get_llm(temperature=temperature)
        agent_kwargs = _build_agent_kwargs(
            task=f"Go to {url}. {task}",
            llm=llm,
            headless=headless,
        )
        # 使用共享浏览器会话
        agent_kwargs['browser_session'] = _browser_session
        agent = Agent(**agent_kwargs)
        history = await agent.run(max_steps=max_steps)
        result = history.final_result() or "Task completed but no result returned."

        # 获取当前页面信息（从共享会话中读取）
        page_info = {}
        if _browser_session and hasattr(_browser_session, 'page') and _browser_session.page:
            try:
                page_info = {
                    'url': _browser_session.page.url,
                    'title': await _browser_session.page.title(),
                }
            except Exception:
                pass

        return {
            'content': [
                {'type': 'text', 'text': json.dumps({
                    'result': result,
                    'url': page_info.get('url', url),
                    'title': page_info.get('title', ''),
                    'steps_used': history.number_of_steps() if hasattr(history, 'number_of_steps') else 0,
                    'has_errors': len(history.errors()) > 0 if hasattr(history, 'errors') else False,
                }, default=str)},
            ],
        }
    except Exception as e:
        logger.error(f"browse error: {traceback.format_exc()}")
        return {'content': [{'type': 'text', 'text': f'Error: {str(e)}'}], 'isError': True}


async def tool_scrape(args: dict) -> dict:
    """抓取页面内容（使用共享浏览器会话）"""
    url = args.get('url', '')
    selector = args.get('selector', '')

    try:
        session = await get_or_create_browser()
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
    """截取浏览器画面（使用共享浏览器会话）"""
    url = args.get('url', '')
    full_page = args.get('full_page', False)

    try:
        session = await get_or_create_browser()
        page = session.page

        if url:
            await page.goto(url, wait_until='domcontentloaded')

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
    """导航控制（使用共享浏览器会话）"""
    direction = args.get('direction', 'forward')
    url = args.get('url', '')

    try:
        session = await get_or_create_browser()
        page = session.page

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
    """获取当前页面信息（使用共享浏览器会话）"""
    try:
        session = await get_or_create_browser()
        page = session.page
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
        'hint': 'Set BROWSER_USE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY' if not llm_configured else None,
    })

    # 5. Cloud Browser 模式
    use_cloud = _env_bool('BU_USE_CLOUD', False)
    checks.append({
        'name': 'cloud_browser',
        'status': 'pass' if not use_cloud else ('pass' if has_bu_key else 'fail'),
        'message': f'Cloud Browser: {"enabled" if use_cloud else "disabled"}' + (f' (API Key: {"present" if has_bu_key else "MISSING"})' if use_cloud else ''),
        'hint': 'Cloud Browser requires BROWSER_USE_API_KEY' if use_cloud and not has_bu_key else None,
    })

    # 6. Network 连通性
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
    # ── Session Management ──
    'run_session': {
        'name': 'run_session',
        'description': '创建会话并运行任务。支持 keep_alive（保持会话以执行后续任务）、结构化输出、自定义步数。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'task': {'type': 'string', 'description': '要执行的任务描述'},
                'max_steps': {'type': 'number', 'description': '最大执行步数（默认 100）'},
                'keep_alive': {'type': 'boolean', 'description': '是否保持会话以执行后续任务'},
                'output_schema': {'type': 'string', 'description': '结构化输出的 JSON Schema（可选）'},
                'headless': {'type': 'boolean', 'description': '是否无头模式'},
            },
            'required': ['task'],
        },
        'handler': tool_run_session,
    },
    'get_session': {
        'name': 'get_session',
        'description': '轮询会话状态和输出，返回状态、步数、结果、错误等。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'session_id': {'type': 'string', 'description': '会话 ID'},
            },
            'required': ['session_id'],
        },
        'handler': tool_get_session,
    },
    'send_task': {
        'name': 'send_task',
        'description': '向空闲的 keep-alive 会话发送后续任务（在同一浏览器会话中继续操作）。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'session_id': {'type': 'string', 'description': '会话 ID'},
                'task': {'type': 'string', 'description': '后续任务描述'},
                'max_steps': {'type': 'number', 'description': '最大执行步数'},
            },
            'required': ['session_id', 'task'],
        },
        'handler': tool_send_task,
    },
    'stop_session': {
        'name': 'stop_session',
        'description': '停止会话。strategy="task" 仅停止当前任务，strategy="session" 销毁整个会话和浏览器。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'session_id': {'type': 'string', 'description': '会话 ID'},
                'strategy': {'type': 'string', 'description': '停止策略: task | session'},
            },
            'required': ['session_id'],
        },
        'handler': tool_stop_session,
    },
    'get_session_messages': {
        'name': 'get_session_messages',
        'description': '获取 agent 的消息历史（推理过程、执行的动作、结果）。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'session_id': {'type': 'string', 'description': '会话 ID'},
            },
            'required': ['session_id'],
        },
        'handler': tool_get_session_messages,
    },
    # ── Legacy Tools ──
    'browse': {
        'name': 'browse',
        'description': '打开 URL 并执行浏览任务，返回页面摘要（兼容旧接口，使用共享浏览器会话）',
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
        'description': '抓取页面的文本内容（使用共享浏览器会话）',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'url': {'type': 'string', 'description': '要抓取的 URL'},
                'selector': {'type': 'string', 'description': 'CSS 选择器（可选）'},
            },
        },
        'handler': tool_scrape,
    },
    'screenshot': {
        'name': 'screenshot',
        'description': '截取浏览器画面，返回 base64 编码的截图（使用共享浏览器会话）',
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
        'description': '浏览器导航控制（前进/后退/跳转 URL，使用共享浏览器会话）',
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
        'description': '获取当前页面信息（URL、标题等，使用共享浏览器会话）',
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
                    'version': '0.2.0',
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

    # 禁用 Python 缓冲：stdout 设为 line buffering（参数 1 = 缓冲区大小 1 字节）
    # 确保每行输出立即 flush 到管道，不被 block buffer 延迟。
    sys.stdin.reconfigure(encoding='utf-8', errors='replace')
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

    while True:
        try:
            # 使用 readline() 而非 read(n)：
            # read(n) 在文本模式下会阻塞直到读取 n 个字符或 EOF，
            # 而 readline() 遇到换行符即返回，适合行分隔的 JSON-RPC 协议。
            line = sys.stdin.readline()
            if not line:
                logger.info("stdin closed, shutting down")
                break

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
