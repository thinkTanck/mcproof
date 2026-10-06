import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SignIn from '@/app/sign-in/page';

/**
 * Sign-in (BRAND · front door · pre-auth). Standalone route (outside the (hud)
 * shell) so the signed-out gate owns its own `main` landmark and never surfaces
 * the authenticated command deck. These RED assertions pin the a11y contract:
 * a main landmark, a labelled email field, a named primary control, and a
 * single top-level heading (no heading-order jump).
 */
/** SignIn is an async server component reading `searchParams`; await it to an
 *  element before handing it to RTL. */
const renderPage = async (searchParams: Record<string, string> = {}) =>
  render(await SignIn({ searchParams: Promise.resolve(searchParams) }));

describe('Sign-in screen', () => {
  it('renders a main landmark', async () => {
    await renderPage();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('gives the email input an accessible label', async () => {
    await renderPage();
    const email = screen.getByLabelText(/email/i);
    expect(email).toBeInTheDocument();
    expect(email).toHaveAttribute('type', 'email');
  });

  it('names the primary code-request button', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument();
  });

  it('has a single level-1 heading and no heading-order jump', async () => {
    await renderPage();
    const headings = screen.getAllByRole('heading');
    // First heading in the document must be the page h1.
    expect(headings[0]?.tagName).toBe('H1');
    expect(
      screen.getByRole('heading', { level: 1, name: /continue to mcpwn/i }),
    ).toBeInTheDocument();
    // No h2/h3 appear before the h1 (no skipped/inverted levels).
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('does not claim an email was sent (honest preview; auth is unwired)', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText(/email/i), 'tester@example.com');
    await user.click(screen.getByRole('button', { name: /email me a code/i }));
    expect(screen.queryByText(/we sent/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no email is sent in this preview/i)).toBeInTheDocument();
  });

  it('returns focus to the email field when the preview is dismissed', async () => {
    // Same focus-order contract as the wired code step: leaving a state that
    // removed the focused control must hand focus to the field the visitor is
    // being sent back to, not drop it on <body> (WCAG 2.4.3).
    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText(/email/i), 'tester@example.com');
    await user.click(screen.getByRole('button', { name: /email me a code/i }));

    await user.click(screen.getByRole('button', { name: /use a different email/i }));
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toHaveFocus());
  });

  it('sizes the headline against the panel column, not the full-bleed main', async () => {
    // `--reading-h1` is clamp(32px, 5cqi, 44px), and `cqi` resolves against the
    // NEAREST query container. Sign-in's <main> is a full-bleed centring frame,
    // so a container established there makes 5cqi behave as 5vw — the exact
    // failure CLAUDE.md's "cqi, never vw" rule exists to prevent, and the reason
    // a 380px panel was rendering a 44px headline the frozen design sets at 34px.
    // The container has to be the column the heading actually lives in.
    await renderPage();
    const h1 = screen.getByRole('heading', { level: 1, name: /continue to mcpwn/i });
    const container = h1.closest('.type-flow');
    expect(container, 'the headline has a query container').not.toBeNull();
    expect(container?.tagName, 'the container is the panel column, not <main>').not.toBe('MAIN');
    expect(container?.className, 'the container is the width-capped panel column').toContain(
      'max-w-[380px]',
    );
  });

  it('explains a failed sign-in (?error=auth) instead of a blank form', async () => {
    render(await SignIn({ searchParams: Promise.resolve({ error: 'auth' }) }));
    expect(screen.getByRole('alert')).toHaveTextContent(/could not complete that sign-in/i);
  });

  it('shows no failure notice on a normal visit (no error param)', async () => {
    render(await SignIn({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText(/could not complete that sign-in/i)).not.toBeInTheDocument();
  });

  it('passes next through so verify can honor it', async () => {
    render(await SignIn({ searchParams: Promise.resolve({ next: '/leaderboard' }) }));
    // The panel renders; next is wired to the client component (asserted via the
    // panel's own verify test). Here we just confirm the page renders with a next.
    expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument();
  });

  it('gives the promised sample a keyless door, and does not ship inert OAuth', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: /watch the sample run/i })).toHaveAttribute(
      'href',
      '/runs/sample',
    );
    // Unwired OAuth is disabled, not a silent no-op.
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
  });
});

// Sign-in sits outside the HUD shell: it has no status bar, so it has no mode chip.
describe('Sign-in page · no shell chrome', () => {
  it('renders no banner and no mode chip', async () => {
    render(await SignIn({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByText(/^(SAMPLE|LIVE)$/)).not.toBeInTheDocument();
  });
});
