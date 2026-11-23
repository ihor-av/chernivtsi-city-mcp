const url = "http://localhost:3000/rpc";
let nextId = 1;

async function call(method, params) {
  const request = {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  const payload = await response.json();

  console.log("→", JSON.stringify(request));
  console.log("←", JSON.stringify(payload));
  console.log();

  return payload;
}

await call("add", { a: 2, b: 3 });
await call("divide", { a: 10, b: 4 });
await call("divide", { a: 10, b: 0 });
await call("multiply", { a: 2, b: 3 });
