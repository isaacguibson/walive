# HU_00015 — Capability Inventory

Audit scope: editor domain, agent tools/runtime, MCP adapters, renderer binding, persistence, and Electron IPC. Status reflects implementation and focused tests, not the feature specification alone.

## Inventory

| Capability | Existing implementation and invocation | Status / agent access | Limitations and recommended action |
|---|---|---|---|
| Project and editor context | `EditorSession.getSnapshot`; `createEditorToolHost`; `get_project_info`, `list_scenes`, `list_frames`, `get_frame_layers` | Implemented; available to agents for the open project/scene | Context includes project name, canvas, FPS, active scene/frame/layer, frames, layers, assets. No general discovery tool enumerates supported operations. Extend context/tool documentation as additional operations are exposed. |
| Scene management | `useSceneWorkspace`, `ScenesAPI`, scene dialogs in `EditorPage`; host exposes `list_scenes` | Partially implemented; agents can list scenes only | Create, rename, select, duplicate and delete remain UI-only. Keep destructive approval and unsaved-change flow in the application; do not expose scene mutations until editor rebind/dirty-state behavior is designed. |
| Frame management | `AnimationEngine` and `EditorSession`; tools `list_frames`, `add_frame`, `duplicate_frame`, `select_frame`, `delete_frame`, `clear_frame` | Implemented for listed operations | `EditorSession.reorderFrame`, `copyFrame`, `cutFrame`, and `pasteFrame` exist but have no agent tools. No per-frame timing property exists in the current project model. Recommended: expose frame reorder and copy/paste through the host after target and clipboard semantics are covered by tests. |
| Layer management | `AnimationEngine` and `EditorSession`; tools `get_frame_layers`, `add_layer`, `rename_layer`, `set_layer_visibility`, `delete_layer` | Implemented for listed operations | `EditorSession.moveLayer` is available to the UI but not agents. The model has no layer-duplicate operation. Recommended: expose move/reorder; do not invent layer duplication without a domain operation. |
| Raster artwork and brush | `EditorSession` tools, `src/editor/drawing/*`; `draw_strokes`, `erase_strokes`, `fill_area` | Implemented; agents can create/erase/fill raster artwork on the active frame and explicit/active layer | Stroke color, size and opacity are per-call. Brush type/settings are editor state and are not selectable by agent calls. Raster pixels do not retain editable stroke metadata, so changing a brush setting cannot truthfully restyle existing strokes. Extend only through the existing brush/drawing engine and distinguish future-stroke settings from edits to pixels. |
| Bézier curves | `BezierTool`, `EditorSession` curve actions, `CurveEdit`, `AnimationEngine.beginCurveEdit`; curves are serialized with animation documents | Implemented in editor; no agent tools | UI supports curve creation, anchor/handle editing, selection, deletion, and applying the current curve style. Agents cannot inspect or mutate curves today. Recommended first extension: structured read/creation/edit operations over the existing curve model and `CurveEdit` history, with geometry/style validation; no pointer simulation. |
| Selection and transforms | `SelectionTool`, `EditorSession` selection preview, commit/settle and history integration | Implemented in editor; not exposed to agents | Agent has no selection query or explicit transform command. Add only through a typed EditorSession command that preserves pending/commit/cancel and undo semantics. |
| Rendering and preview | `framePreview.ts`, editor frame/layer renderers; `render_frame_preview` | Implemented; available to agents | Returns rendered PNG for image-capable models and a textual visual summary otherwise. Scene-sequence preview is not exposed. |
| Save, dirty state, undo and redo | `EditorSession`/`AnimationEngine` history and `createSaveRequest`; `useSceneWorkspace.save`; editor Save/Undo/Redo UI | Implemented in editor; not callable as agent tools | Agent edits enter normal undo history and dirty state. Save and undo/redo remain explicit UI actions; no agent tool reports/saves/undoes task changes. Keep project persistence owned by workspace; consider explicit status queries before exposing save/history commands. |
| Agent tool registry and execution | `AIToolRegistry`, `createProjectTools`, `AgentRuntime`, `AgentController` | Implemented and used by provider-backed agents | Stable IDs, JSON schemas, result schemas, read/modify/sensitive permissions, approvals, guard against scene changes, size/iteration/time limits and repeat-call limits exist. Tool definitions do not have a separate destructive boolean or cancellation hook; sensitive permission currently supplies approval. |
| MCP integration | `MCPClientService`, `McpPanel`, `AgentController.registerMcpTools` | Implemented; trusted/connected MCP tools are offered to agents | External calls require approval by default and outputs are marked untrusted and validated. Cancellation races the renderer call but cannot guarantee stopping a remote server or an already-running main-process request. MCP is an adapter for external tools, not an editor API. |
| IPC and Electron security | `registerAiIpcHandlers`, preload typed APIs, `contextIsolation` / `nodeIntegration` settings | Implemented for provider, MCP and conversation operations | Editor tools run against the renderer-owned `EditorSession` and do not cross IPC. Provider credentials and MCP processes remain in main. No arbitrary code execution is given to the agent; configured MCP stdio executables are explicit user configuration and trust-gated. |

## Verification

- `tests/ai/projectTools.test.ts` and `tests/renderer/aiHost.test.ts`: 25 tests passed during this audit.
- `tests/renderer/aiHost.test.ts` exercises drawing through the editor, visibility/target validation, frame/layer mutations, normal undo behavior, and previews.
- `tests/ai/projectTools.test.ts` exercises schemas, permissions, approvals, and tool registration.
- The audit found no existing MCP adapter that exposes editor operations; current MCP tools are third-party tools registered alongside the built-in editor tools.

## Recommended Implementation Order

1. Add agent-readable supported-operation discovery and complete frame/layer reorder operations already supported by `EditorSession`.
2. Expose structured Bézier inspection and creation/editing by reusing `CurveEdit` and existing curve validation/rendering, not simulated pointer events.
3. Expose supported selection transforms only after typed commit/cancel commands are available.
4. Keep scene mutations, frame timing, layer duplication, and raster restyling unavailable until their domain models support them safely.
5. Add explicit save/dirty/history tools only with the workspace persistence and approval semantics specified; current UI Save and Undo/Redo remain valid.

## Current Blocker

Source edits were not applied in this pass because the workspace's patch/edit operation was disabled and no text-file editing operation was available. The audit and focused tests are complete; implementation of the prioritized operations is pending an enabled source-editing operation.