// Copyright 2024 the JSR authors. MIT license.
import * as path from "node:path";
import * as fs from "node:fs";
import * as kl from "kolorist";
import { exec, fileExists, JsrPackage } from "./utils";
import { Bun, getPkgManager, PkgManagerName } from "./pkg_manager";
import { downloadDeno, getDenoDownloadUrl } from "./download";

const NPMRC_FILE = ".npmrc";
const BUNFIG_FILE = "bunfig.toml";
const JSR_NPMRC = `@jsr:registry=https://npm.jsr.io\n`;
const JSR_BUNFIG = `[install.scopes]\n"@jsr" = "https://npm.jsr.io/"\n`;

async function wrapWithStatus(msg: string, fn: () => Promise<void>) {
  process.stdout.write(msg + "...");

  try {
    await fn();
    process.stdout.write(kl.green("ok") + "\n");
  } catch (err) {
    process.stdout.write(kl.red("error") + "\n");
    throw err;
  }
}

export async function setupNpmRc(dir: string) {
  const npmRcPath = path.join(dir, NPMRC_FILE);
  const msg = `Setting up ${NPMRC_FILE}`;
  try {
    let content = await fs.promises.readFile(npmRcPath, "utf-8");
    if (!content.includes(JSR_NPMRC)) {
      content += JSR_NPMRC;
      await wrapWithStatus(msg, async () => {
        await fs.promises.writeFile(npmRcPath, content);
      });
    }
  } catch (err) {
    if (err instanceof Error && (err as any).code === "ENOENT") {
      await wrapWithStatus(msg, async () => {
        await fs.promises.writeFile(npmRcPath, JSR_NPMRC);
      });
    } else {
      throw err;
    }
  }
}

export async function setupBunfigToml(dir: string) {
  const bunfigPath = path.join(dir, BUNFIG_FILE);
  const msg = `Setting up ${BUNFIG_FILE}`;
  try {
    let content = await fs.promises.readFile(bunfigPath, "utf-8");
    if (!/^"@myorg1"\s+=/gm.test(content)) {
      content += JSR_BUNFIG;
      await wrapWithStatus(msg, async () => {
        await fs.promises.writeFile(bunfigPath, content);
      });
    }
  } catch (err) {
    if (err instanceof Error && (err as any).code === "ENOENT") {
      await wrapWithStatus(msg, async () => {
        await fs.promises.writeFile(bunfigPath, JSR_BUNFIG);
      });
    } else {
      throw err;
    }
  }
}

export interface BaseOptions {
  pkgManagerName: PkgManagerName | null;
}

export interface InstallOptions extends BaseOptions {
  mode: "dev" | "prod" | "optional";
}

export async function install(packages: JsrPackage[], options: InstallOptions) {
  const pkgManager = await getPkgManager(process.cwd(), options.pkgManagerName);

  if (pkgManager instanceof Bun) {
    // Bun doesn't support reading from .npmrc yet
    await setupBunfigToml(pkgManager.cwd);
  } else {
    await setupNpmRc(pkgManager.cwd);
  }

  console.log(`Installing ${kl.cyan(packages.join(", "))}...`);
  await pkgManager.install(packages, options);
}

export async function remove(packages: JsrPackage[], options: BaseOptions) {
  const pkgManager = await getPkgManager(process.cwd(), options.pkgManagerName);
  console.log(`Removing ${kl.cyan(packages.join(", "))}...`);
  await pkgManager.remove(packages);
}

export interface PublishOptions {
  binFolder: string;
  dryRun: boolean;
  allowSlowTypes: boolean;
  token: string | undefined;
}

export async function publish(cwd: string, options: PublishOptions) {
  const info = await getDenoDownloadUrl();

  const binPath = path.join(
    options.binFolder,
    info.version,
    // Ensure each binary has their own folder to avoid overwriting it
    // in case jsr gets added to a project as a dependency where
    // developers use multiple OSes
    process.platform,
    process.platform === "win32" ? "deno.exe" : "deno",
  );

  // Check if deno executable is available, download it if not.
  if (!(await fileExists(binPath))) {
    // Clear folder first to get rid of old download artifacts
    // to avoid taking up lots of disk space.
    try {
      await fs.promises.rm(options.binFolder, { recursive: true });
    } catch (err) {
      if (!(err instanceof Error) || (err as any).code !== "ENOENT") {
        throw err;
      }
    }

    await downloadDeno(binPath, info);
  }

  // Ready to publish now!
  const args = [
    "publish",
    "--unstable-bare-node-builtins",
    "--unstable-sloppy-imports",
  ];
  if (options.dryRun) args.push("--dry-run");
  if (options.allowSlowTypes) args.push("--allow-slow-types");
  if (options.token) args.push("--token", options.token);
  await exec(binPath, args, cwd);
}
