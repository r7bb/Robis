import { ApiError, BASE_URL } from './api.ts';

/**
 * Send an image's bytes as they are (B2): image bodies are not JSON, so this
 * goes around `call`. A refusal carries the server's own message; a network
 * failure says to check the connection. With a key, a retry of the same
 * upload is the same upload.
 */
export async function sendImage<T>(
  method: 'POST' | 'PUT',
  path: string,
  image: Blob,
  idempotencyKey?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'content-type': image.type,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: image,
    });
  } catch {
    throw new ApiError(0, 'network', 'That did not send. Check your connection and try again.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error ?? 'upload_failed',
      payload?.message ?? 'That image could not be sent. Try again.',
    );
  }
  return payload as T;
}
