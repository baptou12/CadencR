#!/usr/bin/env python3
"""A deterministic ACP v1 agent, used as an installed-provider fixture.

By default this is the *minimum admission contract* from
`docs/PROVIDER_SPEC/BOUNDARIES.md` and nothing more: `initialize` at protocol
version 1, `session/new`,
`session/prompt` with streaming `session/update` notifications,
`session/cancel`, and a standard JSON-RPC "method not found" for every optional
method it does not implement. It advertises no optional capability, so a test
against it proves the generic path works without any provider-specific help.

`--session-config` adds one ACP v1 boolean option and implements
`session/set_config_option`. This keeps the default admission fixture minimal
while letting the same deterministic process test the optional configuration
bridge.

Behavior is keyed off the prompt text so a test can drive it exactly:

  * a prompt containing "hang" streams one chunk and then waits for a cancel,
    answering `stopReason: "cancelled"`;
  * any other prompt streams every chunk in CHUNKS and answers
    `stopReason: "end_turn"`.

Everything else is fixed: the same session id, the same chunks, in the same
order, with no timing dependence.
"""

import json
import sys
import threading

SESSION_ID = "fake-acp-session-1"
CHUNKS = ["Hello ", "from ", "the ", "fake ", "ACP ", "agent."]

_write_lock = threading.Lock()
_cancelled = threading.Event()
_session_config_enabled = "--session-config" in sys.argv
_safe_mode = False


def config_options():
    return [
        {
            "id": "safe_mode",
            "name": "Safe mode",
            "description": "Use conservative behavior",
            "category": "_fake",
            "type": "boolean",
            "currentValue": _safe_mode,
        }
    ]


def send(message):
    """Write one newline-delimited JSON-RPC frame."""
    with _write_lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()


def reply(request_id, result):
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def reply_error(request_id, code, message):
    send({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def notify(method, params):
    send({"jsonrpc": "2.0", "method": method, "params": params})


def stream_chunk(text):
    notify(
        "session/update",
        {
            "sessionId": SESSION_ID,
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": text},
            },
        },
    )


def prompt_text(params):
    blocks = params.get("prompt") or []
    return " ".join(
        block.get("text", "") for block in blocks if isinstance(block, dict)
    )


def run_turn(request_id, params):
    """Handle one `session/prompt` off the read loop so cancel can interleave.

    The flag is cleared by the read loop before this thread starts, never here:
    clearing it here would race with — and swallow — a cancel that arrives while
    the thread is still spinning up.
    """
    if "hang" in prompt_text(params):
        stream_chunk(CHUNKS[0])
        _cancelled.wait()
        reply(request_id, {"stopReason": "cancelled"})
        return
    for chunk in CHUNKS:
        if _cancelled.is_set():
            reply(request_id, {"stopReason": "cancelled"})
            return
        stream_chunk(chunk)
    reply(request_id, {"stopReason": "end_turn"})


def main():
    global _safe_mode
    turn = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        method = request.get("method")
        params = request.get("params") or {}
        request_id = request.get("id")

        if method == "initialize":
            reply(
                request_id,
                {
                    "protocolVersion": 1,
                    "agentCapabilities": {"loadSession": False},
                    "agentInfo": {"name": "fake-acp-agent", "version": "1.0.0"},
                },
            )
        elif method == "session/new":
            result = {"sessionId": SESSION_ID}
            if _session_config_enabled:
                result["configOptions"] = config_options()
            reply(request_id, result)
        elif method == "session/set_config_option" and _session_config_enabled:
            if params.get("configId") != "safe_mode" or not isinstance(
                params.get("value"), bool
            ):
                reply_error(request_id, -32602, "invalid config option")
                continue
            _safe_mode = params["value"]
            reply(request_id, {"configOptions": config_options()})
        elif method == "session/prompt":
            _cancelled.clear()
            turn = threading.Thread(target=run_turn, args=(request_id, params))
            turn.daemon = True
            turn.start()
        elif method == "session/cancel":
            # A notification: acknowledged by the turn's stop reason, not a reply.
            _cancelled.set()
        elif request_id is not None:
            reply_error(request_id, -32601, "method not found: {}".format(method))

    if turn is not None:
        _cancelled.set()
        turn.join(timeout=1)


if __name__ == "__main__":
    main()
