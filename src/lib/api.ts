export async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(
      `Expected JSON from ${url} (${res.status}), received ${contentType || 'unknown'}: ${text.slice(0, 120)}`
    );
  }

  const data = await res.json();
  if (!res.ok && data && typeof data === 'object' && !('success' in data)) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}
