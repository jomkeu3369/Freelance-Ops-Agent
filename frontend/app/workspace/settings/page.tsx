"use client";

import { SettingsPanel } from "../../../features/workspace/settings/settings-panel";
import { useWorkspace } from "../../../features/workspace/workspace-context";

export default function SettingsPanelPage() {
  const { settings } = useWorkspace();
  return <SettingsPanel {...settings} />;
}
