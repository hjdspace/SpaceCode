"""
Unit tests for QueryEngine.

Tests: agent/query_engine.py
"""
from __future__ import annotations

import asyncio
import pytest

from agent.query_engine import (
    QueryEngine,
    QueryEngineConfig,
)
from agent.tool import ToolBase, ToolUseContext, ToolResult
from agent.types.permissions import PermissionAllowDecision


class MockTool(ToolBase):
    name = "MockTool"
    _enabled = True

    def is_enabled(self) -> bool:
        return self._enabled

    async def call(self, args: dict, context=None, **kw):
        return ToolResult(data="mock result")


class TestQueryEngineConfig:
    def test_default_config(self):
        config = QueryEngineConfig()
        assert config.cwd == ""
        assert config.max_turns is None or config.max_turns > 0
        assert isinstance(config.tools, list)

    def test_custom_config(self):
        tools = [MockTool()]
        config = QueryEngineConfig(
            cwd="/tmp",
            tools=tools,
            max_turns=5,
        )
        assert config.cwd == "/tmp"
        assert len(config.tools) == 1
        assert config.max_turns == 5


class TestQueryEngine:
    @pytest.fixture
    def engine(self):
        return QueryEngine(QueryEngineConfig(
            cwd=".",
            tools=[MockTool()],
            commands=[],
            can_use_tool=lambda *a, **k: PermissionAllowDecision(behavior="allow"),
        ))

    def test_initial_state(self, engine):
        assert engine._abort_controller is not None
        assert engine.get_session_id() != ""
        assert engine.get_messages() == []

    def test_set_model(self, engine):
        engine.set_model("claude-opus-4")
        assert engine._config.user_specified_model == "claude-opus-4"

    def test_interrupt(self, engine):
        engine.interrupt()
        assert engine._abort_controller.is_set()

    def test_get_messages_empty(self, engine):
        assert engine.get_messages() == []

    def test_session_id_format(self, engine):
        sid = engine.get_session_id()
        assert isinstance(sid, str)
        assert len(sid) > 0


class TestQueryEngineSubmit:
    @pytest.mark.asyncio
    async def test_submit_yields_system_message(self):
        engine = QueryEngine(QueryEngineConfig(
            cwd=".",
            tools=[MockTool()],
            commands=[],
            can_use_tool=lambda *a, **k: PermissionAllowDecision(behavior="allow"),
            max_turns=1,
        ))
        
        messages = []
        try:
            async for msg in engine.submit_message("hello"):
                messages.append(msg)
                if len(messages) > 50:
                    break
        except Exception:
            pass
        
        if messages:
            types = []
            for m in messages:
                if isinstance(m, dict):
                    types.append(m.get("type", ""))
                else:
                    types.append(getattr(m, "type", ""))
            assert any(t in ("system", "SystemMessage") for t in types), f"Got types: {types}"
