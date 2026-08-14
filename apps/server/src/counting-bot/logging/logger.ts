export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const levelPriorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown; status?: unknown };
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(withCode.code === undefined ? {} : { errorCode: withCode.code }),
      ...(withCode.status === undefined ? {} : { errorStatus: withCode.status }),
    };
  }

  return { errorName: 'UnknownError', errorMessage: String(error) };
}

export class Logger {
  public constructor(private readonly minimumLevel: LogLevel) {}

  public debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }

  public info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  public warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  public error(event: string, error: unknown, fields: LogFields = {}): void {
    this.write('error', event, { ...fields, ...errorFields(error) });
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    if (levelPriorities[level] < levelPriorities[this.minimumLevel]) {
      return;
    }

    const detail = typeof fields.errorMessage === 'string' ? `: ${fields.errorMessage}` : '';
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: `${event}${detail}`,
      event,
      ...fields,
    });

    if (level === 'error') {
      process.stderr.write(`${record}\n`);
    } else {
      process.stdout.write(`${record}\n`);
    }
  }
}
