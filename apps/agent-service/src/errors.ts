/** 409: the target changed or is busy; refresh and retry with current state. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** 503: the service drains and accepts no new runs. */
export class DrainingError extends Error {
  constructor() {
    super('The service is draining and accepts no new runs.');
    this.name = 'DrainingError';
  }
}

/** 502: a model provider failed; the message is safe to show and names the next step. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}
