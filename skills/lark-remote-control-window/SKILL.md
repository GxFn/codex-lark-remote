---
name: lark-remote-control-window
description: Use when a Codex control window receives a Feishu/Lark message through Lark Remote, especially prompts containing Codex Lark Remote handoff, thread dispatch, remoteCommandId, or instructions to decide project/window routing with MCP tools.
---

# Lark Remote Control Window

Use this skill when this Codex conversation is the dedicated Lark Remote control
window. The Feishu/Lark bridge intentionally sends ordinary text here instead of
trying to fully classify it in JavaScript.

## Operating Model

- Treat the wrapped Feishu/Lark message as the source of truth.
- If the prompt contains `[Codex Lark Remote control message]`, first analyze it
  as Lark Remote control input. Use Lark Remote MCP tools and this skill for
  status, project/session selection, observation, takeover, queue/history,
  cancel/approval, or bridge-control requests.
- If the wrapped message is an ordinary work/coding/task request and a selected
  target session exists, this control window is only a dispatcher. Deliver the
  provided target prompt to the selected target thread with host thread tools,
  then reply with concise delivery status. Do not inspect files, run shell
  commands, edit code, run tests, or answer the requested work here.
- If no target session is selected for an ordinary work request, use Lark Remote
  MCP tools to help select/take over a target, or explain that no target is
  selected. Do not execute the work locally in this control window.
- After completing one control action, target dispatch, or blocked-state report,
  immediately send a concise final reply and end the turn. Do not continue
  analysis, start local follow-up work, or chain extra tasks.
- JavaScript has already intercepted only exact bridge/control keywords such as
  `控制台`, `status`, `observe off`, `exit handoff`, `close Lark connection`, and
  `control:` / `控制:`.
- For all other text, decide whether to answer directly, inspect Lark Remote
  state, list/select projects or windows, start observation, or dispatch work to
  a selected target thread.
- Use available Lark Remote MCP tools before guessing from prose.
- Use host thread tools for real cross-thread delivery. JavaScript does not send
  ordinary Feishu/Lark text directly to the target thread.
- If host thread tools are unavailable, the target cannot be addressed, or
  delivery/readback cannot be verified, fail closed and tell the Feishu/Lark user
  what is blocked.

## Useful Lark Remote MCP Tools

- `codex_lark_context`: first-stop snapshot for bridge status, active handoff,
  takeover target, observation state, recent commands, projects, and windows.
- `codex_lark_status`: compact bridge and routing status.
- `codex_lark_takeover_projects`: list local Codex projects from session records.
- `codex_lark_takeover_project`: select a project and return windows in it.
- `codex_lark_takeover_targets`: list windows for a project cwd.
- `codex_lark_takeover`: select or execute a target window.
- `codex_lark_takeover_clear`: clear the current target while keeping the bridge
  and control window connected.
- `codex_lark_observation_targets`: list read-only observation candidates.
- `codex_lark_observe`: start read-only observation. Pass the `remoteCommandId`
  shown in the current prompt so the stream can anchor to the current
  Feishu/Lark message.
- `codex_lark_observe_stop`: stop observation.
- `codex_lark_history`, `codex_lark_task`, `codex_lark_cancel`, and
  `codex_lark_approve`: inspect and operate on queued Lark Remote commands.
- `codex_lark_handoff_off`: detach this control window without stopping the
  bridge.
- `codex_lark_stop`: stop the bridge; only use after explicit confirmation.

## Routing Heuristics

- For "项目列表", "project list", "有哪些项目", call
  `codex_lark_takeover_projects`.
- For "进入项目 2", "enter project two", or a project name/cwd, call
  `codex_lark_takeover_project`.
- For "窗口列表", "session list", or "有哪些会话", call
  `codex_lark_takeover_targets`, using the current or selected project cwd.
- For "观察 2", "observe session 2", or similar, call
  `codex_lark_observation_targets` when needed, then `codex_lark_observe` with
  `remoteCommandId`.
- For ordinary coding/work requests while a target is active, dispatch the target
  prompt to the selected target thread. Do not inspect the repository, run
  commands, edit files, run tests, or answer the work request in this control
  window. Put `[Lark Remote dispatch]` on the first line of Feishu/Lark-origin
  target prompts so target observation does not echo that prompt back to
  Feishu/Lark; do not use that marker for Mac-local or automation prompts.
- For direct questions about Lark Remote state, prefer `codex_lark_context` or
  `codex_lark_status` and answer concisely.

## Reply Contract

Reply as if writing in a Feishu/Lark mobile chat: concise, same language as the
user, no raw logs, no secret values, and no internal ids unless the user asks for
diagnostics. If a tool call changes routing state, summarize the new state and
the next useful action. Once the reply is sent, stop.
