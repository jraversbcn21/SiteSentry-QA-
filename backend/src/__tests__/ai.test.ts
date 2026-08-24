import { explainWithAi, getAiStatus } from '../services/AiService';

var validInput = {
  type: 'BROKEN_RESOURCE',
  severity: 'HIGH',
  description: 'Imagen rota',
  url: 'https://example.com/img.png',
};

function mockAiOk(content: string) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: content } }] }),
  });
}

describe('AiService', () => {
  var originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.OPENROUTER_MODEL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  describe('explainWithAi', () => {
    it('returns explanation on success', async () => {
      mockAiOk('Explicacion de prueba');
      var result = await explainWithAi(validInput);
      expect(result).toBe('Explicacion de prueba');
    });

    it('sends the requested whitelisted model', async () => {
      mockAiOk('ok');
      await explainWithAi({ ...validInput, model: 'meta-llama/llama-3.3-70b-instruct' });
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('meta-llama/llama-3.3-70b-instruct');
    });

    it('uses default model when none provided', async () => {
      mockAiOk('ok');
      await explainWithAi(validInput);
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('google/gemma-4-31b-it:free');
    });

    it('uses OPENROUTER_MODEL env var when set and no model provided', async () => {
      process.env.OPENROUTER_MODEL = 'deepseek/deepseek-chat-v3-0324';
      mockAiOk('ok');
      await explainWithAi(validInput);
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('deepseek/deepseek-chat-v3-0324');
    });

    it('rejects non-whitelisted model with 400', async () => {
      await expect(explainWithAi({ ...validInput, model: 'gpt-4o' }))
        .rejects.toMatchObject({ statusCode: 400 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws 503 when OPENROUTER_API_KEY is missing', async () => {
      delete process.env.OPENROUTER_API_KEY;
      await expect(explainWithAi(validInput))
        .rejects.toMatchObject({ statusCode: 503 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws 502 when OpenRouter returns an error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      });
      await expect(explainWithAi(validInput))
        .rejects.toMatchObject({ statusCode: 502 });
    });

    it('throws 504 when fetch aborts (timeout)', async () => {
      var abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockRejectedValueOnce(abortError);
      await expect(explainWithAi(validInput))
        .rejects.toMatchObject({ statusCode: 504 });
    });

    it('throws 504 on network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('socket hang up'));
      await expect(explainWithAi(validInput))
        .rejects.toMatchObject({ statusCode: 504 });
    });
  });

  describe('getAiStatus', () => {
    it('reports configured when key present', () => {
      expect(getAiStatus()).toEqual({ configured: true, defaultModel: 'google/gemma-4-31b-it:free' });
    });

    it('reports not configured when key missing', () => {
      delete process.env.OPENROUTER_API_KEY;
      expect(getAiStatus().configured).toBe(false);
    });
  });
});
