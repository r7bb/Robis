'use client';

import {
  contracts,
  PROJECT_TEMPLATES,
  type ProjectTemplate,
  TEMPLATE_DETAILS,
  THEME_IDS,
  THEMES,
  type ThemeId,
} from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { MyInvitations } from '../../components/my-invitations.tsx';
import { ApiError, call } from '../../lib/api.ts';
import { useRequireAvatar } from '../../lib/use-require-avatar.ts';

/**
 * The first run (C5): from a new account to a board with work on it in a
 * few steps. Name a workspace (or accept an invitation already waiting),
 * pick its look, invite someone by username, and start a first project
 * from a template. Everything after the first step can be skipped, and the
 * first can be put off by looking around a demo workspace instead.
 */

type Step = 'workspace' | 'team' | 'project';

const FIELD =
  'w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';
const PRIMARY =
  'rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const QUIET =
  'rounded-md border border-line px-3 py-2 text-sm text-muted hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

const STEPS: Step[] = ['workspace', 'team', 'project'];
const TITLES: Record<Step, string> = {
  workspace: 'Name your workspace',
  team: 'Its look, and a teammate',
  project: 'Start a first project',
};

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That did not work. Try again.';

export function FirstRunFlow() {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: () => call(contracts['auth.me']) });
  // A picture first, as everywhere else in the app.
  useRequireAvatar(me.data);
  const [step, setStep] = useState<Step>('workspace');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<ThemeId>('midnight');
  const [username, setUsername] = useState('');
  const [invited, setInvited] = useState<string[]>([]);
  const [projectName, setProjectName] = useState('First project');
  const [template, setTemplate] = useState<ProjectTemplate | 'blank'>('software');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  const createWorkspace = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const made = await call(contracts['workspaces.create'], { body: { name: name.trim() } });
      setWorkspaceId(made.workspace.id);
      setStep('team');
    });
  };
  // Example work to look around first (C5): the demo opens on its board,
  // and the real workspace can be made whenever, from home.
  const openDemo = () =>
    run(async () => {
      const made = await call(contracts['workspaces.createDemo'], {
        body: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      router.replace(`/workspaces/${made.workspace.id}/projects/${made.projectId}`);
    });
  const chooseTheme = (id: ThemeId) =>
    run(async () => {
      setTheme(id);
      await call(contracts['workspaces.update'], {
        params: { workspaceId: workspaceId! },
        body: { theme: id },
      });
    });
  const invite = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await call(contracts['members.invite'], {
        params: { workspaceId: workspaceId! },
        body: { username: username.trim().replace(/^@/, ''), role: 'MEMBER' },
      });
      setInvited((list) => [...list, username.trim()]);
      setUsername('');
    });
  };
  const createProject = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const made = await call(contracts['projects.create'], {
        params: { workspaceId: workspaceId! },
        body: { name: projectName.trim(), ...(template === 'blank' ? {} : { template }) },
      });
      router.replace(`/workspaces/${workspaceId}/projects/${made.project.id}`);
    });
  };

  return (
    <main className="mx-auto grid min-h-[100dvh] w-full max-w-lg content-center px-4 py-10">
      <p className="text-xs text-faint">
        Step {STEPS.indexOf(step) + 1} of {STEPS.length}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-content">{TITLES[step]}</h1>

      {step === 'workspace' ? (
        <>
          <form onSubmit={createWorkspace} className="mt-5 space-y-3">
            <label htmlFor="first-workspace" className="block text-xs text-muted">
              A workspace is where a team keeps its boards, documents and chat.
            </label>
            <input
              id="first-workspace"
              className={FIELD}
              required
              maxLength={80}
              placeholder="Design team"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className={PRIMARY} disabled={busy}>
              Create workspace
            </button>
          </form>
          <div className="mt-6">
            <MyInvitations me={me.data} focusAfter="first-workspace" />
          </div>
          <div className="mt-8 border-t border-line pt-5">
            <p className="text-xs text-muted">
              Or look around first: a demo workspace with a board, a document, a channel and a
              meeting already in it, to change and throw away.
            </p>
            <button
              type="button"
              className={`${QUIET} mt-3`}
              disabled={busy}
              onClick={() => void openDemo()}
            >
              Look around a demo workspace
            </button>
          </div>
        </>
      ) : null}

      {step === 'team' ? (
        <div className="mt-5 space-y-4">
          <ul className="grid grid-cols-3 gap-2">
            {THEME_IDS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={theme === id}
                  onClick={() => void chooseTheme(id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${theme === id ? 'border-accent text-content' : 'border-line text-muted hover:text-content'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft`}
                >
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded-full"
                    style={{ background: THEMES[id].swatch }}
                  />
                  {THEMES[id].label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 'team' ? (
        <div className="mt-5 space-y-3">
          <form onSubmit={invite} className="flex gap-2">
            <label htmlFor="first-invite" className="sr-only">
              Their username
            </label>
            <input
              id="first-invite"
              className={FIELD}
              placeholder="@username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <button type="submit" className={QUIET} disabled={busy || !username.trim()}>
              Invite
            </button>
          </form>
          {invited.length > 0 ? (
            <p className="text-xs text-muted">Invited: {invited.join(', ')}</p>
          ) : null}
          <button type="button" className={PRIMARY} onClick={() => setStep('project')}>
            Continue
          </button>
        </div>
      ) : null}

      {step === 'project' ? (
        <form onSubmit={createProject} className="mt-5 space-y-4">
          <label htmlFor="first-project" className="block text-xs text-muted">
            Its name
          </label>
          <input
            id="first-project"
            className={FIELD}
            required
            maxLength={80}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted">Start it with</legend>
            {[...PROJECT_TEMPLATES, 'blank' as const].map((id) => (
              <label
                key={id}
                className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-sm text-content"
              >
                <input
                  type="radio"
                  name="template"
                  value={id}
                  checked={template === id}
                  onChange={() => setTemplate(id)}
                  className="mt-1"
                />
                <span>
                  {id === 'blank' ? 'Nothing yet' : TEMPLATE_DETAILS[id].label}
                  <span className="block text-xs text-muted">
                    {id === 'blank'
                      ? 'An empty board.'
                      : `${TEMPLATE_DETAILS[id].description} Five starter issues.`}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className={PRIMARY} disabled={busy}>
            Create the project
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger-soft">
          {error}
        </p>
      ) : null}
    </main>
  );
}
