import { invoke } from "@tauri-apps/api/core";

export const ipc = {
  getAppVersion: () => invoke<string>("get_app_version"),
  navigate: (url: string) => invoke<void>("navigate", { url }),
  resizeContent: (width: number, height: number) =>
    invoke<void>("resize_content", { width, height }),
};
