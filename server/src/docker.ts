import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  FILE_BYTES,
  FILE_REQUIREMENTS,
  FILE_TOOLS,
  runFileTool,
} from './docker-files.js';

const runFile = promisify(execFile);
const ID = /^[a-f0-9]{64}$/u;

export interface DockerStatus {
  name: string;
  available: boolean;
  error: string | null;
  filesError: string | null;
}

export interface DockerLimits {
  timeoutMs: number;
  maxOutputChars: number;
}

/** Configured containers attached to once, and the subset this process started. */
export class DockerResources {
  readonly statuses: readonly DockerStatus[];
  readonly #executable: string;
  readonly #targets: ReadonlyMap<string, string>;
  readonly #started: Set<string>;
  #closed = false;

  constructor(
    executable: string,
    targets: ReadonlyMap<string, string>,
    started: ReadonlySet<string>,
    statuses: readonly DockerStatus[],
  ) {
    this.#executable = executable;
    this.#targets = targets;
    this.#started = new Set(started);
    this.statuses = statuses;
  }

  fileTools() {
    return this.statuses.flatMap((status) =>
      FILE_TOOLS.map((tool) => ({
        ...tool,
        operation: tool.name,
        dependency: status.name,
        name: `docker__${status.name}__${tool.name}`,
        available: status.available && status.filesError === null,
        description: status.filesError
          ? `${tool.description} Unavailable: ${status.filesError}`
          : tool.description,
      })),
    );
  }

  async callFile(
    name: string,
    args: Record<string, unknown>,
    limits: DockerLimits,
    signal: AbortSignal,
  ): Promise<string> {
    const tool = this.fileTools().find(
      (tool) => tool.name === name && tool.available,
    );
    const id =
      tool === undefined ? undefined : this.#targets.get(tool.dependency);
    if (tool === undefined || id === undefined || this.#closed)
      throw new Error('Filesystem tool unavailable');
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(limits.timeoutMs),
    ]);
    const result = await runFileTool(tool.operation, args, (script, input) =>
      fileExec(this.#executable, id, script, limits.timeoutMs, combined, input),
    );
    const notice = '[Truncated; request a smaller range or narrower search.]\n';
    return result.length <= limits.maxOutputChars
      ? result
      : (
          notice +
          result.slice(0, Math.max(0, limits.maxOutputChars - notice.length))
        ).slice(0, limits.maxOutputChars);
  }

  async run(
    name: string,
    command: string,
    limits: DockerLimits,
    signal: AbortSignal,
  ): Promise<string> {
    const containerId = this.#targets.get(name);
    if (containerId === undefined || this.#closed)
      throw new Error(`Unavailable Docker target: ${name}`);
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(limits.timeoutMs),
    ]);
    let result: Awaited<ReturnType<typeof runFile>>;
    try {
      result = await runFile(
        this.#executable,
        ['container', 'exec', containerId, 'sh', '-lc', command],
        {
          signal: combined,
          timeout: limits.timeoutMs,
          maxBuffer: limits.maxOutputChars * 4,
        },
      );
    } catch (error) {
      // A non-zero exit is an ordinary result and keeps its output. Other
      // failures propagate to the attempt's tool trace.
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'number'
      )
        return clip(
          `${output(error)}\n[exited with status ${String(error.code)}]`,
          limits,
        );
      throw error;
    }
    return clip(
      `${result.stdout.toString()}${result.stderr.toString()}`,
      limits,
    );
  }

  /** Keep ownership when a reload resolves the same configured container. */
  transferOwnershipTo(next: DockerResources): void {
    const retained = new Set(next.#targets.values());
    for (const containerId of this.#started) {
      if (!retained.has(containerId)) continue;
      this.#started.delete(containerId);
      next.#started.add(containerId);
    }
  }

  /**
   * Stops only what this process started. A container the operator was already
   * running is one we attached to, and exiting must not take it down with us.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all(
      [...this.#started].map(async (containerId) => {
        await runFile(
          this.#executable,
          ['container', 'stop', '--time', '10', containerId],
          { timeout: 12_000, maxBuffer: 64 * 1024 },
        ).catch(() => undefined);
      }),
    );
  }
}

export async function activateDocker(
  definitions: Readonly<Record<string, string>>,
  executable = 'docker',
): Promise<DockerResources> {
  const targets = new Map<string, string>();
  const started = new Set<string>();
  const statuses = await Promise.all(
    Object.entries(definitions).map(async ([name, reference]) => {
      const activated = await startContainer(executable, reference);
      if (activated.containerId !== null) {
        targets.set(name, activated.containerId);
        if (activated.started) started.add(activated.containerId);
      }
      return {
        name,
        available: activated.containerId !== null,
        error: activated.error,
        filesError:
          activated.containerId === null
            ? 'Container unavailable'
            : await checkFileTools(executable, activated.containerId),
      };
    }),
  );
  return new DockerResources(executable, targets, started, statuses);
}

async function checkFileTools(
  executable: string,
  id: string,
): Promise<string | null> {
  try {
    const result = await fileExec(
      executable,
      id,
      FILE_REQUIREMENTS,
      10_000,
      AbortSignal.timeout(10_000),
    );
    return result.code === 0
      ? null
      : `Requires GNU coreutils and ripgrep. ${result.stdout.toString().slice(0, 200)}`;
  } catch {
    return 'Filesystem prerequisite check failed; requires GNU coreutils and ripgrep.';
  }
}

/** Keep file payloads off argv and raw process errors out of tool evidence. */
function fileExec(
  executable: string,
  id: string,
  script: string,
  timeout: number,
  signal: AbortSignal,
  input?: string,
): Promise<{ stdout: Buffer; stderr: Buffer; code: number }> {
  return new Promise((resolve, reject) => {
    let inputError = false;
    const child = execFile(
      executable,
      ['container', 'exec', '-i', id, 'sh', '-c', script],
      { encoding: 'buffer', timeout, signal, maxBuffer: FILE_BYTES + 4096 },
      (error, stdout, stderr) => {
        if (inputError)
          return reject(new Error('File input could not be delivered.'));
        if (error !== null && typeof error.code !== 'number')
          return reject(
            new Error(
              signal.aborted
                ? 'File operation cancelled or timed out; a write may already have completed.'
                : 'File operation failed or exceeded its output limit; narrow the request.',
            ),
          );
        resolve({
          stdout,
          stderr,
          code: error === null ? 0 : Number(error.code),
        });
      },
    );
    child.stdin?.on('error', () => {
      inputError = true;
    });
    child.stdin?.end(input);
  });
}

async function startContainer(
  executable: string,
  reference: string,
): Promise<{
  containerId: string | null;
  started: boolean;
  error: string | null;
}> {
  if (reference.startsWith('-') || reference.includes('\0')) {
    return { containerId: null, started: false, error: 'Invalid reference' };
  }
  let stage = 'inspection';
  try {
    const { stdout } = await runFile(
      executable,
      [
        'container',
        'inspect',
        '--format',
        '{{.Id}}\t{{.State.Status}}',
        reference,
      ],
      { timeout: 10_000, maxBuffer: 64 * 1024 },
    );
    const [containerId, state] = stdout.trim().split('\t');
    if (containerId === undefined || !ID.test(containerId)) {
      return {
        containerId: null,
        started: false,
        error: 'Docker returned an invalid container ID',
      };
    }
    if (state === 'running')
      return { containerId, started: false, error: null };
    stage = 'startup';
    await runFile(executable, ['container', 'start', containerId], {
      timeout: 12_000,
      maxBuffer: 64 * 1024,
    });
    return { containerId, started: true, error: null };
  } catch (error) {
    const detail =
      error instanceof Error ? output(error).trim().slice(0, 1000) : '';
    return {
      containerId: null,
      started: false,
      error:
        error instanceof Error && 'code' in error && error.code === 'ENOENT'
          ? 'Docker executable not found'
          : `Docker ${stage} failed${detail ? `: ${detail}` : ''}`,
    };
  }
}

/** What the command printed: stdout, then stderr. Not interleaved. */
function output(error: Error): string {
  const streams = error as { stdout?: unknown; stderr?: unknown };
  return `${asText(streams.stdout)}${asText(streams.stderr)}`;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString() : '';
}

function clip(source: string, limits: DockerLimits): string {
  return source.slice(0, limits.maxOutputChars);
}
