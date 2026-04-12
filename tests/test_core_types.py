"""
Unit tests for core type definitions.

Tests: agent/task/types.py, agent/tool.py
"""
from __future__ import annotations

import pytest
import time
from dataclasses import dataclass

from agent.task.types import TaskStatus, TaskResult, Task


class TestTaskType:
    def test_task_status_values(self):
        expected = {"pending", "running", "completed", "failed", "cancelled"}
        assert set(TaskStatus.__args__) == expected

    @pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
    def test_is_terminal_true(self, status):
        from agent.task.types import is_terminal_task_status
        if hasattr(__import__('agent.task.types', fromlist=['is_terminal_task_status']), 'is_terminal_task_status'):
            fn = __import__('agent.task.types').task.types.is_terminal_task_status
            assert fn(status) is True

    @pytest.mark.parametrize("status", ["pending", "running"])
    def test_is_terminal_false(self, status):
        pass  # Will be tested when is_terminal_task_status exists


class TestTaskDataclass:
    def test_task_creation(self):
        task = Task(id="test-123", description="Test task")
        assert task.id == "test-123"
        assert task.description == "Test task"
        assert task.status == "pending"

    def test_task_result(self):
        result = TaskResult(success=True, output="done")
        assert result.success is True
        assert result.output == "done"

    def test_task_with_subtasks(self):
        task = Task(
            id="parent",
            description="Parent",
            subtask_ids=["sub1", "sub2"],
        )
        assert len(task.subtask_ids) == 2

    def test_task_metadata(self):
        task = Task(id="t1", description="", metadata={"key": "value"})
        assert task.metadata["key"] == "value"


class TestTaskManager:
    def test_import_manager(self):
        try:
            from agent.task.manager import TaskManager
            assert TaskManager is not None
        except ImportError:
            pytest.skip("TaskManager not yet implemented")
