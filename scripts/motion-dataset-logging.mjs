import {createHash} from 'node:crypto';

// Persist the actual provider text/configuration without credentials or image
// payloads. This is a trace of inference input, never a scoring ground truth.
export function redactMotionProviderPayload(payload, apiKey = '') {
  const clean = value => typeof value === 'string' && apiKey ? value.split(apiKey).join('[redacted]') : value;
  const safePart = part => {
    if (part.type === 'image_url') {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(part.image_url?.url || '');
      if (!match) return {type: 'image_url', image: {omitted: true, reason: 'not-an-inline-image'}};
      const bytes = Buffer.from(match[2], 'base64');
      return {type: 'image_url', image: {mimeType: match[1], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(part.image_url.detail ? {detail: part.image_url.detail} : {})}};
    }
    return part.type === 'text' ? {type: 'text', text: clean(part.text)} : {type: clean(part.type), omitted: true};
  };
  const safe = Object.fromEntries(['model', 'thinking', 'reasoning_effort', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'stream', 'response_format'].filter(key => payload[key] !== undefined).map(key => [key, payload[key]]));
  safe.messages = (payload.messages || []).map(message => ({role: message.role, content: Array.isArray(message.content) ? message.content.map(safePart) : clean(message.content)}));
  return safe;
}
