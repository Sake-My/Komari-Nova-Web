type ThemeSettings = Record<string, unknown>;

let pending: Promise<void> = Promise.resolve();

export async function readCurrentThemeSettings() {
  const response = await fetch("/api/public", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { data } = await response.json();
  if (
    !data ||
    typeof data.theme !== "string" ||
    !data.theme_settings ||
    typeof data.theme_settings !== "object" ||
    Array.isArray(data.theme_settings)
  ) {
    throw new Error("Invalid theme settings response");
  }
  return {
    theme: data.theme as string,
    settings: data.theme_settings as ThemeSettings,
  };
}

// 接口会整包替换主题配置，写入前合并最新值，保留布局等未在表单声明的键。
export function saveThemeSettings(
  theme: string,
  patch: ThemeSettings | ((current: ThemeSettings) => ThemeSettings),
) {
  const save = async () => {
    const current = await readCurrentThemeSettings();
    if (current.theme !== theme) throw new Error("The active theme has changed");
    const values = typeof patch === "function" ? patch(current.settings) : patch;
    const response = await fetch(
      `/api/admin/theme/settings?theme=${encodeURIComponent(theme)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current.settings, ...values }),
        keepalive: true,
      },
    );
    if (!response.ok) {
      const error: unknown = await response.json().catch(() => null);
      const message =
        error && typeof error === "object" && "message" in error &&
        typeof error.message === "string" ? error.message : "";
      throw new Error(message || `HTTP ${response.status}`);
    }
  };
  const run = () =>
    navigator.locks
      ? navigator.locks.request("komari-theme-settings", save)
      : save();
  // 同页串行写入；支持 Web Locks 时也协调跨标签页写入，前次失败不阻塞后续保存。
  const task = pending.then(run, run);
  pending = task;
  return task;
}
