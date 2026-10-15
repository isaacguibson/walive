# Animation Studio

Desktop application for creating and editing 2D animations, built with Electron and TypeScript.

## Getting started

Requires Node.js 22.12 or newer for development and packaging.

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

### Connect

In **AI Settings > AI Providers**, add **GitHub Copilot** and save it. Then either:

- Authenticate with the official Copilot CLI and click **Connect CLI Account**.
	Animation Studio uses the SDK's documented signed-in-user authentication; it never reads or copies CLI token files.
- Register your own GitHub OAuth App, enable **Device Flow**, enter its public **Client ID**
	in the provider form, save, and click **Sign in with GitHub**. Open the displayed GitHub
	authorization link and enter the device code. No client secret or repository scopes are requested.
	This follows the [SDK OAuth integration](https://github.com/github/copilot-sdk/blob/main/docs/setup/github-oauth.md)
	and [GitHub device authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).

The device flow stores application-owned access/refresh tokens only through OS-encrypted
credential storage. A valid Copilot entitlement and applicable organization approval are still required.
Disconnecting stops application sessions, forgets application-owned authorization and model caches,
but does not revoke authorization globally or sign other GitHub applications out.

Refresh Models, select an available model, and send a request. Model availability, image support
and effort values come from SDK metadata. Undocumented effort values are not mapped.
Session references are stored under application data, not in project files. Compatible sessions
are resumed; incompatible or unavailable ones are rebuilt from normalized conversation history.
Errors after tools have run are not automatically retried, avoiding accidental duplicate edits.

### Windows Packaging

Run `npm run package:win` to generate the Windows x64 NSIS installer in `release/`.
Set `ARCH=arm64` to package Windows ARM64 instead.

The application window and Windows packaging use
`src/assets/icons/android-chrome-512x512.png`. Electron Builder converts this
high-resolution source into the Windows icon embedded in the application,
installer and uninstaller; desktop and Start menu shortcuts use the application icon.
The packaging script copies the source icons into its temporary build directory.
The small `favicon.ico` is intended for browsers, not Windows application packaging.

Rebuild and reinstall to apply icon changes. Windows may cache older shortcut/taskbar
icons; unpin and pin the application again if necessary. The installer is unsigned,
so these changes do not remove Windows SmartScreen warnings or add a verified publisher.

### macOS Packaging

Run `npm run package:mac` on macOS. It packages the current architecture by default;
`ARCH=x64` requires the matching optional SDK platform package to be installed.
Production dependencies, including the SDK platform runtime and native libraries, remain
outside ASAR so the SDK can resolve and materialize its verified runtime artifacts.
No runtime download or development-only executable path is required.

`APPLE_SIGNING_IDENTITY` enables hardened-runtime signing. Distribution still requires an Apple
Developer identity and notarization (for example, `xcrun notarytool submit ... --wait` and
`xcrun stapler staple ...` after creating a supported archive). Verify all nested native
executables/libraries are signed and test on a clean Mac before publishing. Do not distribute
the unsigned development package as a notarized release.

The credential-free smoke check starts/stops the real runtime without making model requests:

```bash
npm run test:copilot-runtime
ELECTRON_RUN_AS_NODE=1 "dist/Animation Studio-darwin-arm64/Animation Studio.app/Contents/MacOS/Animation Studio" scripts/copilotSmoke.cjs "dist/Animation Studio-darwin-arm64/Animation Studio.app/Contents/Resources/app"
```

Authentication errors require reconnecting; model errors require Refresh Models. Missing platform
artifacts or executable permissions are reported as runtime errors. Copilot usage and quotas apply.
An authorized account is required to verify the real editing acceptance scenario; automated tests
use SDK mocks and never require account credentials.

### SDK Upgrades

Update with `npm install --save-exact @github/copilot-sdk@<version>`. Review the release's
authentication, session/tool filters, event types, license and bundled platform runtime changes.
Run `npm run typecheck`, `npm test`, the runtime smoke check, and `npm run package:mac`.
Then verify signed/notarized packaging and the authorized inspect/create/draw/preview/Undo/save/reopen
scenario before releasing. Never enable additional built-in tools to work around an SDK change.
