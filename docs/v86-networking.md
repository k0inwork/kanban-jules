# v86 Networking in Board VM

## Overview

The board VM runs Linux inside a v86 x86 emulator (in-browser, WASM). Networking uses the **WISP protocol** over WebSocket to tunnel arbitrary TCP connections from the VM through the browser to a Node.js relay server.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser                                         │
│                                                  │
│  ┌──────────────┐     ┌───────────────────────┐  │
│  │  main.go     │     │  v86.worker.min.js    │  │
│  │  (WASM)      │────▶│  V86 + WISP adapter   │  │
│  │              │     │  (oe class)            │  │
│  │  writes ctl  │     │                       │  │
│  │  relay_url   │     │  TCP/IP stack in JS   │  │
│  └──────────────┘     └───────┬───────────────┘  │
│                               │                  │
│                     WebSocket (binary)            │
│                     ws://host/wisp                │
│                               │                  │
└───────────────────────────────┼──────────────────┘
                                │
                        ┌───────▼───────────────┐
                        │  Node.js server.ts    │
                        │  WISP relay on /wisp  │
                        │                       │
                        │  CONNECT → TCP socket │
                        │  DATA ↔ TCP data      │
                        │  CLOSE → destroy      │
                        └───────────────────────┘
```

## Config Flow (main.go → V86)

1. **main.go** constructs the network config:
   ```go
   wispURL := "wisp://" + js.Global().Get("location").Get("host").String() + "/wisp"
   netdevOpts := "user,type=virtio,relay_url=" + wispURL
   ctlcmd = append(ctlcmd, "-netdev", netdevOpts)
   ```

2. **v86.go `parseFlags`** parses the ctl file and calls `parseNetdev`.

3. **v86.go `parseNetdev`** parses `user,type=virtio,relay_url=wisp://...` into:
   ```go
   map[string]any{"type": "virtio", "relay_url": "wisp://localhost:3000/wisp"}
   ```
   This is placed under the `net_device` key in the V86 options map.

4. **V86 constructor** (in v86.worker.min.js) selects the adapter:
   ```js
   n = e.network_relay_url || e.net_device && e.net_device.relay_url
   if (n === "fetch") → fetch adapter (Vt class)
   else if (n === "inbrowser") → broadcast adapter
   else if (n.startsWith("wisp://") || n.startsWith("wisps://")) → WISP adapter (oe class)
   else → raw relay adapter (ne class)
   ```

## V86 Network Adapters

### 1. Fetch Adapter (`Vt` class)
- **Trigger**: `relay_url === "fetch"`
- **How it works**: Uses browser `fetch()` API with a built-in TCP/IP stack
- **Limitations**: Only supports port 80 (HTTP). No HTTPS, no arbitrary TCP.
- **DNS**: Uses `"static"` DNS method by default

### 2. WISP Adapter (`oe` class) — **USED HERE**
- **Trigger**: `relay_url` starts with `wisp://` or `wisps://`
- **How it works**:
  1. Opens a WebSocket (converts `wisp://host/path` → `ws://host/path`)
  2. Maintains a full TCP/IP stack in JavaScript
  3. Sends WISP binary protocol frames:
     - Type 1 (CONNECT): Opens a TCP stream to `hostname:port`
     - Type 2 (DATA): Sends/receives data on a stream
     - Type 3 (CONTINUE): Flow control — tells client how much it can send
     - Type 4 (CLOSE): Closes a stream
  4. Frame format: `[type:1byte][streamId:4bytesLE][payload...]`
- **DNS**: Uses `"doh"` (DNS over HTTPS) by default — resolves via `cloudflare-dns.com/dns-query` using browser fetch()
- **Congestion control**: Streams start with `congestion=0`. Client buffers all frames until server sends a CONTINUE frame. **Server MUST send initial CONTINUE to stream 0 on connect.**

### 3. Raw Relay Adapter (`ne` class)
- **Trigger**: Any `relay_url` that isn't "fetch", "inbrowser", or wisp://
- **How it works**: Sends raw Ethernet frames over WebSocket
- **Not used**: Would require full layer-2 bridge/NAT on the server

## WISP Protocol Reference

Frame format:
```
[type: 1 byte][stream_id: 4 bytes LE][payload: variable]

Types:
  1 = CONNECT    payload: [stream_type:1byte][port:2bytesLE][hostname:string]
  2 = DATA       payload: raw TCP data
  3 = CONTINUE   payload: [buffer_size:4bytesLE] (flow control)
  4 = CLOSE      payload: [reason:1byte]
```

Server implementation (in server.ts):
1. Accept WebSocket on `/wisp`
2. **Immediately send CONTINUE to stream 0** — unblocks client congestion control
3. On CONNECT: open real TCP connection to `hostname:port`, send CONTINUE to that stream
4. On DATA: forward payload to the TCP socket
5. On TCP data from remote: send DATA frame back to client
6. On TCP close/error: send CLOSE frame to client
7. On CLOSE from client: destroy the TCP socket
8. On WS close: destroy all active TCP connections

## Critical Finding: Initial CONTINUE Frame

The WISP adapter has congestion control where `send_packet` checks:
```js
0 < this.connections[i].congestion
  ? this.wispws.send(data)           // congestion > 0: send immediately
  : this.congested_buffer.push(data)  // congestion == 0: buffer it
```

New streams inherit `congestion` from stream 0, which starts at `0`. Without a server-sent CONTINUE frame, **all data is buffered forever** — a deadlock. The server must send an initial CONTINUE (type 3) to stream 0 right after WebSocket connect, with a buffer size that sets the congestion window.

## Wanix v86 Loading Details

Wanix runs v86 **in-process** (not in a Web Worker):

```
v86.go:makeVM() →
  1. Reads embedded v86.worker.min.js
  2. Creates Blob URL from script content
  3. Loads as <script> tag into the page
  4. Sends options via MessageChannel port (postMessage)
  5. V86 constructor receives options and creates the emulator
```

## Key Files

| File | Purpose |
|------|---------|
| `wasm/boot/main.go` | VM boot config, sets `relay_url=wisp://...` |
| `server.ts` | Node.js server with WISP relay on `/wisp` |
| `wanix/vm/v86/v86.go` | V86 instance creation, option passing |
| `wanix/vm/v86/config.go` | Parses ctl flags into V86 options |
| `wanix/vm/v86/v86.worker.min.js` | Actual V86 runtime (minified, embedded) |

## Lessons Learned

1. **Wanix does NOT monkey-patch WebSocket** — it has opt-in WebSocket wrapping via the `ws` capability, but does not modify the global `WebSocket` constructor
2. **wisp:// vs ws:// matters** — v86 only selects the WISP adapter for `wisp://` or `wisps://` URLs. Using `ws://` falls through to the raw relay adapter.
3. **In-process mode** — v86 runs in the main thread (not Worker), loaded as a script tag. The `v86.worker.js` wrapper is unused.
4. **Initial CONTINUE is mandatory** — the WISP adapter will buffer all frames (including CONNECT) until the server sends a CONTINUE frame. This is not documented anywhere obvious in v86.
5. **DNS over HTTPS** — the WISP adapter resolves DNS via DoH (cloudflare) using browser fetch(), independent of the WISP relay. TCP connections use the resolved IP address.
6. **wanix.min.js must exist** — a missing `public/assets/wasm/wanix.min.js` causes a 404 that breaks the entire VM boot.
