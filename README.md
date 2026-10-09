# Animation Studio

Desktop application for creating and editing 2D animations, built with Electron and TypeScript.

Product requirements live in [`specs/`](specs) and are the source of truth:

- [HU_00001](specs/HU_00001.md) — Project Management
- [HU_00002](specs/HU_00002.md) — Application Home

## Getting started

Requires Node.js 20 or newer.

```bash
npm install          # install dependencies
npm run dev          # start the app with hot reload
npm run build        # production build into ./out
npm start            # run the production build
npm test             # run the automated tests
npm run typecheck    # strict TypeScript check (main/preload/core and renderer)
```

If Electron's binary was not downloaded during `npm install`, run `node node_modules/electron/install.js`.

## Architecture

```
Renderer (React)  ──►  Preload (contextBridge)  ──►  IPC  ──►  Main process
 presentation only       typed `window.api`                      Project Management + app state
```

| Layer | Location | Responsibility |
| --- | --- | --- |
| Main process | `src/main/` | App lifecycle, window creation with secure defaults, native dialogs, IPC handlers. Owns all filesystem access (through `core`). |
| Preload | `src/preload/` | Exposes the minimal, typed `window.api.project` to the renderer. No generic IPC and no Node/Electron objects are exposed. |
| Renderer | `src/renderer/` | Application Home and the placeholder project editor. Presentation state only; never touches the filesystem. |
| Core | `src/core/` | Electron-independent logic. `project/` is the Project Management layer; `application/` holds recent-project state and the `ProjectApplication` facade used by IPC. |
| Shared | `src/shared/` | Types and IPC channel contracts used on both sides of the boundary. |

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict CSP in production builds, and navigation/new-window blocking.

### IPC channels

`project:create`, `project:open`, `project:close`, `project:get-recent`, `project:remove-recent`, `project:select-directory`.
Every call returns an `IpcResult<T>` (`{ ok: true, value }` or `{ ok: false, error: { code, message } }`); error messages are user-safe and technical details are only logged in the main process.
`project:open` without a path makes the main process show the native directory dialog.

### Project Management (`src/core/project`)

- `ProjectService` — `createProject`, `openProject`, `closeProject`, `validateProject`, `repairProject`, `renameProject`, `getProjectMetadata`, `saveProjectMetadata`.
- `ProjectRepository` — the only code in the project layer that uses `fs`; writes `project.json` atomically (temp file + rename).
- Recent projects are application state, stored as JSON in Electron's `userData` directory behind the `RecentProjectRepository` interface (`src/core/application`). They are ordered by `lastOpenedAt` descending, deduplicated by project ID, and availability is computed at read time.

### Project directory structure

```
<ProjectName>/
├── project.json     # { formatVersion, id, name, createdAt, updatedAt }
├── scenes/
├── assets/
│   ├── images/
│   ├── audio/
│   ├── video/
│   └── fonts/
├── drawings/
├── exports/
└── .cache/          # regenerable data; never required for a valid project
```

## Tests

`npm test` runs Vitest:

- `tests/core` — project management and recent projects against real temporary directories.
- `tests/main` — IPC handlers and window security options.
- `tests/architecture` — process boundaries and the preload API surface.
- `tests/renderer` — Application Home states and flows (React Testing Library, mocked preload API).
