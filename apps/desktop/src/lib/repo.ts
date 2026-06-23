import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../api/git.js";

/** Open the OS folder picker and load the chosen git repository. No-op outside
 *  a Tauri shell (plain `vite` mock mode has no native dialog). */
export async function chooseRepo(openRepo: (path: string) => Promise<void>): Promise<void> {
  if (!isTauri) return;
  const dir = await open({ directory: true, multiple: false, title: "Open a git repository" });
  if (typeof dir === "string") await openRepo(dir);
}
