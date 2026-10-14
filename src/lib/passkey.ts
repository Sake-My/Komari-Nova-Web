import type { TFunction } from "i18next";

export type Passkey = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

export type PasskeyIdentity = {
  password?: string;
  "2fa_code"?: string;
};

type Ceremony<T> = {
  options: T | { publicKey: T };
  challenge_id: string;
};

class PasskeyClientError extends Error {
  readonly translationKey: string;

  constructor(translationKey: string) {
    super(translationKey);
    this.translationKey = translationKey;
  }
}

export function passkeySupportError(): string | null {
  if (!window.isSecureContext) return "passkey.errors.secure_context";
  if (
    typeof PublicKeyCredential === "undefined" ||
    !navigator.credentials?.create ||
    !navigator.credentials?.get
  ) {
    return "passkey.errors.unsupported";
  }
  return null;
}

export function passkeyErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof PasskeyClientError) return t(error.translationKey);
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "AbortError":
        return t("passkey.errors.cancelled");
      case "InvalidStateError":
        return t("passkey.errors.already_registered");
      case "SecurityError":
        return t("passkey.errors.origin");
      case "NotSupportedError":
        return t("passkey.errors.unsupported");
      default:
        return t("passkey.errors.failed");
    }
  }
  if (error instanceof TypeError) return t("passkey.errors.request_failed");
  return error instanceof Error ? error.message : t("passkey.errors.failed");
}

export async function passkeyRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let payload: { data?: T; message?: string; status?: string } | null = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new PasskeyClientError("passkey.errors.request_failed");
    }
  }
  if (!response.ok || payload?.status === "error") {
    throw new Error(
      payload?.message || `HTTP ${response.status}`,
    );
  }
  return payload?.data as T;
}

export function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

export function encodeBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 手动转换二进制字段，兼容尚未提供 WebAuthn JSON 辅助方法的浏览器。
export function creationOptionsFromJSON(
  options: PublicKeyCredentialCreationOptionsJSON,
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: decodeBase64Url(options.challenge),
    user: { ...options.user, id: decodeBase64Url(options.user.id) },
    attestation: options.attestation as AttestationConveyancePreference | undefined,
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      ...credential,
      id: decodeBase64Url(credential.id),
      type: credential.type as PublicKeyCredentialType,
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    })),
    extensions: options.extensions as AuthenticationExtensionsClientInputs | undefined,
  };
}

export function requestOptionsFromJSON(
  options: PublicKeyCredentialRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: decodeBase64Url(options.challenge),
    userVerification: options.userVerification as UserVerificationRequirement | undefined,
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: decodeBase64Url(credential.id),
      type: credential.type as PublicKeyCredentialType,
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    })),
    extensions: options.extensions as AuthenticationExtensionsClientInputs | undefined,
  };
}

export function credentialToJSON(credential: PublicKeyCredential) {
  const response = credential.response;
  const common = {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  if ("attestationObject" in response) {
    const registration = response as AuthenticatorAttestationResponse;
    return {
      ...common,
      response: {
        clientDataJSON: encodeBase64Url(response.clientDataJSON),
        attestationObject: encodeBase64Url(registration.attestationObject),
        transports: registration.getTransports?.() ?? [],
      },
    };
  }
  const assertion = response as AuthenticatorAssertionResponse;
  return {
    ...common,
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      authenticatorData: encodeBase64Url(assertion.authenticatorData),
      signature: encodeBase64Url(assertion.signature),
      userHandle: assertion.userHandle
        ? encodeBase64Url(assertion.userHandle)
        : null,
    },
  };
}

function unwrapOptions<T>(options: T | { publicKey: T }): T {
  return typeof options === "object" && options !== null && "publicKey" in options
    ? options.publicKey
    : options as T;
}

function ensureSupported() {
  const error = passkeySupportError();
  if (error) throw new PasskeyClientError(error);
}

export async function loginWithPasskey(signal: AbortSignal): Promise<void> {
  ensureSupported();
  const ceremony = await passkeyRequest<
    Ceremony<PublicKeyCredentialRequestOptionsJSON>
  >("/api/login/passkey/begin", {
    method: "POST",
    body: "{}",
    signal,
  });
  const credential = await navigator.credentials.get({
    publicKey: requestOptionsFromJSON(unwrapOptions(ceremony.options)),
    signal,
  }) as PublicKeyCredential | null;
  if (!credential) throw new PasskeyClientError("passkey.errors.cancelled");
  await passkeyRequest("/api/login/passkey/finish", {
    method: "POST",
    body: JSON.stringify({
      challenge_id: ceremony.challenge_id,
      credential: credentialToJSON(credential),
    }),
    signal,
  });
}

export async function registerPasskey(
  name: string,
  identity: PasskeyIdentity,
  signal: AbortSignal,
): Promise<void> {
  ensureSupported();
  const ceremony = await passkeyRequest<
    Ceremony<PublicKeyCredentialCreationOptionsJSON>
  >("/api/admin/passkey/register/begin", {
    method: "POST",
    body: JSON.stringify({ name, ...identity }),
    signal,
  });
  const credential = await navigator.credentials.create({
    publicKey: creationOptionsFromJSON(unwrapOptions(ceremony.options)),
    signal,
  }) as PublicKeyCredential | null;
  if (!credential) throw new PasskeyClientError("passkey.errors.cancelled");
  await passkeyRequest("/api/admin/passkey/register/finish", {
    method: "POST",
    body: JSON.stringify({
      challenge_id: ceremony.challenge_id,
      credential: credentialToJSON(credential),
    }),
    signal,
  });
}

export function normalizePasskeyOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !(url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")) ||
      !url.hostname ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
      url.hostname.includes(":") ||
      url.username ||
      url.password ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}