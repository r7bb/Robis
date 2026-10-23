/**
 * Where the API and the realtime gateway live. Read by the client, and by
 * the middleware that writes the security policy allowing them.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:4001/ws';
