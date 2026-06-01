import type { TransportWsSocket } from "../../types";

const FETCH_TIMEOUT_MS = 30000;

interface PendingEntry {
  resolve: (msg: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface DomReadyEntry {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TransportWsSession {
  browser: TransportWsSocket | null = null;
  private seqid = 0;
  private pending = new Map<number, PendingEntry>();
  private domReady = new Map<number, DomReadyEntry>();

  connected(): boolean {
    return this.browser !== null;
  }

  setBrowser(ws: TransportWsSocket | null): void {
    this.browser = ws;
  }

  dispatch(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error("[4play] failed to parse message:", raw);
      return;
    }

    if (typeof msg.seqid === "number") {
      const entry = this.pending.get(msg.seqid);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(msg.seqid);
      entry.resolve(msg);
      return;
    }

    if (msg.action === "dom_ready") {
      const data = msg.data as { id?: number } | undefined;
      const tabId = data?.id;
      if (typeof tabId !== "number") return;
      const entry = this.domReady.get(tabId);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.domReady.delete(tabId);
      entry.resolve(msg.data);
      return;
    }

    if (msg.action === "dom_load_fail") {
      const data = msg.data as { id?: number } | undefined;
      const tabId = data?.id;
      if (typeof tabId !== "number") return;
      const entry = this.domReady.get(tabId);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.domReady.delete(tabId);
      entry.reject(new Error("4play: page load failed"));
    }
  }

  cmd(
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs = FETCH_TIMEOUT_MS,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.browser) {
        reject(new Error("4play: no browser extension connected"));
        return;
      }
      const id = ++this.seqid;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`4play: "${action}" timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.browser.send(JSON.stringify({ action, seqid: id, ...params }));
    });
  }

  awaitDom(tabid: number, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.domReady.delete(tabid);
        reject(new Error("4play: dom_ready timed out"));
      }, timeoutMs);
      this.domReady.set(tabid, { resolve, reject, timer });
    });
  }
}

const _sessions = new Map<string, TransportWsSession>();

export const getTransportWsSession = (name: string): TransportWsSession => {
  let session = _sessions.get(name);
  if (!session) {
    session = new TransportWsSession();
    _sessions.set(name, session);
  }
  return session;
};
