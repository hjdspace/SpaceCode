"""
Unit tests for BashTool implementation.

Tests: agent/tools_impl/BashTool/bash_tool.py
"""
from __future__ import annotations

import asyncio
import os
import platform
import pytest

from agent.tools_impl.BashTool.bash_tool import (
    _BashTool,
    BashTool,
    READONLY_COMMANDS,
    SEARCH_COMMANDS,
    LIST_COMMANDS,
    SAFE_CONCURRENT_COMMANDS,
)


@pytest.fixture
def bash_tool():
    return _BashTool()


class TestBashToolClassification:
    """Test command classification heuristics."""

    def test_classify_read_command_cat(self, bash_tool):
        result = bash_tool._classify_command("cat file.txt")
        assert result["is_read"] is True
        assert result["is_search"] is False

    def test_classify_read_command_head(self, bash_tool):
        result = bash_tool._classify_command("head -20 file.txt")
        assert result["is_read"] is True

    def test_classify_search_grep(self, bash_tool):
        result = bash_tool._classify_command("grep pattern file.py")
        assert result["is_search"] is True

    def test_classify_search_ripgrep(self, bash_tool):
        result = bash_tool._classify_command("rg 'pattern' src/")
        assert result["is_search"] is True

    def test_classify_search_git_log(self, bash_tool):
        result = bash_tool._classify_command("git log --oneline -10")
        assert result["is_search"] is True

    def test_classify_list_ls(self, bash_tool):
        result = bash_tool._classify_command("ls -la")
        assert result["is_list"] is True

    def test_classify_write_rm(self, bash_tool):
        result = bash_tool._classify_command("rm -rf /tmp/test")
        assert result["is_read"] is False
        assert result["is_search"] is False
        assert result["is_list"] is False

    def test_classify_write_npm_install(self, bash_tool):
        result = bash_tool._classify_command("npm install lodash")
        assert result["is_read"] is False
        assert result["is_search"] is False

    def test_classify_empty_command(self, bash_tool):
        result = bash_tool._classify_command("")
        assert result["is_read"] is False
        assert result["is_search"] is False
        assert result["is_list"] is False

    def test_classify_echo_safe(self, bash_tool):
        result = bash_tool._classify_command("echo hello")
        assert result["is_read"] is True  # echo is in READONLY_COMMANDS


class TestBashToolConcurrencySafety:
    """Test concurrency safety detection."""

    def test_safe_echo(self, bash_tool):
        assert bash_tool._is_safe_command("echo hello") is True

    def test_safe_pwd(self, bash_tool):
        assert bash_tool._is_safe_command("pwd") is True

    def test_safe_cat(self, bash_tool):
        assert bash_tool._is_safe_command("cat file.txt") is True

    def test_unsafe_npm_install(self, bash_tool):
        assert bash_tool._is_safe_command("npm install express") is False

    def test_unsafe_rm_rf(self, bash_tool):
        assert bash_tool._is_safe_command("rm -rf node_modules") is False

    def test_safe_pipeline(self, bash_tool):
        assert bash_tool._is_safe_command("echo hello | cat") is True

    def test_unsafe_pipeline(self, bash_tool):
        assert bash_tool._is_safe_command("npm install | cat") is False


class TestBashToolReadOnly:
    """Test is_read_only method."""

    def test_readonly_cat(self, bash_tool):
        assert bash_tool.is_read_only({"command": "cat file"}) is True

    def test_readonly_ls(self, bash_tool):
        assert bash_tool.is_read_only({"command": "ls -la"}) is True

    def test_readonly_grep(self, bash_tool):
        assert bash_tool.is_read_only({"command": "grep pattern file"}) is True

    def test_not_readonly_write(self, bash_tool):
        assert bash_tool.is_read_only({"command": "echo 'x' > file"}) is False

    def test_not_readonly_edit(self, bash_tool):
        assert bash_tool.is_read_only({"command": "sed -i 's/foo/bar/g' file"}) is False


class TestBashToolExecution:
    """Test actual command execution."""

    @pytest.mark.asyncio
    async def test_simple_echo(self, bash_tool):
        from agent.tool import ToolUseContext
        result = await bash_tool.call(
            {"command": "echo hello world"},
            context=ToolUseContext(),
            can_use_tool=lambda *a, **k: None,
            parent_message=None,
        )
        assert "hello world" in result.data

    @pytest.mark.asyncio
    async def test_python_version(self, bash_tool):
        from agent.tool import ToolUseContext
        result = await bash_tool.call(
            {"command": "python --version"},
            context=ToolUseContext(),
            can_use_tool=lambda *a, **k: None,
            parent_message=None,
        )
        assert "Python" in result.data or "python" in result.data.lower()

    @pytest.mark.asyncio
    async def test_error_command(self, bash_tool):
        from agent.tool import ToolUseContext
        result = await bash_tool.call(
            {"command": "exit 42"},
            context=ToolUseContext(),
            can_use_tool=lambda *a, **k: None,
            parent_message=None,
        )
        assert "Exit code: 42" in result.data or "42" in result.data

    @pytest.mark.asyncio
    async def test_timeout(self, bash_tool):
        from agent.tool import ToolUseContext
        result = await bash_tool.call(
            {"command": "sleep 10", "timeout": 100},
            context=ToolUseContext(),
            can_use_tool=lambda *a, **k: None,
            parent_message=None,
        )
        assert "timed out" in result.data.lower()


class TestBashToolConstants:
    """Test that constant sets contain expected values."""

    def test_readonly_contains_common_commands(self):
        assert "cat" in READONLY_COMMANDS
        assert "ls" in READONLY_COMMANDS
        assert "find" in READONLY_COMMANDS
        assert "grep" in READONLY_COMMANDS
        assert "echo" in READONLY_COMMANDS

    def test_search_contains_ripgrep(self):
        assert "rg" in SEARCH_COMMANDS
        assert "grep" in SEARCH_COMMANDS
        assert "ag" in SEARCH_COMMANDS

    def test_safe_concurrent_contains_echo(self):
        assert "echo" in SAFE_CONCURRENT_COMMANDS
        assert "pwd" in SAFE_CONCURRENT_COMMANDS
        assert "cat" in SAFE_CONCURRENT_COMMANDS


class TestBashToolGetFirstToken:
    """Test first token extraction with shell features."""

    def test_simple_command(self):
        assert _BashTool._get_first_token("echo hello") == "echo"

    def test_sudo_command(self):
        assert _BashTool._get_first_token("sudo npm install") == "npm"

    def test_env_var_prefix(self):
        token = _BashTool._get_first_token("FOO=bar echo test")
        assert token == "echo"

    def test_substitution(self):
        token = _BashTool._get_first_token("$(which python)")
        assert token == "$(substitution)"

    def test_empty_command(self):
        assert _BashTool._get_first_token("") == ""

    def test_whitespace_only(self):
        assert _BashTool._get_first_token("   ") == ""
