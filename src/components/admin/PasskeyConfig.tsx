import { useState } from "react";
import { Button, Flex, Switch, Text, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingCard } from "@/components/admin/SettingCard";
import { updateSettings } from "@/lib/api";
import { normalizePasskeyOrigin, passkeyErrorMessage } from "@/lib/passkey";

export default function PasskeyConfig({
  enabled,
  origin,
  onSaved,
}: {
  enabled: boolean;
  origin: string;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draftEnabled, setDraftEnabled] = useState(enabled);
  const [draftOrigin, setDraftOrigin] = useState(origin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const input = draftOrigin.trim();
    const normalized = input ? normalizePasskeyOrigin(input) : "";
    if ((draftEnabled && !normalized) || (input && !normalized)) {
      setError(t("passkey.config.invalid_origin"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateSettings({
        passkey_enabled: draftEnabled,
        passkey_origin: normalized || "",
      });
      setDraftOrigin(normalized || "");
      await onSaved();
      toast.success(t("settings.settings_saved"));
    } catch (saveError) {
      setError(passkeyErrorMessage(saveError, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingCard
      title={t("passkey.title")}
      description={t("passkey.config.description")}
      className="km-setting-passkey"
    >
      <form onSubmit={save} className="flex w-full flex-col gap-3 py-2">
        <Flex gap="2" align="center">
          <Switch
            id="passkey-enabled"
            checked={draftEnabled}
            disabled={saving}
            onCheckedChange={setDraftEnabled}
          />
          <label htmlFor="passkey-enabled">{t("passkey.config.enable")}</label>
        </Flex>
        <label htmlFor="passkey-origin">{t("passkey.config.origin")}</label>
        <TextField.Root
          id="passkey-origin"
          type="url"
          value={draftOrigin}
          placeholder="https://monitor.example.com"
          disabled={saving}
          onChange={(event) => setDraftOrigin(event.target.value)}
          aria-describedby="passkey-origin-help"
          className="max-w-128"
        />
        <Text id="passkey-origin-help" size="2" color="gray">
          {t("passkey.config.origin_hint")}
        </Text>
        {error && <Text size="2" color="red" role="alert">{error}</Text>}
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? t("loading") : t("common.save")}
          </Button>
        </div>
      </form>
    </SettingCard>
  );
}