import { GET } from '@/app/auth/callback/route';
import { createServerSupabase } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }));

const withExchange = (result: { error: unknown }) =>
  vi.mocked(createServerSupabase).mockResolvedValue({
    auth: { exchangeCodeForSession: vi.fn().mockResolvedValue(result) },
  } as never);

describe('auth callback route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exchanges the code and redirects to next (default /account)', async () => {
    withExchange({ error: null });
    const res = await GET(new Request('https://mcproof.test/auth/callback?code=abc'));
    expect(res.headers.get('location')).toBe('https://mcproof.test/account');
  });

  it('honours an explicit next target', async () => {
    withExchange({ error: null });
    const res = await GET(
      new Request('https://mcproof.test/auth/callback?code=abc&next=/leaderboard'),
    );
    expect(res.headers.get('location')).toBe('https://mcproof.test/leaderboard');
  });

  it('bounces to sign-in when the code is missing', async () => {
    const res = await GET(new Request('https://mcproof.test/auth/callback'));
    expect(res.headers.get('location')).toBe('https://mcproof.test/sign-in?error=auth');
  });

  it('bounces to sign-in when the exchange fails', async () => {
    withExchange({ error: { message: 'bad code' } });
    const res = await GET(new Request('https://mcproof.test/auth/callback?code=abc'));
    expect(res.headers.get('location')).toBe('https://mcproof.test/sign-in?error=auth');
  });
});
