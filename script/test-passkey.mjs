import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 在内存中转译，测试不写产物，也不执行安装命令或实际浏览器认证。
const source = await readFile(new URL("../src/lib/passkey.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const passkey = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);
const bytes = (...values) => Uint8Array.from(values).buffer;
const byteList = (buffer) => [...new Uint8Array(buffer)];
const identityTranslation = (key) => key;

function credential(registration = false) {
  return {
    id: "AQID",
    rawId: bytes(1, 2, 3),
    type: "public-key",
    authenticatorAttachment: "cross-platform",
    getClientExtensionResults: () => ({ credProps: { rk: true } }),
    response: registration ? {
      clientDataJSON: bytes(123, 125),
      attestationObject: bytes(254, 255),
      getTransports: () => ["usb", "hybrid"],
    } : {
      clientDataJSON: bytes(123, 125),
      authenticatorData: bytes(4, 5),
      signature: bytes(6, 7),
      userHandle: bytes(8, 9),
    },
  };
}

const creation = {
  challenge: "AAE",
  rp: { id: "monitor.example.com", name: "Komari" },
  user: { id: "AgM", name: "admin", displayName: "Admin" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  authenticatorSelection: { residentKey: "required", userVerification: "required" },
  excludeCredentials: [{ type: "public-key", id: "BAU", transports: ["usb"] }],
  attestation: "none",
};
const assertion = {
  challenge: "AAE",
  rpId: "monitor.example.com",
  userVerification: "required",
};
const jsonResponse = (data, status = 200) => new Response(
  JSON.stringify({ status: status < 400 ? "success" : "error", data }),
  { status, headers: { "Content-Type": "application/json" } },
);

async function withBrowser(credentials, fetcher, callback) {
  const saved = new Map(
    ["window", "navigator", "PublicKeyCredential", "fetch"].map(
      (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)],
    ),
  );
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { isSecureContext: true } },
    navigator: { configurable: true, value: { credentials } },
    PublicKeyCredential: { configurable: true, value: class {} },
    fetch: { configurable: true, value: fetcher },
  });
  try {
    await callback();
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test("Base64URL preserves every byte and rejects malformed input", () => {
  const input = Uint8Array.from({ length: 256 }, (_, value) => value).buffer;
  const encoded = passkey.encodeBase64Url(input);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(byteList(passkey.decodeBase64Url(encoded)), byteList(input));
  assert.deepEqual(byteList(passkey.decodeBase64Url("")), []);
  assert.throws(() => passkey.decodeBase64Url("@"));
});

test("creation options convert binary IDs without restricting authenticator attachment", () => {
  const options = passkey.creationOptionsFromJSON(creation);
  assert.deepEqual(byteList(options.challenge), [0, 1]);
  assert.deepEqual(byteList(options.user.id), [2, 3]);
  assert.deepEqual(byteList(options.excludeCredentials[0].id), [4, 5]);
  assert.deepEqual(options.excludeCredentials[0].transports, ["usb"]);
  assert.equal(options.authenticatorSelection.userVerification, "required");
  assert.equal(options.authenticatorSelection.residentKey, "required");
  assert.equal(options.authenticatorSelection.authenticatorAttachment, undefined);
  assert.equal(creation.challenge, "AAE");
});

test("request options support discoverable credentials and binary allow lists", () => {
  const discoverable = passkey.requestOptionsFromJSON(assertion);
  assert.deepEqual(byteList(discoverable.challenge), [0, 1]);
  assert.equal(discoverable.allowCredentials, undefined);
  assert.equal(discoverable.userVerification, "required");
  const explicit = passkey.requestOptionsFromJSON({
    ...assertion,
    allowCredentials: [{ id: "BAU", type: "public-key", transports: ["hybrid"] }],
  });
  assert.deepEqual(byteList(explicit.allowCredentials[0].id), [4, 5]);
  assert.deepEqual(explicit.allowCredentials[0].transports, ["hybrid"]);
});

test("registration serialization includes attestation, transports and extensions", () => {
  const result = passkey.credentialToJSON(credential(true));
  assert.equal(result.rawId, "AQID");
  assert.equal(result.response.attestationObject, "_v8");
  assert.equal(result.response.clientDataJSON, "e30");
  assert.deepEqual(result.response.transports, ["usb", "hybrid"]);
  assert.deepEqual(result.clientExtensionResults, { credProps: { rk: true } });
});

test("assertion serialization preserves signatures and nullable user handles", () => {
  const input = credential();
  const result = passkey.credentialToJSON(input);
  assert.equal(result.response.authenticatorData, "BAU");
  assert.equal(result.response.signature, "Bgc");
  assert.equal(result.response.userHandle, "CAk");
  input.response.userHandle = null;
  assert.equal(passkey.credentialToJSON(input).response.userHandle, null);
});

test("origin validation allows configured HTTPS domains and local development only", () => {
  for (const [input, expected] of [
    ["https://monitor.example.com", "https://monitor.example.com"],
    [" https://MONITOR.example.com:443/ ", "https://monitor.example.com"],
    ["https://monitor.example.com:8443", "https://monitor.example.com:8443"],
    ["http://localhost:5173", "http://localhost:5173"],
  ]) assert.equal(passkey.normalizePasskeyOrigin(input), expected, input);
  for (const input of [
    "http://monitor.example.com", "https://127.0.0.1", "https://[::1]",
    "https://user:password@monitor.example.com", "https://monitor.example.com/path",
    "https://monitor.example.com?x=1", "https://monitor.example.com#fragment",
    "//monitor.example.com", "", "not an origin",
  ]) assert.equal(passkey.normalizePasskeyOrigin(input), null, input);
});

test("login uses one challenge, same-origin requests and wrapped options", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  await withBrowser({
    create: async () => { throw new Error("Unexpected registration"); },
    get: async (options) => {
      calls.push("get");
      assert.equal(options.signal, signal);
      assert.equal(options.publicKey.userVerification, "required");
      return credential();
    },
  }, async (path, init) => {
    calls.push(path);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.signal, signal);
    if (path.endsWith("/begin")) {
      return jsonResponse({ options: { publicKey: assertion }, challenge_id: "login-challenge" });
    }
    assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ["challenge_id", "credential"]);
    assert.equal(JSON.parse(init.body).challenge_id, "login-challenge");
    assert.equal(JSON.parse(init.body).credential.response.signature, "Bgc");
    return jsonResponse(null);
  }, () => passkey.loginWithPasskey(signal));
  assert.deepEqual(calls, ["/api/login/passkey/begin", "get", "/api/login/passkey/finish"]);
});

test("registration sends reauthentication only to begin and accepts plain options", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  await withBrowser({
    get: async () => { throw new Error("Unexpected login"); },
    create: async (options) => {
      calls.push("create");
      assert.equal(options.signal, signal);
      assert.deepEqual(byteList(options.publicKey.user.id), [2, 3]);
      return credential(true);
    },
  }, async (path, init) => {
    calls.push(path);
    const payload = JSON.parse(init.body);
    if (path.endsWith("/begin")) {
      assert.deepEqual(payload, { name: "Work key", "2fa_code": "012345" });
      return jsonResponse({ options: creation, challenge_id: "registration-challenge" });
    }
    assert.equal(payload.challenge_id, "registration-challenge");
    assert.equal(payload.password, undefined);
    assert.equal(payload["2fa_code"], undefined);
    assert.equal(payload.credential.response.attestationObject, "_v8");
    return jsonResponse(null);
  }, () => passkey.registerPasskey("Work key", { "2fa_code": "012345" }, signal));
  assert.deepEqual(calls, [
    "/api/admin/passkey/register/begin", "create", "/api/admin/passkey/register/finish",
  ]);
});

test("cancelling the authenticator never submits a finish request", async () => {
  let requests = 0;
  await withBrowser({
    create: async () => null,
    get: async () => { throw new DOMException("Cancelled", "NotAllowedError"); },
  }, async () => {
    requests++;
    return jsonResponse({ options: assertion, challenge_id: "unused-challenge" });
  }, async () => {
    await assert.rejects(passkey.loginWithPasskey(new AbortController().signal), {
      name: "NotAllowedError",
    });
  });
  assert.equal(requests, 1);
  assert.equal(
    passkey.passkeyErrorMessage(new DOMException("Cancelled", "NotAllowedError"), identityTranslation),
    "passkey.errors.cancelled",
  );
});

test("unsupported and insecure browsers fail before any network request", async () => {
  let requests = 0;
  await withBrowser({}, async () => { requests++; }, async () => {
    assert.equal(passkey.passkeySupportError(), "passkey.errors.unsupported");
    await assert.rejects(passkey.loginWithPasskey(new AbortController().signal));
    window.isSecureContext = false;
    assert.equal(passkey.passkeySupportError(), "passkey.errors.secure_context");
  });
  assert.equal(requests, 0);
});

test("HTTP and malformed responses fail before opening an authenticator", async () => {
  let prompts = 0;
  const credentials = {
    create: async () => { prompts++; },
    get: async () => { prompts++; },
  };
  await withBrowser(credentials, async () => new Response(
    JSON.stringify({ message: "Passkeys are disabled" }), { status: 403 },
  ), async () => {
    await assert.rejects(
      passkey.loginWithPasskey(new AbortController().signal),
      /Passkeys are disabled/,
    );
  });
  await withBrowser(credentials, async () => new Response("<html>Error</html>", { status: 502 }), async () => {
    try {
      await passkey.loginWithPasskey(new AbortController().signal);
      assert.fail("Expected malformed response to fail");
    } catch (error) {
      assert.equal(passkey.passkeyErrorMessage(error, identityTranslation), "passkey.errors.request_failed");
    }
  });
  assert.equal(prompts, 0);
});