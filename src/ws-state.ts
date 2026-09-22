export type ConnectionState =
  | "CONNECTING"
  | "AUTHENTICATING"
  | "AUTHENTICATED"
  | "SUBSCRIBING"
  | "SYNCING"
  | "LIVE"
  | "RECONNECTING"
  | "CLOSED";

const ALLOWED: Record<ConnectionState, ConnectionState[]> = {
  CONNECTING: ["AUTHENTICATING", "CLOSED"],
  AUTHENTICATING: ["AUTHENTICATED", "CLOSED"],
  AUTHENTICATED: ["SUBSCRIBING", "CLOSED"],
  SUBSCRIBING: ["SYNCING", "CLOSED"],
  SYNCING: ["LIVE", "RECONNECTING", "CLOSED"],
  LIVE: ["RECONNECTING", "CLOSED"],
  RECONNECTING: ["AUTHENTICATING", "CLOSED"],
  CLOSED: [],
};

export class WsSession {
  state: ConnectionState = "CONNECTING";
  revision = 0;
  private buffer: unknown[] = [];
  maxBuffer: number;
  constructor(maxBuffer: number) {
    this.maxBuffer = maxBuffer;
  }

  transition(next: ConnectionState): void {
    if (!ALLOWED[this.state].includes(next)) {
      throw Object.assign(new Error("ILLEGAL_WS_TRANSITION"), {
        code: "ILLEGAL_WS_TRANSITION",
        from: this.state,
        to: next,
      });
    }
    this.state = next;
  }

  snapshot<T>(state: T): { revision: number; state: T } {
    return { revision: this.revision, state };
  }

  apply(expected: number, event: unknown): boolean {
    if (expected !== this.revision) return false;
    if (this.buffer.length >= this.maxBuffer) {
      throw Object.assign(new Error("WS_BUFFER_EXCEEDED"), { code: "WS_BUFFER_EXCEEDED" });
    }
    this.buffer.push(event);
    this.revision += 1;
    return true;
  }

  gap(clientRevision: number): boolean {
    return clientRevision !== this.revision;
  }
}

export class RevisionedState<T> {
  private revision = 0;
  private state: T;
  constructor(state: T) {
    this.state = state;
  }
  snapshot() {
    return { revision: this.revision, state: this.state };
  }
  apply(expected: number, next: T): boolean {
    if (expected !== this.revision) return false;
    this.state = next;
    this.revision += 1;
    return true;
  }
}
