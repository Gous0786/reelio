export const config = { runtime: 'edge' };

// Forwards a chat completion to OpenRouter with the server-side key. Free models only.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.model !== 'string' || !body.model.endsWith(':free')) {
    return new Response('Only ":free" models are allowed', { status: 400 });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return new Response('Server is missing OPENROUTER_API_KEY', { status: 500 });
  }
  body.max_tokens = Math.min(Number(body.max_tokens) || 4000, 16000);

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
