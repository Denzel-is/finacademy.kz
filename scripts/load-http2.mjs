import { connect, constants } from "node:http2";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

// Isolated TLS connections avoid coupling a whole class to one shared socket.
// This remains one computer generating 300 sessions, not 300 separate networks.
export class Http2Transport {
  constructor(origin) {
    this.origin = origin;
    this.connections = Array.from({ length: 300 }, () => this.open());
    this.next = 0;
  }
  open() {
    const session = connect(this.origin);
    session.on("error", () => {});
    return session;
  }
  async fetch(url, options) {
    const index = this.next++ % this.connections.length;
    let connection = this.connections[index];
    if (connection.closed || connection.destroyed) connection = this.connections[index] = this.open();
    return new Promise((resolve, reject) => {
      const stream = connection.request({ ":path": new URL(url).pathname + new URL(url).search, ":method": options.method, "accept-encoding": "gzip, br, deflate", ...options.headers });
      let headers, bytes = [], settled = false;
      const stop = (error) => { if (!settled) { settled = true; stream.close(constants.NGHTTP2_CANCEL); reject(error); } };
      const abort = () => stop(options.signal.reason || new Error("Aborted"));
      options.signal.addEventListener("abort", abort, { once: true });
      stream.on("response", (value) => { headers = value; });
      stream.on("data", (chunk) => bytes.push(chunk));
      stream.on("error", stop);
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener("abort", abort);
        try {
          let data = Buffer.concat(bytes);
          const encoding = headers["content-encoding"];
          if (encoding === "br") data = brotliDecompressSync(data);
          else if (encoding === "gzip") data = gunzipSync(data);
          else if (encoding === "deflate") data = inflateSync(data);
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(headers)) if (!key.startsWith(":") && !["content-encoding", "content-length"].includes(key)) responseHeaders.set(key, Array.isArray(value) ? value[0] : value);
          resolve(new Response(data, { status: headers[":status"], headers: responseHeaders }));
        } catch (error) { reject(error); }
      });
      stream.end(options.body);
    });
  }
  async close() { for (const session of this.connections) session.close(); }
}
