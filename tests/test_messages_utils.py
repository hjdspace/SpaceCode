"""
Unit tests for message utilities.

Tests: agent/utils/messages_utils.py
"""
from __future__ import annotations

import pytest

from agent.utils.messages_utils import (
    NO_RESPONSE_REQUESTED,
    SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
    INTERRUPT_MESSAGE,
    INTERRUPT_MESSAGE_FOR_TOOL_USE,
    auto_reject_message,
    create_user_message,
    create_tool_result_user_message,
    create_assistant_message_from_api,
    normalize_messages_for_api,
    count_tool_calls,
    get_messages_after_compact_boundary,
    SYNTHETIC_MESSAGES,
)


class TestConstants:
    def test_no_response_requested(self):
        assert NO_RESPONSE_REQUESTED == "[No response requested.]"

    def test_synthetic_placeholder(self):
        assert "synthetic" in SYNTHETIC_TOOL_RESULT_PLACEHOLDER.lower() or "placeholder" in SYNTHETIC_TOOL_RESULT_PLACEHOLDER.lower()

    def test_interrupt_message(self):
        assert INTERRUPT_MESSAGE != ""

    def test_synthetic_messages_set(self):
        assert NO_RESPONSE_REQUESTED in SYNTHETIC_MESSAGES
        assert SYNTHETIC_TOOL_RESULT_PLACEHOLDER in SYNTHETIC_MESSAGES
        assert INTERRUPT_MESSAGE in SYNTHETIC_MESSAGES


class TestAutoRejectMessage:
    def test_basic_reject(self):
        msg = auto_reject_message("Bash")
        assert "Bash" in msg
        assert "denied" in msg.lower()


class TestCreateUserMessage:
    def test_string_content(self):
        msg = create_user_message("hello")
        assert msg.type == "user"
        assert msg.message.role == "user"

    def test_list_content(self):
        msg = create_user_message([{"type": "text", "text": "hi"}])
        assert msg.type == "user"

    def test_uuid_generated(self):
        msg = create_user_message("hi")
        assert msg.uuid != ""

    def test_custom_uuid(self):
        msg = create_user_message("hi", uuid="custom-id")
        assert msg.uuid == "custom-id"


class TestCreateToolResultMessage:
    def test_basic_result(self):
        msg = create_tool_result_user_message("tool-123", "result text")
        assert msg.type == "user"
        content = msg.message.content
        assert isinstance(content, list)
        assert content[0]["tool_use_id"] == "tool-123"

    def test_error_result(self):
        msg = create_tool_result_user_message("t1", "error!", is_error=True)
        content = msg.message.content
        assert content[0]["is_error"] is True

    def test_with_source_uuid(self):
        msg = create_tool_result_user_message("t1", "ok", source_uuid="src-uuid")
        assert msg.source_tool_assistant_uuid == "src-uuid"


class TestCreateAssistantMessageFromAPI:
    def test_text_content(self):
        msg = create_assistant_message_from_api(
            [{"type": "text", "text": "Hello!"}],
            model="claude-sonnet-4",
        )
        assert msg.type == "assistant"
        assert msg.message.model == "claude-sonnet-4"

    def test_tool_use_content(self):
        msg = create_assistant_message_from_api([
            {"type": "tool_use", "id": "tu_1", "name": "Bash", "input": {}},
        ])
        assert msg.type == "assistant"
        content = msg.message.content
        assert content[0]["type"] == "tool_use"

    def test_api_error_flag(self):
        msg = create_assistant_message_from_api(
            [{"type": "text", "text": "error"}],
            is_api_error=True,
            api_error="timeout",
        )
        assert msg.is_api_error_message is True
        assert msg.api_error == "timeout"


class TestNormalizeMessagesForAPI:
    def test_filters_non_api_types(self):
        from agent.types.message import UserMessage, AssistantMessage, SystemMessage
        user_msg = UserMessage(type="user", uuid="1", message={"role": "user", "content": "hi"})
        sys_msg = SystemMessage(type="system", uuid="2", subtype="", message="sys")
        assistant_msg = AssistantMessage(type="assistant", uuid="3", message={"role": "assistant", "content": []})
        
        result = normalize_messages_for_api([sys_msg, user_msg, assistant_msg])
        types = [m.type for m in result]
        assert "system" not in types
        assert "user" in types
        assert "assistant" in types

    def test_empty_input(self):
        assert normalize_messages_for_api([]) == []


class TestCountToolCalls:
    def test_count_single_tool_call(self):
        from agent.types.message import AssistantMessage, APIMessage
        msg = AssistantMessage(
            type="assistant",
            uuid="1",
            message=APIMessage(
                role="assistant",
                content=[
                    {"type": "text", "text": "I'll run this"},
                    {"type": "tool_use", "id": "tu1", "name": "Bash", "input": {"command": "ls"}},
                ],
            ),
        )
        assert count_tool_calls([msg]) == 1

    def test_count_multiple_tool_calls(self):
        from agent.types.message import AssistantMessage, APIMessage
        msg = AssistantMessage(
            type="assistant",
            uuid="1",
            message=APIMessage(
                role="assistant",
                content=[
                    {"type": "tool_use", "id": "tu1", "name": "Grep", "input": {}},
                    {"type": "tool_use", "id": "tu2", "name": "Glob", "input": {}},
                ],
            ),
        )
        assert count_tool_calls([msg]) == 2

    def test_no_tool_calls(self):
        from agent.types.message import AssistantMessage, APIMessage
        msg = AssistantMessage(
            type="assistant",
            uuid="1",
            message=APIMessage(role="assistant", content="just text"),
        )
        assert count_tool_calls([msg]) == 0

    def test_empty_messages(self):
        assert count_tool_calls([]) == 0


class TestGetMessagesAfterCompactBoundary:
    def test_no_boundary_returns_all(self):
        from agent.types.message import UserMessage, APIMessage
        msgs = [
            UserMessage(type="user", uuid=f"{i}", message=APIMessage(role="user", content=f"msg{i}"))
            for i in range(3)
        ]
        result = get_messages_after_compact_boundary(msgs)
        assert len(result) == 3

    def test_boundary_filters_earlier_messages(self):
        from agent.types.message import UserMessage, APIMessage, SystemMessage
        msgs = [
            UserMessage(type="user", uuid="1", message=APIMessage(role="user", content="before")),
            SystemMessage(type="system", uuid="b1", subtype="compact_boundary", message="boundary"),
            UserMessage(type="user", uuid="2", message=APIMessage(role="user", content="after")),
        ]
        result = get_messages_after_compact_boundary(msgs)
        assert len(result) == 1
        assert result[0].uuid == "2"
