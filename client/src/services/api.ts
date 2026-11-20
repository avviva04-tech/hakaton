async function request(path: string, options: RequestInit = {}) {
  try {
    return await fetch(`/api${path}`, options);
  } catch {
    throw new Error(
      'Не вдалося з’єднатися із сервером. Перевірте підключення та повторіть спробу.',
    );
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await request(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Сервер тимчасово недоступний.' }));
    throw new Error(body.error + (body.details ? ` ${body.details.join('; ')}` : ''));
  }
  return response.json().catch(() => {
    throw new Error('Сервер повернув некоректну відповідь. Спробуйте ще раз.');
  });
}
export const post = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export async function download(path: string, filename: string) {
  const response = await request(path);
  if (!response.ok) throw new Error((await response.json()).error);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
