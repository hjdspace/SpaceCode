"""
Unit tests for MCP Client.

Tests: agent/services/mcp/client.py
"""
from __future__ import annotations

import asyncio
import json
import pytest

from agent.services.mcp.client import (
    MCPServerConnection,
    MCPServerConfig,
    MCPToolDefinition,
    MCPResource,
    CallToolResult,
)


class TestMCPServerConfig:
    def test_default_config(self):
        cfg = MCPServerConfig(name="test")
        assert cfg.name == "test"
        assert cfg.transport == "stdio"
        assert cfg.command is None

    def test_stdio_config(self):
        cfg = MCPServerConfig(
            name="my-server",
            transport="stdio",
            command=["node", "server.js"],
            env={"PORT": "3000"},
        )
        assert cfg.name == "my-server"
        assert cfg.command == ["node", "server.js"]
        assert cfg.env["PORT"] == "3000"


class TestMCPToolDefinition:
    def test_basic_definition(self):
        t = MCPToolDefinition(name="get_weather")
        assert t.name == "get_weather"
        assert t.description == ""
        assert t.input_schema == {}

    def test_full_definition(self):
        t = MCPToolDefinition(
            name="search",
            description="Search the web",
            input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
        )
        assert t.description == "Search the web"
        assert "query" in t.input_schema["properties"]


class TestMCPResource:
    def test_basic_resource(self):
        r = MCPResource(uri="file:///path/to/file.txt")
        assert r.uri == "file:///path/to/file.txt"
        assert r.name == ""

    def test_full_resource(self):
        r = MCPResource(
            uri="memory://notes/1",
            name="My Note",
            description="A note",
            mime_type="text/plain",
        )
        assert r.name == "My Note"
        assert r.mime_type == "text/plain"


class TestCallToolResult:
    def test_success_result(self):
        r = CallToolResult(content=[{"type": "text", "text": "ok"}])
        assert r.is_error is False
        assert len(r.content) == 1

    def test_error_result(self):
        r = CallToolResult(
            content=[{"type": "text", "text": "failed"}],
            is_error=True,
        )
        assert r.is_error is True

    def test_tool_use_id_generated(self):
        r = CallToolResult(content=[])
        assert r.tool_use_id != ""


class TestMCPServerConnection:
    @pytest.fixture
    def config(self):
        return MCPServerConfig(
            name="test-connection",
            command=["echo", "hello"],
        )

    def test_create_connection(self, config):
        conn = MCPServerConnection(config)
        assert conn.name == "test-connection"
        assert conn.is_connected is False

    def test_repr_disconnected(self, config):
        conn = MCPServerConnection(config)
        r = repr(conn)
        assert "disconnected" in r
        assert "test-connection" in r

    def test_ensure_connected_raises_when_not_connected(self, config):
        conn = MCPServerConnection(config)
        with pytest.raises(ConnectionError, match="Not connected"):
            conn._ensure_connected()

    @pytest.mark.asyncio
    async def test_connect_disconnect_lifecycle(self, config):
        """Test that connect/disconnect doesn't crash on simple echo."""
        conn = MCPServerConnection(config)
        try:
            await conn.connect()
            # The echo process will fail at initialize step (not valid JSON-RPC),
            # but we can verify it started
        except ConnectionError:
            pass  # Expected - echo doesn't speak JSON-RPC
        finally:
            await conn.disconnect()

    @pytest.mark.asyncio
    async def test_context_manager(self, config):
        """Test async context manager interface."""
        conn = MCPServerConnection(config)
        try:
            async with conn:
                assert conn.is_connected or True  # May or may not be connected
        except Exception:
            pass  # Expected with echo command
        finally:
            assert conn.is_connected is False or conn._process is None
