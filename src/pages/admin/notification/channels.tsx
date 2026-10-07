import React, { useMemo } from "react";
import { Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Loading from "@/components/loading";
import {
  SettingCardButton,
  SettingCardLabel,
  SettingCardLongTextInput,
  SettingCardSelect,
  SettingCardSwitch,
} from "@/components/admin/SettingCard";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { updateSettingsWithToast, useSettings } from "@/lib/api";
import { renderProviderInputs } from "@/utils/renderProviders";

interface ProviderField {
  name: string;
  type: string;
  default?: string;
  required?: boolean;
  options?: string;
  help?: string;
}

type ProviderDefinitions = Record<string, ProviderField[]>;
type ProviderValues = Record<string, unknown>;

interface ProviderConfiguration {
  name: string;
  addition: string;
}

function getDefaultValues(fields: ProviderField[]): ProviderValues {
  return Object.fromEntries(
    fields.map((field) => {
      let value: unknown = field.default ?? "";
      if (field.type === "bool") {
        value = value === "true";
      } else if (["int", "int64", "float32", "float64"].includes(field.type)) {
        value = Number(value);
      }
      return [field.name, value];
    }),
  );
}

const NotificationSettings = () => {
  const { t } = useTranslation();
  const { call } = useRPC2Call();
  const { settings, loading, error } = useSettings();
  const [providerDefs, setProviderDefs] = React.useState<ProviderDefinitions>();
  const [providerError, setProviderError] = React.useState("");
  const [currentProvider, setCurrentProvider] = React.useState("");
  const [loadedProvider, setLoadedProvider] = React.useState("");
  const [providerValues, setProviderValues] = React.useState<ProviderValues>({});
  const [configurationError, setConfigurationError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);

  React.useEffect(() => {
    if (!loading) {
      setCurrentProvider(settings.notification_method || "none");
    }
  }, [loading, settings.notification_method]);

  React.useEffect(() => {
    let cancelled = false;
    setProviderError("");
    call<undefined, Record<string, ProviderField[] | null>>(
      "admin:getMessageSenderProvider",
    )
      .then((data) => {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Invalid message sender provider definitions");
        }
        const definitions: ProviderDefinitions = {};
        for (const [name, fields] of Object.entries(data)) {
          // empty 是服务端的空发送器，界面统一通过 none 表示停用渠道。
          if (name === "empty") continue;
          if (fields !== null && !Array.isArray(fields)) {
            throw new Error("Invalid message sender provider fields: " + name);
          }
          definitions[name] = fields ?? [];
        }
        if (!cancelled) setProviderDefs(definitions);
      })
      .catch((err) => {
        if (!cancelled) {
          setProviderError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [call]);

  React.useEffect(() => {
    setLoadedProvider("");
    setConfigurationError("");
    setProviderValues({});
    if (
      !currentProvider ||
      currentProvider === "none" ||
      !providerDefs?.[currentProvider]
    ) {
      return;
    }

    let cancelled = false;
    const defaults = getDefaultValues(providerDefs[currentProvider]);
    call<{ provider: string }, ProviderConfiguration>(
      "admin:getMessageSenderProvider",
      { provider: currentProvider },
    )
      .then((result) => {
        if (
          result?.name !== currentProvider ||
          typeof result.addition !== "string"
        ) {
          throw new Error("Invalid message sender provider configuration");
        }
        const values: unknown = JSON.parse(result.addition || "{}");
        if (!values || typeof values !== "object" || Array.isArray(values)) {
          throw new Error("Message sender configuration must be a JSON object");
        }
        if (!cancelled) {
          setProviderValues({ ...defaults, ...values });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // 当前 RPC 客户端将错误码和消息合并为 Error；仅缺少记录可首次填写，
        // 不能把网络、权限、数据库或 JSON 错误当成空配置后覆盖保存。
        if (
          err instanceof Error &&
          err.message ===
            "RPC Error -32044: Provider not found: record not found"
        ) {
          setProviderValues(defaults);
        } else {
          setConfigurationError(
            err instanceof Error ? err.message : String(err),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedProvider(currentProvider);
      });
    return () => {
      cancelled = true;
    };
  }, [call, currentProvider, providerDefs]);

  const providerOptions = useMemo(() => {
    const options = [
      { value: "none", label: t("common.none") },
      ...Object.keys(providerDefs ?? {}).map((name) => ({
        value: name,
        label: name,
      })),
    ];
    if (
      currentProvider &&
      !options.some((option) => option.value === currentProvider)
    ) {
      options.push({
        value: currentProvider,
        label:
          currentProvider + " (" + t("settings.notification.unavailable") + ")",
      });
    }
    return options;
  }, [providerDefs, currentProvider, t]);

  const currentRegistered = Boolean(providerDefs?.[currentProvider]);

  const saveConfiguration = async (values: ProviderValues) => {
    setSaving(true);
    try {
      await call("admin:setMessageSenderProvider", {
        name: currentProvider,
        addition: JSON.stringify(values),
      });
      toast.success(t("common.success"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return <Text color="red">{error}</Text>;
  }
  if (providerError) {
    return (
      <Text color="red">
        {t("settings.notification.provider_fetch_failed")}: {providerError}
      </Text>
    );
  }
  if (loading || !providerDefs) {
    return <Loading />;
  }

  return (
    <>
      <SettingCardLabel>{t("settings.notification.title")}</SettingCardLabel>
      <SettingCardSwitch
        title={t("settings.notification.enable")}
        description={t("settings.notification.enable_description")}
        defaultChecked={settings.notification_enabled}
        onChange={async (checked) => {
          await updateSettingsWithToast(
            { notification_enabled: checked },
            t,
          );
        }}
        className="km-page-admin-settings-notification km-setting-card"
      />
      <SettingCardLongTextInput
        title={t("settings.notification.template")}
        description={t("settings.notification.template_description")}
        defaultValue={settings.notification_template}
        OnSave={async (value) => {
          await updateSettingsWithToast(
            { notification_template: value },
            t,
          );
        }}
      />
      <SettingCardSelect
        title={t("settings.notification.method")}
        description={t("settings.notification.method_description")}
        options={providerOptions}
        value={currentProvider}
        isSaving={saving || switching}
        OnSave={async (value) => {
          if (value === currentProvider) return;
          setSwitching(true);
          try {
            await updateSettingsWithToast(
              { notification_method: value },
              t,
            );
            setCurrentProvider(value);
          } finally {
            setSwitching(false);
          }
        }}
      />
      {currentProvider && !currentRegistered && currentProvider !== "none" ? (
        <Text color="gray">
          {t("settings.notification.channel_unavailable")}
        </Text>
      ) : null}
      {currentRegistered ? (
        loadedProvider !== currentProvider ? (
          <Loading />
        ) : configurationError ? (
          <Text color="red">
            {t("settings.notification.provider_settings_fetch_failed")}:{" "}
            {configurationError}
          </Text>
        ) : (
          <fieldset
            disabled={saving || switching}
            className="m-0 min-w-0 border-0 p-0"
          >
            {renderProviderInputs({
              currentProvider,
              providerDefs,
              providerValues,
              translationPrefix: "settings.notification." + currentProvider,
              title: t("settings.notification.provider_fields"),
              description: t("settings.notification.provider_fields_description"),
              setProviderValues,
              handleSave: saveConfiguration,
              t,
            })}
          </fieldset>
        )
      ) : null}
      <fieldset disabled={saving || switching} className="m-0 min-w-0 border-0 p-0">
        <SettingCardButton
          title={t("settings.notification.test_title")}
          description={t("settings.notification.test_description")}
          onClick={async () => {
            try {
              await call("admin:testSendMessage");
              toast.success(t("common.success"));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          }}
          className="km-setting-card"
        >
          GO
        </SettingCardButton>
      </fieldset>
    </>
  );
};

export default NotificationSettings;
