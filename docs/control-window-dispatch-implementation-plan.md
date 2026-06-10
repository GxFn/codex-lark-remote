# Lark Remote Dispatch Architecture

This document records the current responsibility boundaries for Lark Remote.
It replaces the earlier control-window implementation plan. The basic rule is:
normal Feishu/Lark messages are routed and executed by the local bridge runner;
the Codex control window supplies locked identity and a manual diagnostic
fallback, but it is not started for every remote command.

## Current Runtime Chain

```text
Feishu/Lark event
  -> lark.mjs / bridge-server.mjs
  -> queue.mjs remote command
  -> runner.mjs local route endpoint
  -> runner.mjs local action endpoint
  -> target Codex session or Feishu/Lark reply
  -> observer.mjs / notifier.mjs visible output
```

The normal path is local and deterministic:

```text
/bridge/remote-command/route
/bridge/dispatch/execute
/bridge/remote-command/reply
/bridge/dispatch/clarify
/bridge/dispatch/record
```

`codex exec resume` is not the normal control-window execution surface for
remote messages. It remains only for legacy isolated worktree tasks and explicit
manual diagnostics.

## Layers

### 1. Feishu/Lark Transport

Files:

- `src/lark.mjs`
- `src/notifier.mjs`
- `src/presenter.mjs`

Responsibilities:

- Receive Feishu/Lark events.
- Reply with concise text or cards.
- Split, truncate, sanitize, and deduplicate text.
- Filter internal Codex metadata, prompt echoes, image placeholders, and runner
  bookkeeping that should not appear in Feishu/Lark.

Not responsible for:

- Choosing target Codex sessions.
- Running route decisions.
- Dispatching to target sessions.
- Exposing queue ids, raw prompts, runner logs, or internal execution contracts
  unless the user explicitly asks for diagnostics.

### 2. Bridge Inbound And Deterministic Controls

Files:

- `src/bridge-server.mjs`
- `src/control-semantics.mjs`
- `src/intent-router.mjs`

Responsibilities:

- Authorize users and deduplicate incoming events.
- Handle deterministic keywords and card actions directly.
- Maintain control-window lock, target selection, takeover, and observation
  state.
- Store all other Feishu/Lark text as one remote command.

Deterministic bridge controls include:

- `status`
- `console` / `控制台`
- `project list` / `项目列表`
- `session list` / `会话列表`
- `observe off`
- `commands on` / `commands off`
- `exit handoff` / `退出接管`
- confirmed bridge shutdown
- card button actions

Not responsible for:

- Executing coding work locally.
- Sending ordinary Feishu/Lark text directly to a target thread.
- Treating a Codex turn completion as a dispatch result.

### 3. Queue And Remote Command State

File:

- `src/queue.mjs`

Responsibilities:

- Store each Feishu/Lark message as a remote command.
- Preserve the original prompt, message id, user/chat hashes, active target
  snapshot, and command status.
- Record dispatch and control outcomes.

The queue is the source of truth for whether a remote command is pending,
running, dispatched, blocked, failed, or waiting for clarification.

### 4. Local Runner

File:

- `src/runner.mjs`

Responsibilities:

- Claim queued commands.
- For `controlWindowCommand` commands, call the local bridge route endpoint.
- Execute exactly the returned local endpoint.
- Stop after the single routed action completes.

The runner does not ask the control window to infer tools or call MCP during the
normal path. It also does not fall back to repository work if route or dispatch
is blocked.

### 5. Route And Action Endpoints

Files:

- `src/bridge-server.mjs`
- `src/takeover.mjs`
- `src/observer.mjs`

Responsibilities:

- `/bridge/remote-command/route` reads the remote command and current local
  state, then returns exactly one action.
- `/bridge/dispatch/execute` queues delivery to the selected target session and
  records the user-visible dispatch result.
- `/bridge/remote-command/reply` records a non-dispatch control reply.
- `/bridge/dispatch/clarify` asks the user for missing target or intent.
- `/bridge/dispatch/record` records blocked or failed dispatch.

The route result is authoritative for runner execution. If the route cannot
produce a safe action, the command must be retained and reported as blocked or
waiting for clarification.

### 6. Control Window

Files:

- `AGENTS.md`
- `skills/lark-remote/SKILL.md`
- `skills/lark-remote-control-window/SKILL.md`
- `bin/codex-lark-remote-mcp.mjs`

Responsibilities:

- During startup, configure, verify, and lock the current Codex conversation as
  the Lark Remote control window.
- Provide a human-visible diagnostic surface for explicit recovery prompts.
- Use `lark_*` MCP tools only during startup or explicit manual diagnostics.

Not responsible for:

- Running every Feishu/Lark message as a new Codex control turn.
- Inspecting repositories, editing files, running tests, or answering the target
  coding task locally.
- Calling dynamic Codex thread tools directly from a `codex exec` fallback.

### 7. Target Session Dispatch

The selected target Codex session is the only place where ordinary coding work
is executed after takeover. Target delivery uses a clear prompt prefix:

```text
[Lark Remote dispatch]
<original Feishu/Lark user text>
```

That prefix lets observation suppress Lark Remote's own prompt echo while still
showing prompts from other sources, such as local Codex input or automation.

### 8. Observation And Takeover Visibility

File:

- `src/observer.mjs`

Responsibilities:

- Stream target session progress and final answers back to Feishu/Lark.
- During observation, add prompt separators for non-Lark user turns.
- During takeover, suppress `[Lark Remote dispatch]` prompt echoes and suppress
  duplicate temporary-observer replies while a target dispatch is pending or
  running.

Not responsible for:

- Dispatching user input.
- Deciding target selection.
- Mirroring control-window internal prompts.

## MCP And Skill Surface

All exposed Lark Remote tools use the `lark_` prefix. `codex-lark-remote`
remains only the package, plugin, and repository name.

Startup tools:

- `lark_configure`
- `lark_check_auth`
- `lark_verify_setup`
- `lark_start`
- `lark_lock_control_window`
- `lark_prepare_takeover`

Control and diagnostics tools:

- `lark_get_bridge_status`
- `lark_list_projects`
- `lark_select_project`
- `lark_list_project_sessions`
- `lark_select_target`
- `lark_confirm_takeover`
- `lark_clear_active_target`
- `lark_list_observation_targets`
- `lark_start_observation`
- `lark_stop_observation`
- `lark_unlock_control_window`
- `lark_stop`

Remote-command fallback tools:

- `lark_get_remote_command`
- `lark_list_remote_commands`
- `lark_cancel_remote_command`
- `lark_route_remote_command`
- `lark_prepare_dispatch`
- `lark_dispatch_remote_command`
- `lark_record_dispatch`
- `lark_request_clarification`
- `lark_reply_remote_command`

There is no broad context snapshot tool in the control-window path. Use the
specific route, status, list, select, dispatch, record, reply, or clarification
tool needed for the current action.

## Retired Main-Path Concepts

These concepts are not part of the current normal dispatch path:

- Per-message `codex exec` control-window turns.
- Dynamic desktop thread tools.
- Broad context snapshots used as the first step for dispatch.
- Legacy worktree task creation for ordinary Feishu/Lark messages.
- Legacy approve/review/push task controls in the Lark Remote console.
- Treating `Codex turn completed` as a user-visible or dispatch-success signal.

Some legacy worktree code remains isolated for compatibility with old local
state and tests, but new Feishu/Lark takeover traffic must not route through it.

## User-Visible Output Rules

Feishu/Lark should see only concise user-facing states, for example:

```text
已派发到：检查并修复 codex-lark-remote 功能
```

```text
暂时无法派发，消息已保留。
原因：本地派发执行器暂时不可用。
```

```text
需要先选择目标会话。
```

Feishu/Lark should not see:

- `用户提示：` prompt echo blocks from Lark Remote's own dispatch.
- `# Files mentioned by the user` metadata.
- `<environment_context>` or other Codex runtime metadata.
- `Codex turn completed` token summaries.
- Raw bridge route contracts.
- Internal ids unless the user asks for diagnostics.

## Verification Checklist

Before releasing architecture changes, verify:

1. `npm test` passes.
2. The plugin manifest and package versions match.
3. `runtime.tgz` contains the current package version.
4. Local plugin cache and installed plugin directory are refreshed if testing in
   Codex Desktop.
5. The running bridge process is restarted, because already-running bridge code
   is not hot-reloaded.
6. A takeover smoke test dispatches one Feishu/Lark message to the selected
   target and returns exactly one concise dispatch acknowledgement.
7. Target output streams back without internal prompt echoes or runner metadata.
