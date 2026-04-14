/**
 * yuan-relay — WebSocket client that connects browser to server's /yuan-relay.
 *
 * When the CLI tools POST to /api/yuan/send, the server forwards the request
 * to this WebSocket client, which calls yuanAgent.init()/send()/status()
 * and sends the result back.
 *
 * This bridges: CLI -> HTTP -> server -> WebSocket -> browser yuanAgent
 */

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

type YuanHandlers = {
  init: () => Promise<void>;
  send: (msg: string) => Promise<string>;
  status: () => string;
};

let handlers: YuanHandlers | null = null;

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/yuan-relay`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[yuan-relay] connected to server');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('[yuan-relay] received:', msg.type, msg.id);

      if (!handlers) {
        ws?.send(JSON.stringify({ id: msg.id, error: 'yuanAgent handlers not registered yet' }));
        return;
      }

      switch (msg.type) {
        case 'yuan:init': {
          try {
            await handlers.init();
            ws?.send(JSON.stringify({ id: msg.id, response: 'initialized' }));
          } catch (err: any) {
            ws?.send(JSON.stringify({ id: msg.id, error: err.message }));
          }
          break;
        }
        case 'yuan:send': {
          try {
            const response = await handlers.send(msg.message);
            ws?.send(JSON.stringify({ id: msg.id, response }));
          } catch (err: any) {
            ws?.send(JSON.stringify({ id: msg.id, error: err.message }));
          }
          break;
        }
        case 'yuan:status': {
          const status = handlers.status();
          ws?.send(JSON.stringify({ id: msg.id, status }));
          break;
        }
        default:
          console.warn('[yuan-relay] unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('[yuan-relay] error handling message:', err);
    }
  };

  ws.onclose = () => {
    console.log('[yuan-relay] disconnected, will reconnect in 3s');
    ws = null;
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = (err) => {
    console.error('[yuan-relay] error:', err);
  };
}

/**
 * Start the yuan relay WebSocket client.
 * Call this after registering yuan handlers.
 */
export function startYuanRelay(h: YuanHandlers) {
  handlers = h;
  connect();
  console.log('[yuan-relay] started');
}
