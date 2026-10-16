import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInPanel } from '@/components/signin/SignInPanel';
import { requestEmailCode, verifyEmailCode } from '@/lib/auth/actions';

vi.mock('@/lib/auth/actions', () => ({
  requestEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
  startGitHubOAuth: vi.fn(),
}));

/**
 * The wired path (authEnabled). The pre-auth preview behaviour is covered by the
 * sign-in page test; here we lock the two-step email OTP flow: request a code,
 * advance to the code step, verify, resend cooldown, back-to-email, the error
 * surfaces, and GitHub-behind-config.
 */
describe('SignInPanel (wired auth)', () => {
  beforeEach(() => vi.clearAllMocks());

  const reachCodeStep = async (user: ReturnType<typeof userEvent.setup>) => {
    vi.mocked(requestEmailCode).mockResolvedValue({ ok: true });
    await user.type(screen.getByLabelText(/email/i), 'real@user.com');
    await user.click(screen.getByRole('button', { name: /email me a code/i }));
    return screen.findByRole('heading', { name: /enter your code/i });
  };

  it('advances to the code step after a code is requested', async () => {
    const user = userEvent.setup();
    render(<SignInPanel authEnabled codeLength={6} />);
    expect(screen.queryByText(/sign-in is not set up on this preview/i)).not.toBeInTheDocument();

    await reachCodeStep(user);

    expect(requestEmailCode).toHaveBeenCalledWith('real@user.com');
    const code = screen.getByLabelText(/code/i);
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  });

  /**
   * REGRESSION GUARD, half two of the Slice 1.5 prod bug. The first cut hardcoded
   * maxLength=6 and sliced input to 6 while the project emitted 8, so the real
   * emailed code was silently truncated to a prefix and every verify failed. The
   * field must carry whatever GoTrue issued, whole.
   */
  it('sends a code of the configured length whole', async () => {
    const user = userEvent.setup();
    render(<SignInPanel authEnabled next="/account" codeLength={6} />);
    await reachCodeStep(user);

    vi.mocked(verifyEmailCode).mockResolvedValue({ ok: false, error: 'nope' });
    await user.type(screen.getByLabelText(/code/i), '718149');
    expect(screen.getByLabelText(/code/i)).toHaveValue('718149');

    await user.click(screen.getByRole('button', { name: /verify and continue/i }));
    expect(verifyEmailCode).toHaveBeenCalledWith('real@user.com', '718149', '/account');
  });

  /**
   * COPY-VERSUS-REALITY GUARD.
   *
   * The original bug was two independent lies that each looked fine in isolation:
   * the UI said "6-digit code" and capped its input at 6, while the project
   * emitted 8. Everything a human reads must now be DERIVED from `codeLength`, so
   * a stated number and an accepted number cannot disagree.
   */
  describe.each([6, 7, 8, 10])('with codeLength=%i', (codeLength) => {
    const digits = (n: number) => '1234567890'.slice(0, n);

    it('states that length in the copy, and nowhere states a different one', async () => {
      const user = userEvent.setup();
      const { container } = render(<SignInPanel authEnabled codeLength={codeLength} />);
      await reachCodeStep(user);
      const text = container.textContent ?? '';
      expect(text).toContain(`${codeLength}-digit`);
      for (const other of [6, 7, 8, 9, 10].filter((n) => n !== codeLength)) {
        expect(text, `copy also claims ${other} digits`).not.toContain(`${other}-digit`);
      }
    });

    it('shows a placeholder of exactly that many characters', async () => {
      const user = userEvent.setup();
      render(<SignInPanel authEnabled codeLength={codeLength} />);
      await reachCodeStep(user);
      expect(screen.getByLabelText(/code/i).getAttribute('placeholder')).toHaveLength(codeLength);
    });

    it('accepts exactly that length and refuses to submit any other', async () => {
      const user = userEvent.setup();
      render(<SignInPanel authEnabled codeLength={codeLength} />);
      await reachCodeStep(user);
      const field = screen.getByLabelText(/code/i);
      const verify = () => screen.getByRole('button', { name: /verify and continue/i });

      await user.type(field, digits(codeLength - 1));
      expect(verify(), 'one digit short must not submit').toBeDisabled();

      await user.type(field, digits(codeLength).slice(codeLength - 1));
      expect(field).toHaveValue(digits(codeLength));
      expect(verify(), 'the stated length must submit').toBeEnabled();
    });

    /**
     * THE ORIGINAL BUG, generalized. If the real project emits MORE digits than
     * configured, the field must keep what was typed so the mismatch is visible
     * and the form stays shut. Capping at `codeLength` would re-create the silent
     * truncation: a prefix that looks complete and verifies as garbage.
     *
     * Skipped at the ceiling, where it is not expressible: 10 is the most
     * Supabase can emit, so when `codeLength` is 10 there is no longer real code
     * for the field to be mismatched against.
     */
    it.skipIf(codeLength >= 10)(
      'never silently truncates a longer code into a submittable one',
      async () => {
        const user = userEvent.setup();
        render(<SignInPanel authEnabled codeLength={codeLength} />);
        await reachCodeStep(user);
        const field = screen.getByLabelText(/code/i);

        // One digit more than configured: exactly the shape of the outage.
        await user.type(field, digits(codeLength) + '7');
        expect(field, 'input was truncated to the expected length').toHaveValue(
          digits(codeLength) + '7',
        );
        expect(
          screen.getByRole('button', { name: /verify and continue/i }),
          'a wrong-length code must never be submittable',
        ).toBeDisabled();
      },
    );
  });

  it('surfaces the request error and stays on the email step', async () => {
    vi.mocked(requestEmailCode).mockResolvedValue({
      ok: false,
      error: 'email rate limit exceeded',
    });
    const user = userEvent.setup();
    render(<SignInPanel authEnabled codeLength={6} />);

    await user.type(screen.getByLabelText(/email/i), 'real@user.com');
    await user.click(screen.getByRole('button', { name: /email me a code/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/rate limit/i));
    // Still on the email step: it did not advance to the code step.
    expect(screen.queryByRole('heading', { name: /enter your code/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('surfaces a wrong-code error and stays on the code step', async () => {
    const user = userEvent.setup();
    render(<SignInPanel authEnabled next="/account" codeLength={6} />);
    await reachCodeStep(user);

    vi.mocked(verifyEmailCode).mockResolvedValue({
      ok: false,
      error: 'That code is incorrect or has expired. Enter the latest one or resend a new code.',
    });
    await user.type(screen.getByLabelText(/code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify and continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect or has expired/i);
    expect(verifyEmailCode).toHaveBeenCalledWith('real@user.com', '000000', '/account');
    expect(screen.getByRole('heading', { name: /enter your code/i })).toBeInTheDocument();
    // The field is marked invalid and linked to the error for screen readers.
    const codeInput = screen.getByLabelText(/code/i);
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    expect(codeInput.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('announces a new code on resend', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(requestEmailCode).mockResolvedValue({ ok: true });
      render(<SignInPanel authEnabled codeLength={6} />);
      const emailInput = screen.getByLabelText(/email/i);
      fireEvent.change(emailInput, { target: { value: 'real@user.com' } });
      fireEvent.submit(emailInput.closest('form')!);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      // Wait out the cooldown, then resend.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000);
      });
      fireEvent.click(screen.getByRole('button', { name: /^resend code$/i }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole('status')).toHaveTextContent(/new code sent/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to the email step from the code step', async () => {
    const user = userEvent.setup();
    render(<SignInPanel authEnabled codeLength={6} />);
    await reachCodeStep(user);

    await user.click(screen.getByRole('button', { name: /use a different email/i }));
    expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /enter your code/i })).not.toBeInTheDocument();
  });

  /**
   * The focus handoff must be symmetric. Going FORWARD already focused the code
   * field; going BACK left focus on a button that no longer exists, so the browser
   * reset it to <body> and a keyboard or screen-reader user was silently dropped
   * at the top of the document (WCAG 2.4.3 Focus Order).
   */
  it('moves focus to the code field forward, and back to the email field on return', async () => {
    const user = userEvent.setup();
    render(<SignInPanel authEnabled codeLength={6} />);
    await reachCodeStep(user);
    await waitFor(() => expect(screen.getByLabelText(/code/i)).toHaveFocus());

    await user.click(screen.getByRole('button', { name: /use a different email/i }));
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toHaveFocus());
  });

  it('does not steal focus on first mount', () => {
    render(<SignInPanel authEnabled codeLength={6} />);
    // Nothing was requested yet, so the panel must leave the document's natural
    // entry point (the skip link / top of page) alone.
    expect(screen.getByLabelText(/email/i)).not.toHaveFocus();
  });

  it('disables resend during the cooldown then re-enables it', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(requestEmailCode).mockResolvedValue({ ok: true });
      render(<SignInPanel authEnabled codeLength={6} />);
      // fireEvent is synchronous (no userEvent internal delays that stall under
      // fake timers). Drive the email step, then flush the request transition.
      const emailInput = screen.getByLabelText(/email/i);
      fireEvent.change(emailInput, { target: { value: 'real@user.com' } });
      fireEvent.submit(emailInput.closest('form')!);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: /resend code in \d+s/i })).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000);
      });
      expect(screen.getByRole('button', { name: /^resend code$/i })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enables the GitHub button when GitHub OAuth is configured', () => {
    render(<SignInPanel authEnabled githubEnabled codeLength={6} />);
    expect(screen.getByRole('button', { name: /continue with github/i })).not.toBeDisabled();
  });

  it('surfaces a clear reason (not a blank form) on a prior sign-in failure', () => {
    render(<SignInPanel authEnabled authError codeLength={6} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not complete that sign-in/i);
    expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument();
  });

  it('shows no failure notice when there is no prior error', () => {
    render(<SignInPanel authEnabled codeLength={6} />);
    expect(screen.queryByText(/could not complete that sign-in/i)).not.toBeInTheDocument();
  });

  /**
   * N1. A form with no method submits as GET. Submitted before hydration (no
   * onSubmit yet to prevent it), the email form would put the address in the
   * URL, where it lands in history, logs and the Referer. Both forms POST.
   */
  it('posts the email form, so a submit before hydration never puts the address in a URL', () => {
    render(<SignInPanel authEnabled codeLength={6} />);
    const form = screen.getByLabelText(/email/i).closest('form');
    expect(form).toHaveAttribute('method', 'post');
  });

  it('posts the code form too', async () => {
    const user = userEvent.setup();
    render(<SignInPanel authEnabled codeLength={6} />);
    await reachCodeStep(user);
    const form = screen.getByLabelText(/code/i).closest('form');
    expect(form).toHaveAttribute('method', 'post');
  });
});
