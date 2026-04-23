import { invoke } from "@tauri-apps/api/core";

export const ipc = {
  getAppVersion: () => invoke<string>("get_app_version"),
};
