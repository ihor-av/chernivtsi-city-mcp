import { createServer } from "node:http";

// A JSON-RPC error carries a numeric code and a human-readable message.
class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Each method is just a function. Params arrive as one object.
const methods = {
  add({ a, b } = {}) {
    if (typeof a !== "number" || typeof b !== "number") {
      throw new RpcError(-32602, "add needs numeric 'a' and 'b'");
    }
    return a + b;
  },

  divide({ a, b } = {}) {
    if (typeof a !== "number" || typeof b !== "number") {
      throw new RpcError(-32602, "divide needs numeric 'a' and 'b'");
    }
    if (b === 0) {
      throw new RpcError(-32000, "cannot divide by zero");
    }
    return a / b;
  },
};

function send(response, payload) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/rpc") {
    response.writeHead(404).end();
    return;
  }

  let body = "";
  for await (const chunk of request) body += chunk;

  let message;
  try {
    message = JSON.parse(body);
  } catch {
    send(response, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "request body is not valid JSON" },
    });
    return;
  }

  const method = methods[message.method];
  if (!method) {
    send(response, {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32601, message: `no method named "${message.method}"` },
    });
    return;
  }

  try {
    send(response, {
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: method(message.params),
    });
  } catch (error) {
    send(response, {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: error.code ?? -32000, message: error.message },
    });
  }
});

server.listen(3000, () => {
  console.log("JSON-RPC server: http://localhost:3000/rpc");
});
