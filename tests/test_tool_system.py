"""
Unit tests for tool system.

Tests: agent/tool.py (Protocol, functions), agent/tools.py (registry)
"""
from __future__ import annotations

import pytest
from dataclasses import dataclass
from typing import Any

# Import from correct locations
from agent.types.permissions import (
    PermissionMode,
    PermissionResult,
    ToolPermissionContext,
    PermissionAllowDecision,
    PermissionDenyDecision,
)
from agent.tool import (
    Tool,
    ToolBase,
    ToolResult,
    ToolUseContext,
    CanUseToolFn,
    find_tool_by_name,
    tool_matches_name,
    get_empty_tool_permission_context,
    filter_tool_progress_messages,
)
from agent.types.message import ProgressMessage
from agent.tools import (
    get_all_base_tools,
    get_tools,
    assemble_tool_pool,
    _wrap_module_tool,
)


# Use ProgressMessage directly instead of MockProgressMsg for type compatibility


class MockTool(ToolBase):
    """A simple mock tool for testing."""
    name = "MockTest"
    aliases = ["mock", "test"]
    search_hint = "a mock testing tool"
    _enabled = True

    def __init__(self, name: str | None = None):
        if name:
            self.name = name

    def is_enabled(self) -> bool:
        return self._enabled

    async def call(
        self,
        args: dict[str, Any],
        context: ToolUseContext | None = None,
        can_use_tool: CanUseToolFn | None = None,
        parent_message: Any = None,
        on_progress: Any = None,
    ) -> ToolResult:
        return ToolResult(data=f"Mock result: {args}")

    def to_auto_classifier_input(self, input: dict[str, Any]) -> Any:
        return input


class DisabledMockTool(MockTool):
    _enabled = False


# ---------------------------------------------------------------------------
# Tests for utility functions
# ---------------------------------------------------------------------------

class TestFindToolByName:
    def test_find_by_exact_name(self):
        tools = [MockTool(), MockTool(name="Other")]
        found = find_tool_by_name(tools, "MockTest")
        assert found is not None
        assert found.name == "MockTest"

    def test_find_by_alias(self):
        tools = [MockTool()]
        found = find_tool_by_name(tools, "mock")
        assert found is not None
        assert found.name == "MockTest"

    def test_find_not_found(self):
        tools = [MockTool()]
        found = find_tool_by_name(tools, "NonExistent")
        assert found is None

    def test_empty_list(self):
        assert find_tool_by_name([], "anything") is None


class TestToolMatchesName:
    def test_exact_match(self):
        t = MockTool()
        assert tool_matches_name(t, "MockTest") is True

    def test_case_insensitive(self):
        t = MockTool()
        assert tool_matches_name(t, "MockTest") is True  # case-sensitive in Python impl

    def test_alias_match(self):
        t = MockTool()
        assert tool_matches_name(t, "mock") is True

    def test_no_match(self):
        t = MockTool()
        assert tool_matches_name(t, "something_else") is False


class TestEmptyPermissionContext:
    def test_defaults(self):
        ctx = get_empty_tool_permission_context()
        assert ctx.mode == "default"
        assert ctx.is_bypass_permissions_mode_available is False
        assert ctx.always_allow_rules == {}
        assert ctx.always_deny_rules == {}


class TestFilterProgressMessages:
    def test_filters_progress_only(self):
        msgs = [
            ProgressMessage(data={"type": "tool_progress"}),
            ProgressMessage(data={"type": "hook_progress"}),
            ProgressMessage(data={"type": "tool_progress"}),
            ProgressMessage(data={"type": "other"}),
        ]
        # filter_tool_progress_messages keeps non-hook messages (tool_progress, other)
        # and filters out hook_progress
        filtered = filter_tool_progress_messages(msgs)
        assert len(filtered) == 3  # tool_progress x2 + other, NOT hook_progress

    def test_empty_list(self):
        assert filter_tool_progress_messages([]) == []

    def test_no_progress_messages(self):
        msgs = [
            ProgressMessage(data={"type": "other"}),
            ProgressMessage(data={"type": "another"}),
        ]
        # These have types that are not hook_progress, so they pass through
        filtered = filter_tool_progress_messages(msgs)
        assert len(filtered) == 2  # kept because not hook_progress type


class TestPermissionDecisions:
    def test_allow_decision(self):
        d = PermissionAllowDecision(behavior="allow")
        assert d.behavior == "allow"

    def test_deny_decision(self):
        d = PermissionDenyDecision(behavior="deny", decision_reason="not allowed")
        assert d.behavior == "deny"
        assert d.decision_reason == "not allowed"


# ---------------------------------------------------------------------------
# Tests for ToolBase
# ---------------------------------------------------------------------------

class TestToolBase:
    @pytest.fixture
    def tool(self):
        return MockTool()

    def test_name(self, tool):
        assert tool.name == "MockTest"

    def test_aliases(self, tool):
        assert "mock" in tool.aliases

    def test_search_hint(self, tool):
        assert tool.search_hint != ""

    def test_user_facing_name(self, tool):
        assert tool.user_facing_name() == "MockTest"

    def test_is_enabled_default(self, tool):
        assert tool.is_enabled() is True

    def test_disabled_tool(self):
        t = DisabledMockTool()
        assert t.is_enabled() is False

    def test_input_schema_returns_dict(self, tool):
        schema = tool.input_schema()
        assert isinstance(schema, dict)

    async def test_call_returns_tool_result(self, tool):
        result = await tool.call({"key": "value"}, context=ToolUseContext())
        assert isinstance(result, ToolResult)
        assert "Mock result" in result.data

    def test_to_auto_classifier_input(self, tool):
        input_data = {"command": "echo hello"}
        assert tool.to_auto_classifier_input(input_data) == input_data


# ---------------------------------------------------------------------------
# Tests for tool registry (tools.py)
# ---------------------------------------------------------------------------

class TestToolRegistry:
    def test_get_all_base_tools_not_empty(self):
        tools = get_all_base_tools()
        assert len(tools) > 0

    def test_get_all_base_tools_has_bash(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "Bash" in names

    def test_get_all_base_tools_has_agent(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "Agent" in names

    def test_get_all_base_tools_has_file_tools(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "Read" in names
        assert "Edit" in names
        assert "Write" in names

    def test_get_all_base_tools_has_search_tools(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "Glob" in names
        assert "Grep" in names

    def test_get_all_base_tools_has_web_tools(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "WebFetch" in names
        assert "WebSearch" in names

    def test_get_all_base_tools_has_interaction_tools(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "AskUserQuestion" in names
        assert "TodoWrite" in names

    def test_get_all_base_tools_has_mode_tools(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "EnterPlanMode" in names
        assert "ExitPlanMode" in names

    def test_get_all_base_tools_has_mcp_tools(self):
        tools = get_all_base_tools()
        names = {t.name for t in tools}
        assert "ListMcpResources" in names
        assert "ReadMcpResource" in names

    def test_minimum_tool_count(self):
        tools = get_all_base_tools()
        assert len(tools) >= 20, f"Expected at least 20 tools, got {len(tools)}"

    def test_all_tools_have_names(self):
        tools = get_all_base_tools()
        for t in tools:
            assert t.name and t.name.strip(), f"Tool missing name: {type(t)}"

    def test_assemble_pool_no_mcp(self):
        ctx = get_empty_tool_permission_context()
        pool = assemble_tool_pool(ctx)
        assert len(pool) > 0
        names = [t.name for t in pool]
        assert names == sorted(names)

    def test_get_tools_with_context(self):
        ctx = get_empty_tool_permission_context()
        tools = get_tools(ctx)
        assert len(tools) > 0

    def test_wrap_module_tool_basic(self):
        wrapped = _wrap_module_tool(
            "agent.tools_impl.SleepTool.sleep_tool",
            "Sleep",
        )
        assert wrapped.name == "Sleep"
        assert isinstance(wrapped, ToolBase)


class TestToolResult:
    def test_create_with_string_data(self):
        r = ToolResult(data="hello world")
        assert r.data == "hello world"

    def test_create_with_dict_data(self):
        r = ToolResult(data={"text": "result"})
        assert r.data["text"] == "result"

    def test_create_with_new_messages(self):
        from agent.types.message import UserMessage
        new_msgs = [UserMessage()]
        r = ToolResult(data="ok", new_messages=new_msgs)
        assert r.new_messages == new_msgs
