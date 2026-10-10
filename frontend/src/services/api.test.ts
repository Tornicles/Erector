import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  requireSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } }, error: null }),
    },
  }),
}));

import { authenticatedRequest } from './api';

describe('authenticatedRequest', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('rejects paths outside the application API', async () => {
    await expect(authenticatedRequest('api/v1/nope')).rejects.toThrow('Invalid application API path.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an undeployed API route with its address and status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html><body>404: NOT_FOUND</body></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    let failure: unknown;
    try {
      await authenticatedRequest('/api/v1/workspaces/w/productions/p/director/plan', { method: 'POST' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/did not answer/);
    expect((failure as Error).message).toMatch(/director\/plan/);
    expect((failure as Error).message).toMatch(/404/);
  });

  it('returns envelope data when the API answers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { ok: true }, errors: null, metadata: { request_id: 'r', timestamp: 't', version: 'v' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(authenticatedRequest('/api/health')).resolves.toEqual({ ok: true });
  });

  it('surfaces the backend envelope error message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, data: null, errors: [{ code: 'NOT_FOUND', type: 'not_found', message: 'Gone.' }], metadata: { request_id: 'r', timestamp: 't', version: 'v' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(authenticatedRequest('/api/health')).rejects.toThrow('Gone.');
  });
});
