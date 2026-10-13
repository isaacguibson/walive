// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import {
  createMockAnimationApi,
  createMockApi,
  createMockAssetsApi,
  createMockExportApi,
  createMockScenesApi,
  fail,
  metadata,
  ok,
  recent
} from './helpers';

async function expectEditor(name: string) {
  // The loading screen shares the heading, so wait for the loaded editor first.
  await screen.findByRole('button', { name: 'Close Project' });
  expect(screen.getByRole('heading', { name })).toBeInTheDocument();
}

function renderApp(api = createMockApi()) {
  const user = userEvent.setup();
  const animationApi = createMockAnimationApi();
  render(
    <App
      api={api}
      animationApi={animationApi}
      assetsApi={createMockAssetsApi()}
      scenesApi={createMockScenesApi()}
      exportApi={createMockExportApi()}
    />
  );
  return { api, animationApi, user };
}

describe('Application Home states', () => {
  it('starts on the Application Home with both primary actions', async () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Animation Studio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create New Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Existing Project' })).toBeInTheDocument();
    expect(await screen.findByText('No recent projects')).toBeInTheDocument();
  });

  it('shows a loading state while recent projects load', () => {
    renderApp(createMockApi({ getRecentProjects: () => new Promise(() => undefined) }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading recent projects...');
  });

  it('shows a useful empty state', async () => {
    renderApp();
    expect(await screen.findByText('No recent projects')).toBeInTheDocument();
    expect(screen.getByText(/Create a new project or open an existing project to get started/)).toBeInTheDocument();
  });

  it('renders recent projects with name, location, and last opened date, in the given order', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    renderApp(
      createMockApi({
        getRecentProjects: async () =>
          ok([recent('My Animation'), recent('Character Test', { lastOpenedAt: yesterday })])
      })
    );

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('My Animation')).toBeInTheDocument();
    expect(within(items[0]!).getByText('/projects/My Animation')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Last opened: Today')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Character Test')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Last opened: Yesterday')).toBeInTheDocument();
  });

  it('marks unavailable projects clearly and keeps them visible', async () => {
    renderApp(
      createMockApi({
        getRecentProjects: async () => ok([recent('Lost', { available: false }), recent('Found')])
      })
    );

    const lost = (await screen.findByText('Lost')).closest('li')!;
    expect(within(lost).getByText('Unavailable')).toBeInTheDocument();
    expect(within(lost).getByText('The project could not be found at its previous location.')).toBeInTheDocument();
    expect(within(lost).queryByRole('button', { name: 'Open Lost' })).not.toBeInTheDocument();
    expect(within(lost).getByRole('button', { name: /Remove Lost/ })).toBeEnabled();
  });

  it('shows an error state with retry when recent projects cannot be loaded', async () => {
    let attempts = 0;
    const { user } = renderApp(
      createMockApi({
        getRecentProjects: async () => (++attempts === 1 ? fail('Recent projects could not be loaded.') : ok([]))
      })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Recent projects could not be loaded.');
    expect(screen.getByRole('button', { name: 'Create New Project' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No recent projects')).toBeInTheDocument();
  });
});

describe('Open Existing Project', () => {
  it('requests the native dialog through the API (no path) and shows the editor on success', async () => {
    const { api, user } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'Open Existing Project' }));

    expect(api.openProject).toHaveBeenCalledWith();
    await expectEditor('Opened');
    expect(screen.queryByRole('button', { name: 'Create New Project' })).not.toBeInTheDocument();
  });

  it('stays on the Home when the dialog is cancelled', async () => {
    const { user } = renderApp(createMockApi({ openProject: async () => ok(null) }));
    await user.click(await screen.findByRole('button', { name: 'Open Existing Project' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Existing Project' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an understandable error for invalid projects and stays on the Home', async () => {
    const { user } = renderApp(
      createMockApi({
        openProject: async () => fail('The selected folder is not a valid Animation Studio project.', 'NOT_A_PROJECT')
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Open Existing Project' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to open project.');
    expect(alert).toHaveTextContent('The selected folder is not a valid Animation Studio project.');
    expect(screen.getByRole('button', { name: 'Create New Project' })).toBeInTheDocument();
  });

  it('shows the loading message and blocks other actions while opening', async () => {
    let finish: () => void = () => undefined;
    const { user } = renderApp(
      createMockApi({
        openProject: () => new Promise((resolve) => (finish = () => resolve(ok(metadata('Slow')))))
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Open Existing Project' }));

    expect(screen.getByText('Opening project...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create New Project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open Existing Project' })).toBeDisabled();

    finish();
    await expectEditor('Slow');
  });
});

describe('Recent project actions', () => {
  it('opens the selected recent project by its path', async () => {
    const { api, user } = renderApp(
      createMockApi({ getRecentProjects: async () => ok([recent('Alpha'), recent('Beta')]) })
    );
    await user.click(await screen.findByRole('button', { name: 'Open Beta' }));

    expect(api.openProject).toHaveBeenCalledWith('/projects/Beta');
    await expectEditor('Opened');
  });

  it('reports a failure to open a recent project and refreshes the list', async () => {
    const { api, user } = renderApp(
      createMockApi({
        getRecentProjects: async () => ok([recent('Alpha')]),
        openProject: async () => fail('The project could not be found at this location.')
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Open Alpha' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The project could not be found at this location.');
    await waitFor(() => expect(api.getRecentProjects).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
  });

  it('asks for confirmation before removing an available project', async () => {
    const { api, user } = renderApp(createMockApi({ getRecentProjects: async () => ok([recent('Alpha')]) }));
    await user.click(await screen.findByRole('button', { name: 'Remove Alpha from recent projects' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('This will not delete the project from your computer.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.removeRecentProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removes a recent project after confirmation and refreshes the list', async () => {
    let projects = [recent('Alpha')];
    const { api, user } = renderApp(
      createMockApi({
        getRecentProjects: async () => ok(projects),
        removeRecentProject: async () => {
          projects = [];
          return ok(undefined);
        }
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Remove Alpha from recent projects' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));

    expect(api.removeRecentProject).toHaveBeenCalledWith('id-Alpha');
    expect(await screen.findByText('No recent projects')).toBeInTheDocument();
  });

  it('removes an unavailable project directly', async () => {
    const { api, user } = renderApp(
      createMockApi({ getRecentProjects: async () => ok([recent('Lost', { available: false })]) })
    );
    await user.click(await screen.findByRole('button', { name: 'Remove Lost from recent projects' }));
    expect(api.removeRecentProject).toHaveBeenCalledWith('id-Lost');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Create New Project', () => {
  async function openDialog(api = createMockApi()) {
    const { user } = renderApp(api);
    await user.click(await screen.findByRole('button', { name: 'Create New Project' }));
    return { api, user, dialog: screen.getByRole('dialog', { name: 'Create New Project' }) };
  }

  it('creates a project with the entered name, chosen location, and canvas metadata, then shows the editor', async () => {
    const { api, user } = await openDialog();
    await user.type(screen.getByLabelText('Project Name'), 'My Animation');
    await user.click(screen.getByRole('button', { name: 'Browse...' }));
    expect(screen.getByLabelText('Location')).toHaveValue('/chosen/location');

    await user.clear(screen.getByLabelText('Width'));
    await user.type(screen.getByLabelText('Width'), '1280');
    await user.clear(screen.getByLabelText('Height'));
    await user.type(screen.getByLabelText('Height'), '720');
    await user.click(screen.getByLabelText('Keep Aspect Ratio'));
    await user.clear(screen.getByLabelText('Aspect Ratio Width'));
    await user.type(screen.getByLabelText('Aspect Ratio Width'), '16');
    await user.clear(screen.getByLabelText('Aspect Ratio Height'));
    await user.type(screen.getByLabelText('Aspect Ratio Height'), '9');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(api.createProject).toHaveBeenCalledWith('My Animation', '/chosen/location', {
      width: 1280,
      height: 720,
      keepAspectRatio: true,
      aspectRatio: { width: 16, height: 9 }
    });
    await expectEditor('My Animation');
  });

  it('validates input before calling the API', async () => {
    const { api, user } = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a project name.');

    await user.type(screen.getByLabelText('Project Name'), 'Named');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select a location for the project.');
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('shows creation errors in the dialog without exposing technical details', async () => {
    const { user } = await openDialog(
      createMockApi({ createProject: async () => fail('A project with this name already exists.') })
    );
    await user.type(screen.getByLabelText('Project Name'), 'Dup');
    await user.type(screen.getByLabelText('Location'), '/somewhere');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A project with this name already exists.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('shows progress and prevents duplicate submissions', async () => {
    let finish: () => void = () => undefined;
    const createProject = (name: string) =>
      new Promise<ReturnType<typeof ok<ReturnType<typeof metadata>>>>((resolve) => (finish = () => resolve(ok(metadata(name)))));
    const { api, user } = await openDialog(createMockApi({ createProject }));

    await user.type(screen.getByLabelText('Project Name'), 'Once');
    await user.type(screen.getByLabelText('Location'), '/somewhere');
    const submit = screen.getByRole('button', { name: 'Create' });
    await user.click(submit);
    await user.click(submit);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('status')).toHaveTextContent('Creating project...');
    expect(submit).toBeDisabled();
    expect(api.createProject).toHaveBeenCalledTimes(1);

    finish();
    await expectEditor('Once');
    expect(api.createProject).toHaveBeenCalledTimes(1);
  });

  it('closes with Cancel and with Escape', async () => {
    const { user } = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create New Project' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Closing a project', () => {
  it('returns to the Application Home and refreshes recent projects', async () => {
    let projects = [recent('Alpha')];
    const { api, user } = renderApp(createMockApi({ getRecentProjects: async () => ok(projects) }));

    await user.click(await screen.findByRole('button', { name: 'Open Alpha' }));
    await expectEditor('Opened');
    expect(api.getRecentProjects).toHaveBeenCalledTimes(1);

    projects = [recent('Opened'), recent('Alpha')];
    await user.click(await screen.findByRole('button', { name: 'Close Project' }));

    expect(api.closeProject).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Open Opened' })).toBeInTheDocument();
    expect(api.getRecentProjects).toHaveBeenCalledTimes(2);
  });

  it('stays in the editor and reports an error if closing fails', async () => {
    const { user } = renderApp(createMockApi({ closeProject: async () => fail('Unable to close.') }));
    await user.click(await screen.findByRole('button', { name: 'Open Existing Project' }));
    await user.click(await screen.findByRole('button', { name: 'Close Project' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to close.');
    expect(screen.getByRole('heading', { name: 'Opened' })).toBeInTheDocument();
  });
});
