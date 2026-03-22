import fs from "fs-extra";
import path from "path";
import os from "os";

const configDir = path.join(os.homedir(), ".gitpilot");
const configFile = path.join(configDir, "config.json");

export async function loadConfig() {
    await fs.ensureDir(configDir);

    if (!(await fs.pathExists(configFile))) {
        const initial = {};
        await fs.writeJson(configFile, initial, { spaces: 2 });
        return initial;
    }

    return fs.readJson(configFile);
}

export async function saveConfig(config: any) {
    await fs.writeJson(configFile, config, { spaces: 2 });
}

export async function deleteConfig() {
    if (await fs.pathExists(configFile)) {
        await fs.remove(configFile);
    }
}