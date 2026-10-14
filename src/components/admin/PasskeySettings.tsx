import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import {
  passkeyErrorMessage,
  passkeyRequest,
  passkeySupportError,
  registerPasskey,
  type Passkey,
  type PasskeyIdentity,
} from "@/lib/passkey";

type PasskeyAction =
  | { kind: "register" }
  | { kind: "rename" | "delete"; passkey: Passkey };

export default function PasskeySettings() {
  const { t, i18n } = useTranslation();
  const { account } = useAccount();
  const { publicInfo } = usePublicInfo();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [action, setAction] = useState<PasskeyAction | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const operationRef = useRef<AbortController | null>(null);
  const requiresOtp = account?.["2fa_enabled"] === true;
  const supportError = passkeySupportError();
  const enabled = publicInfo?.passkey_enabled === true;

  const loadPasskeys = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setListError("");
    try {
      const list = await passkeyRequest<Passkey[]>("/api/admin/passkey", { signal });
      if (!Array.isArray(list)) throw new Error(t("passkey.errors.request_failed"));
      if (!signal.aborted) setPasskeys(list);
    } catch (error) {
      if (!signal.aborted) setListError(passkeyErrorMessage(error, t));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPasskeys(controller.signal);
    return () => controller.abort();
  }, [loadPasskeys]);

  useEffect(() => () => operationRef.current?.abort(), []);

  const openAction = (next: PasskeyAction) => {
    setName(next.kind === "register" ? "" : next.passkey.name);
    setPassword("");
    setOtp("");
    setActionError("");
    setAction(next);
  };

  const closeAction = () => {
    if (busy) return;
    setAction(null);
    setPassword("");
    setOtp("");
    setActionError("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || busy) return;
    const trimmedName = name.trim();
    if (action.kind !== "delete" && (!trimmedName || trimmedName.length > 100)) {
      setActionError(t("passkey.name_required"));
      return;
    }
    const needsIdentity = action.kind !== "rename";
    if (needsIdentity && (requiresOtp ? !/^\d{6}$/.test(otp) : !password)) {
      setActionError(t(requiresOtp ? "passkey.otp_required" : "passkey.password_required"));
      return;
    }
    const identity: PasskeyIdentity = requiresOtp
      ? { "2fa_code": otp }
      : { password };
    const controller = new AbortController();
    operationRef.current = controller;
    setBusy(true);
    setActionError("");
    try {
      if (action.kind === "register") {
        await registerPasskey(trimmedName, identity, controller.signal);
      } else {
        await passkeyRequest(`/api/admin/passkey/${encodeURIComponent(action.passkey.id)}`, {
          method: action.kind === "rename" ? "PATCH" : "DELETE",
          body: JSON.stringify(action.kind === "rename" ? { name: trimmedName } : identity),
          signal: controller.signal,
        });
      }
      if (controller.signal.aborted) return;
      toast.success(t(`passkey.${action.kind}_success`));
      setAction(null);
      setPassword("");
      setOtp("");
      await loadPasskeys(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) setActionError(passkeyErrorMessage(error, t));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (operationRef.current === controller) operationRef.current = null;
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) return t("passkey.never_used");
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(i18n.language);
  };

  return (
    <section className="km-account-passkey flex w-full max-w-2xl flex-col gap-3">
      <Text as="div" size="5" weight="bold">{t("passkey.title")}</Text>
      <Text as="p" size="2" color="gray">{t("passkey.description")}</Text>
      {!enabled && (
        <Text size="2" color="gray">
          {t("passkey.disabled")}{" "}
          <Link to="/admin/settings/sign-on" className="underline">
            {t("passkey.open_settings")}
          </Link>
        </Text>
      )}
      {supportError && <Text size="2" color="gray">{t(supportError)}</Text>}
      <div>
        <Button
          type="button"
          disabled={!enabled || !!supportError || busy}
          onClick={() => openAction({ kind: "register" })}
        >
          <Plus size={16} />{t("passkey.add")}
        </Button>
      </div>
      {loading ? <Text size="2">{t("loading")}</Text> : listError ? (
        <Text size="2" color="red" role="alert">{listError}</Text>
      ) : passkeys.length === 0 ? (
        <Text size="2" color="gray">{t("passkey.empty")}</Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="rounded-md border border-[var(--gray-a5)] p-3">
              <Flex gap="3" justify="between" align="start" wrap="wrap">
                <div className="min-w-0 flex-1">
                  <Text as="div" weight="bold" className="flex items-center gap-2 break-all">
                    <KeyRound size={16} className="shrink-0" />{passkey.name}
                  </Text>
                  <Text as="div" size="2" color="gray">
                    {t("passkey.created_at")}: {formatDate(passkey.created_at)}
                  </Text>
                  <Text as="div" size="2" color="gray">
                    {t("passkey.last_used_at")}: {formatDate(passkey.last_used_at)}
                  </Text>
                </div>
                <Flex gap="2">
                  <Button
                    type="button"
                    variant="soft"
                    disabled={busy}
                    onClick={() => openAction({ kind: "rename", passkey })}
                  >
                    <Pencil size={14} />{t("passkey.rename")}
                  </Button>
                  <Button
                    type="button"
                    variant="soft"
                    color="red"
                    disabled={busy}
                    onClick={() => openAction({ kind: "delete", passkey })}
                  >
                    <Trash2 size={14} />{t("common.delete")}
                  </Button>
                </Flex>
              </Flex>
            </li>
          ))}
        </ul>
      )}
      <Dialog.Root open={action !== null} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>
            {t(action?.kind === "delete" ? "passkey.delete_title"
              : action?.kind === "rename" ? "passkey.rename" : "passkey.add")}
          </Dialog.Title>
          <Dialog.Description>
            {action?.kind === "delete"
              ? t("passkey.delete_description", { name: action.passkey.name })
              : action?.kind === "rename"
                ? t("passkey.rename_description")
                : t("passkey.register_description")}
          </Dialog.Description>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            {action?.kind !== "delete" && (
              <label>
                <Text as="div" size="2" mb="1">{t("passkey.name")}</Text>
                <TextField.Root
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  placeholder={t("passkey.name_placeholder")}
                  disabled={busy}
                  required
                  autoFocus
                />
              </label>
            )}
            {action?.kind !== "rename" && (
              <label>
                <Text as="div" size="2" mb="1">
                  {t(requiresOtp ? "account.2fa_otp_input_prompt" : "passkey.current_password")}
                </Text>
                <TextField.Root
                  value={requiresOtp ? otp : password}
                  onChange={(event) => requiresOtp
                    ? setOtp(event.target.value)
                    : setPassword(event.target.value)}
                  type={requiresOtp ? "text" : "password"}
                  inputMode={requiresOtp ? "numeric" : undefined}
                  autoComplete={requiresOtp ? "one-time-code" : "current-password"}
                  maxLength={requiresOtp ? 6 : undefined}
                  pattern={requiresOtp ? "[0-9]{6}" : undefined}
                  placeholder={requiresOtp ? "000000" : undefined}
                  disabled={busy}
                  required
                />
              </label>
            )}
            {actionError && <Text size="2" color="red" role="alert">{actionError}</Text>}
            <Flex gap="2" justify="end" mt="2">
              <Button type="button" variant="soft" disabled={busy} onClick={closeAction}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy} color={action?.kind === "delete" ? "red" : undefined}>
                {busy ? t("loading") : t("common.confirm")}
              </Button>
            </Flex>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </section>
  );
}