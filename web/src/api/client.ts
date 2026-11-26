export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (!["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase())) {
    headers.set("X-PatchBoard", "1");
  }
  if (typeof options.body === "string" && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const problem =
      typeof payload.error === "object" && payload.error
        ? payload.error
        : payload;
    throw new ApiError(
      response.status,
      problem.code || "request_failed",
      problem.message ||
        (typeof payload.error === "string" && payload.error) ||
        response.statusText,
      problem.fields,
    );
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export function json<T>(
  path: string,
  method: string,
  value?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return api<T>(path, {
    method,
    signal,
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}
