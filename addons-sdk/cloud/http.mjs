export const upstreamError = () => new Error('Upstream request failed');
export const invalid = () => Object.assign(new Error('Invalid request'), { status: 400 });

export function validateCatalog(query, offset, limit) {
  if (typeof query !== 'string' || query.length > 512 || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid();
}

export async function readJson(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw upstreamError();
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw upstreamError();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw upstreamError(); }
}
