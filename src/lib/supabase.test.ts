import { describe, it, expect, vi, afterEach } from 'vitest';

describe('supabase client configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws a clear error when env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    await expect(import('./supabase')).rejects.toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it('creates the client when env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

    const mod = await import('./supabase');
    expect(mod.supabase).toBeDefined();
  });
});
