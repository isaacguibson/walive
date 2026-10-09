import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonRecentProjectRepository } from '@core/application/jsonRecentProjectRepository';
import { ProjectApplication } from '@core/application/projectApplication';
import { RecentProjectsService } from '@core/application/recentProjectsService';
import { ProjectService } from '@core/project/projectService';
import { makeTempDir } from '../helpers/tempDir';

class Clock {
  constructor(private time: number) {}
  now = (): Date => new Date(this.time);
  advance(ms: number): void {
    this.time += ms;
  }
}

async function setup() {
  const root = await makeTempDir();
  const stateFile = path.join(root, 'app-data', 'recent-projects.json');
  const projectsDir = path.join(root, 'projects');
  const clock = new Clock(Date.parse('2026-10-06T12:00:00.000Z'));

  /** Builds a fresh application instance, as on an application restart. */
  function boot() {
    const projects = new ProjectService({ now: clock.now });
    const recents = new RecentProjectsService(new JsonRecentProjectRepository(stateFile), projects, clock.now);
    return { projects, recents, app: new ProjectApplication(projects, recents) };
  }

  return { root, stateFile, projectsDir, clock, boot };
}

describe('recent projects', () => {
  it('registers created projects at the application level, not inside the project', async () => {
    const { boot, projectsDir, stateFile } = await setup();
    const { app } = boot();
    await app.createProject('Registered', projectsDir);

    const recent = await app.getRecentProjects();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ name: 'Registered', path: path.join(projectsDir, 'Registered'), available: true });

    expect(await fs.readFile(stateFile, 'utf8')).toContain('Registered');
    const projectFiles = await fs.readdir(path.join(projectsDir, 'Registered'));
    expect(projectFiles).not.toContain('recent-projects.json');
  });

  it('orders projects by lastOpenedAt descending', async () => {
    const { boot, projectsDir, clock } = await setup();
    const { app } = boot();
    await app.createProject('First', projectsDir);
    clock.advance(60_000);
    await app.createProject('Second', projectsDir);
    clock.advance(60_000);
    await app.createProject('Third', projectsDir);

    expect((await app.getRecentProjects()).map((p) => p.name)).toEqual(['Third', 'Second', 'First']);
  });

  it('updates lastOpenedAt and reorders when a project is opened again', async () => {
    const { boot, projectsDir, clock } = await setup();
    const { app } = boot();
    await app.createProject('Old', projectsDir);
    clock.advance(60_000);
    await app.createProject('New', projectsDir);
    clock.advance(60_000);

    await app.openProject(path.join(projectsDir, 'Old'));

    const recent = await app.getRecentProjects();
    expect(recent.map((p) => p.name)).toEqual(['Old', 'New']);
    expect(recent[0]?.lastOpenedAt).toBe(new Date(clock.now()).toISOString());
  });

  it('does not duplicate a project that is opened repeatedly', async () => {
    const { boot, projectsDir } = await setup();
    const { app } = boot();
    await app.createProject('Once', projectsDir);
    await app.openProject(path.join(projectsDir, 'Once'));
    await app.openProject(path.join(projectsDir, 'Once'));
    expect(await app.getRecentProjects()).toHaveLength(1);
  });

  it('identifies a project by ID when it is moved, keeping a single entry', async () => {
    const { boot, projectsDir, clock } = await setup();
    const { app } = boot();
    await app.createProject('Mover', projectsDir);
    const before = (await app.getRecentProjects())[0];

    const moved = path.join(projectsDir, 'Moved');
    await fs.rename(path.join(projectsDir, 'Mover'), moved);
    clock.advance(1000);
    await app.openProject(moved);

    const recent = await app.getRecentProjects();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ projectId: before?.projectId, path: moved, available: true });
  });

  it('marks moved or deleted projects as unavailable without removing them', async () => {
    const { boot, projectsDir } = await setup();
    const { app } = boot();
    await app.createProject('Vanishing', projectsDir);
    await app.createProject('Staying', projectsDir);
    await fs.rm(path.join(projectsDir, 'Vanishing'), { recursive: true });

    const recent = await app.getRecentProjects();
    expect(recent).toHaveLength(2);
    expect(recent.find((p) => p.name === 'Vanishing')?.available).toBe(false);
    expect(recent.find((p) => p.name === 'Staying')?.available).toBe(true);
  });

  it('marks a project with a different ID at the same path as unavailable', async () => {
    const { boot, projectsDir } = await setup();
    const { app } = boot();
    await app.createProject('Replaced', projectsDir);
    const target = path.join(projectsDir, 'Replaced');
    await fs.rm(target, { recursive: true });
    await boot().projects.createProject('Replaced', projectsDir);

    expect((await app.getRecentProjects())[0]?.available).toBe(false);
  });

  it('removes only the registry entry and never deletes project files', async () => {
    const { boot, projectsDir } = await setup();
    const { app } = boot();
    await app.createProject('Removable', projectsDir);
    await fs.writeFile(path.join(projectsDir, 'Removable', 'drawings', 'keep.txt'), 'data');
    const [entry] = await app.getRecentProjects();

    await app.removeRecentProject(entry?.projectId ?? '');

    expect(await app.getRecentProjects()).toEqual([]);
    expect(await fs.readFile(path.join(projectsDir, 'Removable', 'drawings', 'keep.txt'), 'utf8')).toBe('data');
    expect(JSON.parse(await fs.readFile(path.join(projectsDir, 'Removable', 'project.json'), 'utf8'))).toMatchObject({
      name: 'Removable'
    });
  });

  it('persists recent projects across application restarts', async () => {
    const { boot, projectsDir } = await setup();
    await boot().app.createProject('Persistent', projectsDir);

    const restarted = boot();
    expect(restarted.projects.getCurrentProject()).toBeNull();
    const recent = await restarted.app.getRecentProjects();
    expect(recent.map((p) => p.name)).toEqual(['Persistent']);

    await restarted.app.openProject(recent[0]?.path ?? '');
    expect(restarted.projects.getProjectMetadata().name).toBe('Persistent');
  });

  it('does not register projects that fail to open', async () => {
    const { boot, projectsDir } = await setup();
    const { app } = boot();
    await fs.mkdir(projectsDir, { recursive: true });
    await expect(app.openProject(projectsDir)).rejects.toMatchObject({ code: 'NOT_A_PROJECT' });
    expect(await app.getRecentProjects()).toEqual([]);
  });

  it('keeps concurrent registrations without losing entries', async () => {
    const { boot, root } = await setup();
    const { recents } = boot();
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) => recents.register({ projectId: name, name, path: path.join(root, name) }))
    );
    expect((await recents.list()).map((p) => p.projectId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('recovers from a corrupt registry file by starting empty', async () => {
    const { boot, stateFile } = await setup();
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, '{ broken');

    expect(await boot().app.getRecentProjects()).toEqual([]);
    expect(await fs.readFile(`${stateFile}.corrupt`, 'utf8')).toBe('{ broken');
  });

  it('reports a registry that cannot be written', async () => {
    const { root } = await setup();
    const blocker = path.join(root, 'blocker');
    await fs.writeFile(blocker, '');
    const repository = new JsonRecentProjectRepository(path.join(blocker, 'state.json'));
    await expect(repository.save([])).rejects.toMatchObject({ code: 'STATE_WRITE_FAILED' });
  });

  it('still opens a project when the registry cannot be written', async () => {
    const { root, projectsDir, clock } = await setup();
    const blocker = path.join(root, 'blocker');
    await fs.writeFile(blocker, '');
    const projects = new ProjectService({ now: clock.now });
    const recents = new RecentProjectsService(
      new JsonRecentProjectRepository(path.join(blocker, 'state.json')),
      projects
    );
    const app = new ProjectApplication(projects, recents);

    await expect(app.createProject('Unregistered', projectsDir)).resolves.toMatchObject({ name: 'Unregistered' });
    expect(projects.getCurrentProject()).not.toBeNull();
  });
});

describe('project lifecycle through ProjectApplication', () => {
  it('create, close, reopen from recents', async () => {
    const { boot, projectsDir } = await setup();
    const { app, projects } = boot();

    const created = await app.createProject('Lifecycle', projectsDir);
    expect(projects.getCurrentProject()?.metadata.id).toBe(created.id);

    app.closeProject();
    expect(projects.getCurrentProject()).toBeNull();

    const [entry] = await app.getRecentProjects();
    const reopened = await app.openProject(entry?.path ?? '');
    expect(reopened).toEqual(created);
  });
});
