import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRPC2Call } from "@/contexts/RPC2Context";
import type { PingMetricStat, PingMetricStatsResponse, PublicPingTask } from "@/types/metrics";

type EntryProbeStatusProps = {
  uuid: string;
  tasks: PublicPingTask[];
};

type ProbeSnapshot = {
  stats: PingMetricStat[];
  serverTime: number;
  receivedAt: number;
};

// 当前状态单独查询，不使用历史聚合桶或最后一次成功值推断可达性。
const EntryProbeStatus = ({ uuid, tasks }: EntryProbeStatusProps) => {
  const { call } = useRPC2Call();
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ProbeSnapshot | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const hasEntries = tasks.some((task) => task.target_client === uuid);

  useEffect(() => {
    if (!hasEntries) return;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [hasEntries]);

  useEffect(() => {
    if (!uuid || !hasEntries) return;
    let active = true;
    let inFlight = false;
    let requestVersion = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const version = requestVersion;
      const startedAt = performance.now();
      try {
        const result = await call<unknown, PingMetricStatsResponse>(
          "public:getPingMetricStats",
          { entity_id: uuid, hours: 1, max_points: 1 },
          { timeout: 10000 },
        );
        const receivedAt = performance.now();
        if (active && version === requestVersion && !document.hidden) {
          setSnapshot({
            stats: Array.isArray(result?.stats) ? result.stats : [],
            // end 是本次查询的服务端时间；计入整个请求耗时，避免慢响应延长样本有效期。
            serverTime: Date.parse(result.end) + Math.max(0, receivedAt - startedAt),
            receivedAt,
          });
          setNow(receivedAt);
        }
      } catch {
        // 失联只代表当前无数据，不能记为一次探测失败。
        if (active && version === requestVersion) setSnapshot(null);
      } finally {
        inFlight = false;
        if (active && !document.hidden) {
          timer = setTimeout(() => void refresh(), version === requestVersion ? 15000 : 0);
        }
      }
    };
    const resume = () => {
      // 页面挂起后丢弃旧快照和在途响应，恢复可见时重新建立服务端时钟基准。
      requestVersion += 1;
      setSnapshot(null);
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    setSnapshot(null);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [call, hasEntries, uuid]);

  if (!hasEntries) return null;
  return (
    <div className="flex shrink-0 flex-col gap-1 text-xs" aria-live="polite">
      {tasks.filter((task) => task.target_client === uuid).map((task) => {
        const stat = snapshot?.stats.find((item) => item.entity_id === uuid && item.task_id === String(task.id));
        const sampleTime = stat?.current_time ? new Date(stat.current_time).getTime() : NaN;
        const serverNow = snapshot ? snapshot.serverTime + Math.max(0, now - snapshot.receivedAt) : NaN;
        const age = serverNow - sampleTime;
        const freshnessMs = Math.max(3 * (stat?.interval || task.interval || 60), 60) * 1000;
        const fresh = Number.isFinite(age) && age >= -5000 && age <= freshnessMs;
        const available = stat?.probe_source_online === true && fresh && typeof stat?.current_value === "number" && Number.isFinite(stat.current_value);
        const status = !available
          ? t("ping.no_current_data")
          : stat.current_value! < 0
            ? t("ping.probe_failed")
            : `${Math.round(stat.current_value!)} ms`;
        return (
          <div key={task.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{task.name} · {t("ping.entry")}</span>
            <span className="text-muted-foreground">← {stat?.probe_source_name || t("ping.probe_source")}</span>
            <span className={available && stat.current_value! < 0 ? "text-red-500" : "text-muted-foreground"}>
              {t("ping.current_status")}: {status}
              {stat?.probe_source_online === false ? ` (${t("ping.source_offline")})` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default EntryProbeStatus;
