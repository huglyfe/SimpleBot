import {
  secretListSchema,
  type TodoCreate,
  AUTH_REQUIRED_EVENT,
  authStatusResponseSchema,
  authExchangeResponseSchema,
  skillListSchema,
  attemptEventSchema,
  attachmentSchema,
  botDocumentSchema,
  settingsDocumentSchema,
  dependencyDocumentSchema,
  presetDocumentSchema,
  bootstrapSchema,
  capabilityCatalogResponseSchema,
  botImportResponseSchema,
  botArtworkResponseSchema,
  createSessionResponseSchema,
  errorResponseSchema,
  presetListResponseSchema,
  providerListResponseSchema,
  providerModelsResponseSchema,
  revisionResponseSchema,
  sessionChangeSchema,
  sessionContextSchema,
  sessionProjectionSchema,
  sessionSearchResponseSchema,
  speechResponseSchema,
  transcriptPageSchema,
  type AttemptCommand,
  type AttemptEvent,
  type Bootstrap,
  type CapabilityCatalog,
  type BotImportResponse,
  type SessionContext,
  type SessionChange,
  type SessionProjection,
  type ScheduleWrite,
  type TranscriptPage,
} from '@simplebot/shared';

export const getSecrets = () => requestJson('/api/secrets', secretListSchema);
export const saveSecret = (
  name: string,
  value: string,
  expectedRevision: string,
) =>
  requestJson(`/api/secrets/${encodeURIComponent(name)}`, secretListSchema, {
    method: 'PUT',
    body: JSON.stringify({ value, expectedRevision }),
  });
export const removeSecret = (name: string, expectedRevision: string) =>
  requestJson(`/api/secrets/${encodeURIComponent(name)}`, secretListSchema, {
    method: 'DELETE',
    body: JSON.stringify({ expectedRevision }),
  });

/**
 * A refused request, carrying the status alongside the server's message.
 *
 * The engine owns what happened; a caller that can say it better in its own
 * surface needs to know which refusal it was without matching on prose. The
 * message stays the fallback, so anything that does not care keeps working.
 */
export class RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

export function isAuthoredConflict(error: unknown): error is RequestError {
  return error instanceof RequestError && error.status === 409;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  // `Headers` rather than an object spread: `HeadersInit` is also allowed to
  // be entry pairs, which spread into array indices instead of header names.
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  if (!response.ok) {
    const body = errorResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new RequestError(
      body.success
        ? body.data.error
        : `Request failed (${String(response.status)})`,
      response.status,
    );
  }
  return response;
}

async function requestJson<T>(
  path: string,
  schema: { parse(value: unknown): T },
  init?: RequestInit,
): Promise<T> {
  return schema.parse(await (await request(path, init)).json());
}

export function getAuthStatus(signal: AbortSignal) {
  return requestJson('/api/auth/status', authStatusResponseSchema, {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
}

export function pairBrowser(credential: string) {
  return requestJson('/api/auth/exchange', authExchangeResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });
}

export async function logoutBrowser(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
}

export async function setSessionPreset(
  id: string,
  presetSlug: string,
): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(id)}/preset`, {
    method: 'PATCH',
    body: JSON.stringify({ presetSlug }),
  });
}

export async function getBootstrap(): Promise<Bootstrap> {
  return requestJson('/api/bootstrap', bootstrapSchema);
}

export async function createBot(name: string): Promise<BotImportResponse> {
  return requestJson('/api/bots', botImportResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function importBot(
  file: File,
  name?: string,
): Promise<BotImportResponse> {
  const data = await fileToBase64(file);
  return requestJson('/api/bots/import', botImportResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, data, name }),
  });
}

export async function replaceBotArtwork(
  slug: string,
  file: File,
): Promise<string> {
  const data = await fileToBase64(file);
  const result = await requestJson(
    `/api/bots/${encodeURIComponent(slug)}/avatar`,
    botArtworkResponseSchema,
    { method: 'PUT', body: JSON.stringify({ data }) },
  );
  return result.avatarUrl;
}

export async function createSession(botSlug: string): Promise<string> {
  return (
    await requestJson('/api/sessions', createSessionResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ botSlug }),
    })
  ).id;
}

export async function getSession(id: string): Promise<SessionProjection> {
  return requestJson(
    `/api/sessions/${encodeURIComponent(id)}`,
    sessionProjectionSchema,
  );
}

export async function setTitle(id: string, title: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(id)}/title`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Older transcript, ending just before `before`. */
export async function getPositions(
  id: string,
  before: number,
): Promise<TranscriptPage> {
  return requestJson(
    `/api/sessions/${encodeURIComponent(id)}/positions?before=${String(before)}`,
    transcriptPageSchema,
  );
}

export async function mutateSession(
  id: string,
  suffix: string,
  method: 'DELETE' | 'PATCH' | 'POST',
  body?: unknown,
): Promise<SessionChange> {
  return requestJson(
    `/api/sessions/${encodeURIComponent(id)}${suffix}`,
    sessionChangeSchema,
    {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

/** Every conversation whose canonical text matches, one snippet each. */
export async function searchSessions(query: string, signal?: AbortSignal) {
  return (
    await requestJson(
      `/api/search?q=${encodeURIComponent(query)}`,
      sessionSearchResponseSchema,
      signal === undefined ? undefined : { signal },
    )
  ).results;
}

/**
 * `signal` is the send operation's own, so stopping closes the uploads as
 * well as the attempt; the caller releases whatever already landed.
 */
export async function uploadAttachment(
  id: string,
  file: File,
  signal: AbortSignal,
): Promise<string> {
  const data = await fileToBase64(file);
  return (
    await requestJson(
      `/api/sessions/${encodeURIComponent(id)}/attachments`,
      attachmentSchema,
      {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, data }),
        signal,
      },
    )
  ).id;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const encoded = typeof reader.result === 'string' ? reader.result : '';
      resolve(encoded.split(',', 2)[1] ?? '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Releases one uploaded attachment that no turn will claim. Only ever called
 * with an ID this client just created, and the server refuses to touch an
 * attachment a position owns.
 */
export async function discardAttachment(
  sessionId: string,
  attachmentId: string,
): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: 'DELETE' },
  );
}

export async function requestSpeech(sessionId: string, variantId: string) {
  return (
    await requestJson(
      `/api/sessions/${encodeURIComponent(sessionId)}/variants/${encodeURIComponent(variantId)}/speech`,
      speechResponseSchema,
      { method: 'POST' },
    )
  ).url;
}

export async function getCapabilities(): Promise<CapabilityCatalog> {
  return requestJson('/api/capabilities', capabilityCatalogResponseSchema);
}

export async function getPresetList() {
  return (await requestJson('/api/presets', presetListResponseSchema)).presets;
}

export async function getProviderList() {
  return (await requestJson('/api/providers', providerListResponseSchema))
    .providers;
}

export async function getProviderModels(providerId: string) {
  return requestJson(
    `/api/providers/${encodeURIComponent(providerId)}/models`,
    providerModelsResponseSchema,
  );
}

export async function getContext(sessionId: string): Promise<SessionContext> {
  return requestJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/context`,
    sessionContextSchema,
  );
}

export async function compactSession(sessionId: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
    method: 'POST',
  });
}

export async function regenerateLeaf(
  sessionId: string,
  leafId: string,
): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/leaves/${encodeURIComponent(leafId)}/regenerate`,
    { method: 'POST' },
  );
}

export async function editLeafSource(
  sessionId: string,
  leafId: string,
  source: string,
): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/leaves/${encodeURIComponent(leafId)}/source`,
    { method: 'PATCH', body: JSON.stringify({ source }) },
  );
}

export const getBotDocument = (slug: string) =>
  requestJson(`/api/bots/${encodeURIComponent(slug)}`, botDocumentSchema);

export async function saveAuthoredDocument(
  path: string,
  value: Record<string, unknown>,
  revision: string,
) {
  return (
    await requestJson(`/api/${path}`, revisionResponseSchema, {
      method: 'PUT',
      body: JSON.stringify({ value, expectedRevision: revision }),
    })
  ).revision;
}

export const getSettings = () =>
  requestJson('/api/settings', settingsDocumentSchema);
export const getDependencies = () =>
  requestJson('/api/dependencies', dependencyDocumentSchema);
export const getPresetDocument = (slug: string) =>
  requestJson(`/api/presets/${encodeURIComponent(slug)}`, presetDocumentSchema);
export const saveSettings = (
  value: Record<string, unknown>,
  revision: string,
) => saveAuthoredDocument('settings', value, revision);
export const saveDependencies = (
  value: Record<string, unknown>,
  revision: string,
) => saveAuthoredDocument('dependencies', value, revision);

export async function saveTodo(
  sessionId: string,
  todo: TodoCreate & { id?: string },
): Promise<void> {
  const { id, ...fields } = todo;
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/todos${id === undefined ? '' : `/${encodeURIComponent(id)}`}`,
    {
      method: id === undefined ? 'POST' : 'PATCH',
      body: JSON.stringify(fields),
    },
  );
}

export async function deleteTodo(sessionId: string, id: string): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/todos/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dropped' }),
    },
  );
}

export async function putSchedule(
  sessionId: string,
  schedule: ScheduleWrite,
): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/schedules`, {
    method: 'PUT',
    body: JSON.stringify(schedule),
  });
}

export async function deleteSchedule(
  sessionId: string,
  scheduleId: string,
): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/schedules/${encodeURIComponent(scheduleId)}`,
    { method: 'DELETE' },
  );
}

export async function setVariable(
  sessionId: string,
  name: string,
  value: string,
  previousName?: string,
): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/variables`, {
    method: 'PUT',
    body: JSON.stringify({ name, value, previousName }),
  });
}

export async function deleteVariable(
  sessionId: string,
  name: string,
): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/variables/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
}

export async function streamAttempt(
  sessionId: string,
  command: AttemptCommand,
  signal: AbortSignal,
  onEvent: (event: AttemptEvent) => void,
  onOpen?: (attemptId: string) => void,
): Promise<void> {
  const response = await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/attempts`,
    {
      method: 'POST',
      body: JSON.stringify(command),
      signal,
    },
  );
  const attemptId = response.headers.get('x-attempt-id') ?? '';
  onOpen?.(attemptId);
  if (response.body === null) throw new Error('Attempt stream is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const event = attemptEventSchema.parse(JSON.parse(line.slice(6)));
        onEvent(event);
      }
    }
    if (done) break;
  }
}

export async function cancelAttempt(sessionId: string, attemptId: string) {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}`,
    { method: 'DELETE' },
  );
}

export async function purgeOtherLogins(): Promise<void> {
  await request('/api/auth/purge-others', { method: 'POST' });
}

export const refreshCapabilities = () =>
  requestJson('/api/capabilities/refresh', capabilityCatalogResponseSchema, {
    method: 'POST',
  });
export const getSkills = () => requestJson('/api/skills', skillListSchema);
export const deleteSkill = (name: string, revision: string) =>
  requestJson(`/api/skills/${encodeURIComponent(name)}`, skillListSchema, {
    method: 'DELETE',
    body: JSON.stringify({ expectedRevision: revision }),
  });
export const deletePreset = (slug: string, revision: string) =>
  requestJson(
    `/api/presets/${encodeURIComponent(slug)}`,
    presetListResponseSchema,
    { method: 'DELETE', body: JSON.stringify({ expectedRevision: revision }) },
  );
