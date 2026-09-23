import { Suspense, lazy } from "react";
import { Flex, Heading, Select, Text } from "@radix-ui/themes";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Loading from "@/components/loading";
import { NodeDetailsProvider, useNodeDetails } from "@/contexts/NodeDetailsContext";

const FileManagerPanel = lazy(() => import("../terminal/FileManagerPanel"));

const FileManager = () => {
  const { t } = useTranslation();
  const { nodeDetail, isLoading, error } = useNodeDetails();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedUuid = searchParams.get("uuid");
  const nodes = [...nodeDetail].sort((a, b) => a.weight - b.weight);
  const uuid = nodes.some((node) => node.uuid === requestedUuid) ? requestedUuid : null;

  if (isLoading) return <Loading />;
  if (error) return <Text color="red">{error}</Text>;

  return (
    <Flex direction="column" gap="3" p="4" className="km-page-admin-files h-[calc(100dvh-4rem)] min-h-[360px]">
      <Flex align="center" justify="between" gap="3" wrap="wrap">
        <Heading as="h1" size="6">{t("file_manager.title")}</Heading>
        <Select.Root value={uuid ?? ""} onValueChange={(value) => setSearchParams({ uuid: value })}>
          <Select.Trigger aria-label={t("common.server")} placeholder={t("file_manager.no_server")} />
          <Select.Content>
            {nodes.map((node) => (
              <Select.Item key={node.uuid} value={node.uuid}>{node.name}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-[#181818]">
        <Suspense fallback={<Loading />}>
          <FileManagerPanel key={uuid ?? "empty"} uuid={uuid} />
        </Suspense>
      </div>
    </Flex>
  );
};

export default function FilesPage() {
  return <NodeDetailsProvider><FileManager /></NodeDetailsProvider>;
}
