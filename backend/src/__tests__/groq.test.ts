import { explainWithGroq, getAiStatus } from '../services/GroqService';

var validInput = {
  type: 'BROKEN_RESOURCE',
  severity: 'HIGH',
  description: 'Imagen rota',
  url: 'https://example.com/img.png',
};

function mockGroqOk(content: string) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: content } }] }),
  });
}

describe('GroqService', () => {
  var originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
    process.env.GROQ_API_KEY = 'test-key';
    delete process.env.GROQ_MODEL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
  });

  describe('explainWithGroq', () => {
    it('returns explanation on success', async () => {
      mockGroqOk('Explicacion de prueba');
      var result = await explainWithGroq(validInput);
      expect(result).toBe('Explicacion de prueba');
    });

    it('sends the requested whitelisted model', async () => {
      mockGroqOk('ok');
      await explainWithGroq({ ...validInput, model: 'llama-3.3-70b-versatile' });
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('llama-3.3-70b-versatile');
    });

    it('uses default model when none provided', async () => {
      mockGroqOk('ok');
      await explainWithGroq(validInput);
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('llama-3.1-8b-instant');
    });

    it('uses GROQ_MODEL env var when set and no model provided', async () => {
      process.env.GROQ_MODEL = 'qwen/qwen3.6-27b';
      mockGroqOk('ok');
      await explainWithGroq(validInput);
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('qwen/qwen3.6-27b');
    });

    it('rejects non-whitelisted model with 400', async () => {
      await expect(explainWithGroq({ ...validInput, model: 'gpt-4o' }))
        .rejects.toMatchObject({ statusCode: 400 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws 503 when GROQ_API_KEY is missing', async () => {
      delete process.env.GROQ_API_KEY;
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 503 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws 502 when Groq returns an error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      });
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 502 });
    });

    it('throws 504 when fetch aborts (timeout)', async () => {
      var abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockRejectedValueOnce(abortError);
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 504 });
    });

    it('throws 504 on network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('socket hang up'));
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 504 });
    });
  });

  describe('getAiStatus', () => {
    it('reports configured when key present', () => {
      expect(getAiStatus()).toEqual({ configured: true, defaultModel: 'llama-3.1-8b-instant' });
    });

    it('reports not configured when key missing', () => {
      delete process.env.GROQ_API_KEY;
      expect(getAiStatus().configured).toBe(false);
    });
  });
});
