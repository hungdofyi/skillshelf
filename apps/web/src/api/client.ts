/** Typed fetch helpers for the skillshelf HTTP API (contract: @b2s/shared api-types). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readError(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) message = body.error;
  } catch {
    /* non-JSON error body: keep the status line */
  }
  return new ApiError(res.status, message);
}

export async function api<T>(path: string, init?: Omit<RequestInit, 'body'> & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: json !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running on port 4317?');
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export const qs = (params: Record<string, string | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, v);
  return sp.toString();
};

export const rawUrl = (path: string): string => `/api/raw?${qs({ path })}`;

/** Multipart upload with progress (fetch has no upload progress events). */
export function uploadFile<T>(url: string, file: File, onProgress: (fraction: number) => void, fields?: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: cannot reach the server.'));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const msg = (body as { error?: string } | undefined)?.error;
        reject(new ApiError(xhr.status, msg ?? `Upload failed (${xhr.status})`));
      }
    };
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);
    xhr.send(form);
  });
}
