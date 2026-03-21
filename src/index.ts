#!/usr/bin/env node

import { Command } from 'commander';
import simpleGit from "simple-git";
import fs from "fs";
import path from "path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ensureGitRepo, getChangedFiles, isBehindRemote, getDiffStats } from './utils/git.js';
import { loadState, saveState } from './utils/state.js';
import { loadConfig, saveConfig } from "./utils/config.js";
import { pullState, pushState } from "./utils/sync.js";
import { error, header, info, list, section, success, warning } from "./utils/ui.js";

const git = simpleGit();
const program = new Command();

type LockEntry = { file: string; user: string; time?: string };
type ActivityEntry = { file: string; user: string; added: number; removed: number; timestamp: number };
type StateShape = { locks: LockEntry[]; activity: ActivityEntry[] };
type HookDef = { fileName: "pre-commit" | "pre-push"; command: "hook-precommit" | "hook-prepush" };

const hookDefs: HookDef[] = [
    { fileName: "pre-commit", command: "hook-precommit" },
    { fileName: "pre-push", command: "hook-prepush" },
];
const gitPilotHookMarker = "# GitPilot Hook";

function getRepoName() {
    return path.basename(process.cwd());
}

function normalizeRepoPath(inputPath: string) {
    const absolute = path.resolve(process.cwd(), inputPath);
    const relative = path.relative(process.cwd(), absolute);
    return relative.split(path.sep).join("/");
}

function normalizeState(rawState: any): StateShape {
    const locks = (rawState?.locks ?? []).map((lock: any) => ({
        ...lock,
        file: normalizeRepoPath(lock.file),
    }));

    const activity = (rawState?.activity ?? []).map((item: any) => ({
        ...item,
        file: normalizeRepoPath(item.file),
    }));

    return { locks, activity };
}

function isGitPilotManagedHook(content: string) {
    return content.includes(gitPilotHookMarker) ||
        content.includes("gitpilot hook-precommit") ||
        content.includes("gitpilot hook-prepush");
}

function makeHookScript(command: HookDef["command"]) {
    return `#!/bin/sh
${gitPilotHookMarker}
gitpilot ${command}
exit $?
`;
}

function isValidMongoUri(uri: string) {
    return uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://");
}

async function askYesNoWithRetry(rl: ReturnType<typeof createInterface>, prompt: string, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const answer = (await rl.question(prompt)).trim().toLowerCase();

        if (answer === "y") {
            return true;
        }

        if (answer === "n") {
            return false;
        }

        warning("Please enter y or n");
    }

    return null;
}

async function askNameWithRetry(rl: ReturnType<typeof createInterface>, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const name = (await rl.question("Enter your name: ")).trim();

        if (name) {
            return name;
        }

        error("Name cannot be empty");
    }

    return null;
}

async function askMongoUriWithRetry(rl: ReturnType<typeof createInterface>, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const mongoUri = (await rl.question("Enter Mongo URI: ")).trim();

        if (isValidMongoUri(mongoUri)) {
            return mongoUri;
        }

        error("Invalid Mongo URI");
    }

    return null;
}

function getHookStateSummary() {
    const hooksDir = path.join(process.cwd(), ".git", "hooks");

    let managed = 0;
    let missing = 0;
    let nonManaged = 0;

    for (const hook of hookDefs) {
        const hookPath = path.join(hooksDir, hook.fileName);

        if (!fs.existsSync(hookPath)) {
            missing += 1;
            continue;
        }

        const content = fs.readFileSync(hookPath, "utf8");
        if (isGitPilotManagedHook(content)) {
            managed += 1;
        } else {
            nonManaged += 1;
        }
    }

    return { managed, missing, nonManaged };
}

function installGitPilotHooks() {
    const hooksDir = path.join(process.cwd(), ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    let installed = 0;

    for (const hook of hookDefs) {
        const hookPath = path.join(hooksDir, hook.fileName);

        if (fs.existsSync(hookPath)) {
            const existing = fs.readFileSync(hookPath, "utf8");

            if (isGitPilotManagedHook(existing)) {
                info(`${hook.fileName} already installed`);
                continue;
            }

            warning(`Existing ${hook.fileName} hook detected, skip`);
            continue;
        }

        fs.writeFileSync(hookPath, makeHookScript(hook.command));
        fs.chmodSync(hookPath, 0o755);
        success(`Installed ${hook.fileName} hook`);
        installed += 1;
    }

    return { installed };
}

function areAllGitPilotHooksInstalled() {
    const hooksDir = path.join(process.cwd(), ".git", "hooks");

    if (!fs.existsSync(hooksDir)) {
        return false;
    }

    for (const hook of hookDefs) {
        const hookPath = path.join(hooksDir, hook.fileName);
        if (!fs.existsSync(hookPath)) {
            return false;
        }

        const content = fs.readFileSync(hookPath, "utf8");
        if (!isGitPilotManagedHook(content)) {
            return false;
        }
    }

    return true;
}

function formatErrorMessage(err: unknown) {
    if (err instanceof Error && err.message) {
        return err.message;
    }

    return "Command failed";
}

function safeAction<T extends any[]>(
    action: (...args: T) => Promise<void> | void,
    options?: { exitOnError?: boolean }
) {
    return async (...args: T) => {
        try {
            await action(...args);
        } catch (err) {
            error(formatErrorMessage(err));
            if (options?.exitOnError) {
                process.exit(1);
            }
        }
    };
}

async function requireUserConfig() {
    const config = await loadConfig();

    if (!config.user) {
        error("Please run: gitpilot config set-user <name>");
        return null;
    }

    return config.user as string;
}

program
    .name("gitpilot")
    .description("A CLI tool to assist with Git operations")
    .version("1.0.0");

// Command: gtp lock <file> - locks a file to prevent others from editing it, and shows who locked the file and when. If already locked, show error with who locked it and when, and do not allow locking. Store locks in a state file in the .git directory, and user name in a config file in the user's home directory.
program
    .command("lock <file>")
    .description("Lock a file to prevent others from editing it")
    .action(safeAction(async (file) => {
        ensureGitRepo();
        const repo = getRepoName();
        const targetFile = normalizeRepoPath(file);

        await pullState(repo);

        const state = normalizeState(await loadState());
        const user = await requireUserConfig();

        if (!user) {
            return;
        }

        const existing = state.locks.find((l: any) => l.file === targetFile);

        if (existing) {
            warning(`Already locked: ${targetFile}`);
            return;
        }

        state.locks.push({
            file: targetFile,
            user,
            time: new Date().toISOString(),
        });

        await saveState(state);
        await pushState(repo);
        success(`Locked: ${targetFile}`);
    }));

// Command: gtp who - shows who locked which files and recent activity in the repo, including who made changes to which files and when, based on the state file in the .git directory and config file in the user's home directory. If no activity, show message saying no activity yet.
program
    .command("who")
    .description("Show team activity and file locks")
    .action(safeAction(async () => {
        ensureGitRepo();
        const repo = getRepoName();

        await pullState(repo);
        const state = normalizeState(await loadState());

        const activeLocks = state.locks || [];
        const activityLog = state.activity || [];

        header("GitPilot Status");

        if (activeLocks.length === 0 && activityLog.length === 0) {
            info("No locks or activity found");
            return;
        }

        section("Active Locks");
        if (activeLocks.length === 0) {
            info("No active locks");
        } else {
            const lockWidth = Math.max(...activeLocks.map((l: any) => l.file.length), 12);
            activeLocks.forEach((l: any) => {
                console.log(`  ${l.file.padEnd(lockWidth)} -> ${l.user}`);
            });
        }

        section("Recent Activity");
        if (activityLog.length === 0) {
            info("No recent activity");
        } else {
            const latestActivity = new Map();

            activityLog.forEach((a: any) => {
                if (a.added > 0 || a.removed > 0) {
                    latestActivity.set(a.file, a);
                }
            });

            if (latestActivity.size === 0) {
                info("No line changes recorded");
            } else {
                const rows = Array.from(latestActivity.values());
                const activityWidth = Math.max(...rows.map((a: any) => a.file.length), 12);

                latestActivity.forEach((a) => {
                    console.log(`  ${a.file.padEnd(activityWidth)} -> ${a.user} (+${a.added} / -${a.removed})`);
                });
            }
        }
    }));

// Command: gtp config - group for configuration commands related to GitPilot settings, such as setting user name and MongoDB URI.
const config = program
    .command("config")
    .description("Configure GitPilot settings");

// Sub-command: gtp config set-user <name> - sets the user name for gitpilot actions in a config file in the user's home directory. This is used to identify who is locking files and making changes.
config
    .command("set-user <name>")
    .description("Set the user name for gitpilot actions")
    .action(safeAction(async (name) => {
        const configData = await loadConfig();
        configData.user = name;
        await saveConfig(configData);
        success(`User set: ${name}`);
    }));

// Sub-command: gtp config set-mongo <uri> - sets the MongoDB URI for storing state in a remote database instead of the local .git directory. This allows teams to share locks and activity across different machines. If not set, defaults to using local state file in .git directory.
// FIX: Removed the word 'config' from the command string below
config
    .command("set-mongo <uri>")
    .description("Set MongoDB URI")
    .action(safeAction(async (uri) => {
        // Renamed variable to configData to avoid shadowing the 'config' command object
        const configData = await loadConfig();
        configData.mongoUri = uri;
        await saveConfig(configData);
        success("Mongo URI configured");
    }));

config
    .command("unset-user")
    .description("Remove configured user")
    .action(safeAction(async () => {
        const configData = await loadConfig();

        if (!configData.user) {
            info("User not configured");
            return;
        }

        delete configData.user;
        await saveConfig(configData);
        success("User removed");
    }));

config
    .command("unset-mongo")
    .description("Remove configured MongoDB URI")
    .action(safeAction(async () => {
        const configData = await loadConfig();

        if (!configData.mongoUri) {
            info("Mongo not configured");
            return;
        }

        delete configData.mongoUri;
        await saveConfig(configData);
        success("Mongo removed");
    }));

config
    .command("reset")
    .description("Reset all GitPilot configuration")
    .action(safeAction(async () => {
        await saveConfig({});
        success("Configuration reset");
    }));

config
    .command("list")
    .description("Show current GitPilot configuration")
    .action(safeAction(async () => {
        const configData = await loadConfig();

        if (configData.user) {
            info(`User: ${configData.user}`);
        } else {
            info("User: not configured");
        }

        if (configData.mongoUri) {
            info("Mongo: configured");
        } else {
            info("Mongo: not configured");
        }
    }));

program
    .command("init")
    .description("Initialize GitPilot in current repository")
    .option("-y, --yes", "Accept defaults and skip prompts")
    .action(safeAction(async (options) => {
        const useDefaults = Boolean(options?.yes);
        const gitPath = path.join(process.cwd(), ".git");
        if (!fs.existsSync(gitPath)) {
            error("Not a git repository");
            return;
        }

        const configData = await loadConfig();
        const rl = createInterface({ input, output });

        try {
            if (!configData.user) {
                let detectedGitUser = "";

                try {
                    detectedGitUser = (await git.raw(["config", "user.name"]))?.trim() ?? "";
                } catch {
                    detectedGitUser = "";
                }

                if (detectedGitUser) {
                    info(`Detected git user: ${detectedGitUser}`);

                    if (useDefaults) {
                        configData.user = detectedGitUser;
                        await saveConfig(configData);
                        success(`User set: ${detectedGitUser}`);
                    } else {
                        const useDetected = await askYesNoWithRetry(rl, "Use this name? (y/n): ");

                        if (useDetected === null) {
                            error("Too many invalid responses");
                            return;
                        }

                        if (useDetected) {
                            configData.user = detectedGitUser;
                            await saveConfig(configData);
                            success(`User set: ${detectedGitUser}`);
                        } else {
                            const nameInput = await askNameWithRetry(rl);

                            if (!nameInput) {
                                error("Name cannot be empty");
                                return;
                            }

                            configData.user = nameInput;
                            await saveConfig(configData);
                            success(`User set: ${nameInput}`);
                        }
                    }
                } else {
                    if (useDefaults) {
                        error("Could not detect git user. Run gtp init without --yes or set user manually.");
                        return;
                    }

                    const nameInput = await askNameWithRetry(rl);

                    if (!nameInput) {
                        error("Name cannot be empty");
                        return;
                    }

                    configData.user = nameInput;
                    await saveConfig(configData);
                    success(`User set: ${nameInput}`);
                }
            } else {
                success(`User already set: ${configData.user}`);
            }

            if (!configData.mongoUri) {
                if (useDefaults) {
                    info("Mongo not configured");
                } else {
                    const wantsMongo = await askYesNoWithRetry(rl, "Configure MongoDB for team sync? (y/n): ");

                    if (wantsMongo === null) {
                        error("Too many invalid responses");
                        return;
                    }

                    if (wantsMongo) {
                        const mongoInput = await askMongoUriWithRetry(rl);

                        if (!mongoInput) {
                            error("Invalid Mongo URI");
                            return;
                        }

                        configData.mongoUri = mongoInput;
                        await saveConfig(configData);
                        success("Mongo configured");
                    } else {
                        info("Skipping Mongo setup");
                    }
                }
            } else {
                success("Mongo already configured");
            }
        } finally {
            rl.close();
        }

        const hookState = getHookStateSummary();

        if (hookState.managed === hookDefs.length) {
            success("Hooks already installed");
        } else if (hookState.nonManaged > 0) {
            warning("Existing hooks detected, not modified");
        } else {
            installGitPilotHooks();
            success("Hooks installed");
        }

        success("GitPilot initialized");
    }));

// Command: gtp unlock <file> - only the user who locked the file can unlock it, and if not locked show error
program
    .command("unlock <file>")
    .description("Unlock a file")
    .action(safeAction(async (file) => {
        ensureGitRepo();
        const repo = getRepoName();
        const targetFile = normalizeRepoPath(file);

        await pullState(repo);

        const user = await requireUserConfig();
        if (!user) {
            return;
        }

        const state = normalizeState(await loadState());

        const lockIndex = state.locks.findIndex(
            (l: any) => l.file === targetFile
        );

        if (lockIndex === -1) {
            warning(`Not locked: ${targetFile}`);
            return;
        }

        const lock = state.locks[lockIndex];

        if (!lock) {
            warning(`Not locked: ${targetFile}`);
            return;
        }

        if (lock.user !== user) {
            error(`Cannot unlock: ${targetFile} (owned by ${lock.user})`);
            return;
        }

        state.locks.splice(lockIndex, 1);

        await saveState(state);
        await pushState(repo);

        success(`Unlocked: ${targetFile}`);
    }));

// Command: gtp add <path> - safe git add that checks if you're behind remote before allowing add
program
    .command("add")
    .argument("<path>", "file or directory to add")
    .description("Safe git add with lock protection")
    .action(safeAction(async (pathArg) => {
        ensureGitRepo();

        const user = await requireUserConfig();
        if (!user) {
            return;
        }

        const behind = await isBehindRemote();

        if (behind > 0) {
            error(`Your branch is behind by ${behind} commits`);
            info("Run: git pull --rebase");
            return;
        }

        const changedFiles = (await getChangedFiles()).map((file) => normalizeRepoPath(file));
        const state = normalizeState(await loadState());

        const blockedFiles: string[] = [];

        for (const file of changedFiles) {
            const lock = state.locks.find((l: any) => l.file === file);

            if (lock && lock.user !== user) {
                blockedFiles.push(`${file} (locked by ${lock.user})`);
            }
        }

        if (blockedFiles.length > 0) {
            error("Cannot stage changes due to active locks");
            list(blockedFiles);
            return;
        }

        const diffStats = await getDiffStats();

        const now = Date.now();

        diffStats.forEach((d) => {
            if (!d.file) {
                return;
            }

            state.activity.push({
                file: normalizeRepoPath(d.file),
                user,
                added: d.added,
                removed: d.removed,
                timestamp: now,
            });
        });

        state.activity = state.activity.slice(-500);

        await saveState(state);

        await git.add(pathArg);

        success("Changes staged successfully");
    }));

// Command: gtp status - show workspace status with active locks and modified files. For modified files, show if they are locked and by whom, or if they are unlocked but modified (potentially risky). Also show any other active locks in the repo that you haven't modified yet, to increase awareness of potential conflicts.
program
    .command("status")
    .description("Show workspace status with active locks")
    .action(safeAction(async () => {
        ensureGitRepo();
        const state = normalizeState(await loadState());
        const changedFiles = (await getChangedFiles()).map((file) => normalizeRepoPath(file));
        const config = await loadConfig();

        header("GitPilot Repository Status");

        if (changedFiles.length === 0 && state.locks.length === 0) {
            info("Tree clean. No active locks or pending changes");
            return;
        }

        section("Modified Files");
        if (changedFiles.length === 0) {
            info("None");
        } else {
            const fileWidth = Math.max(...changedFiles.map((file) => file.length), 12);
            changedFiles.forEach(file => {
                const lock = state.locks.find((l: any) => l.file === file);
                if (lock) {
                    const status = lock.user === config.user ? "locked by you" : `locked by ${lock.user}`;
                    console.log(`  ${file.padEnd(fileWidth)} -> ${status}`);
                } else {
                    console.log(`  ${file.padEnd(fileWidth)} -> unlocked`);
                }
            });
        }

        const otherLocks = state.locks.filter((l: any) => !changedFiles.includes(l.file));
        section("Other Active Locks");
        if (otherLocks.length > 0) {
            const lockWidth = Math.max(...otherLocks.map((l: any) => l.file.length), 12);
            otherLocks.forEach((l: any) => {
                console.log(`  ${l.file.padEnd(lockWidth)} -> ${l.user}`);
            });
        } else {
            info("None");
        }
    }));

// Command: gtp sync - sync local state with MongoDB. This will push your local locks and activity to MongoDB, and pull any remote locks and activity from MongoDB and merge with your local state. This allows teams to share locks and activity across different machines. If MongoDB URI is not set in config, show warning and skip syncing.
program
    .command("sync")
    .description("Sync with MongoDB")
    .action(safeAction(async () => {
        ensureGitRepo();
        const repo = getRepoName();

        info("Pulling remote state...");
        await pullState(repo);
        info("Pushing local state...");
        await pushState(repo);
        success("Sync complete");
    }));

// Command: gtp install - installs GitPilot hooks into the local git repository. This will create pre-commit and pre-push hooks that run GitPilot checks before allowing commits and pushes. The pre-commit hook will check for active locks on modified files and block the commit if there are conflicts. The pre-push hook can be used to enforce syncing with MongoDB before pushing, to ensure that your locks and activity are up to date with the remote state. If not run inside a git repository, show error.
program
    .command("install")
    .description("Install GitPilot hooks")
    .action(safeAction(async () => {
        ensureGitRepo();
        installGitPilotHooks();
    }));

program
    .command("uninstall")
    .description("Remove GitPilot hooks from the repository")
    .action(safeAction(async () => {
        ensureGitRepo();

        const hooksDir = path.join(process.cwd(), ".git", "hooks");

        if (!fs.existsSync(hooksDir)) {
            info("No pre-commit hook found");
            info("No pre-push hook found");
            return;
        }

        for (const hook of hookDefs) {
            const hookPath = path.join(hooksDir, hook.fileName);

            if (!fs.existsSync(hookPath)) {
                info(`No ${hook.fileName} hook found`);
                continue;
            }

            const content = fs.readFileSync(hookPath, "utf8");

            if (isGitPilotManagedHook(content)) {
                fs.unlinkSync(hookPath);
                success(`Removed ${hook.fileName} hook`);
                continue;
            }

            info(`Skipped ${hook.fileName} (not managed by GitPilot)`);
        }
    }));

program
    .command("doctor")
    .description("Check GitPilot setup")
    .action(safeAction(async () => {
        header("GitPilot Doctor");

        const gitPath = path.join(process.cwd(), ".git");
        if (!fs.existsSync(gitPath)) {
            error("Not a git repository");
            return;
        }

        success("Git repository detected");

        const config = await loadConfig();
        if (!config.user) {
            warning("User not configured");
        } else {
            success(`User: ${config.user}`);
        }

        if (config.mongoUri) {
            success("Mongo configured");
        } else {
            info("Mongo not configured");
        }

        const hooksDir = path.join(process.cwd(), ".git", "hooks");

        for (const hook of hookDefs) {
            const hookPath = path.join(hooksDir, hook.fileName);

            if (!fs.existsSync(hookPath)) {
                warning(`${hook.fileName} hook missing`);
                continue;
            }

            const content = fs.readFileSync(hookPath, "utf8");
            if (content.includes(gitPilotHookMarker)) {
                success(`${hook.fileName} hook installed`);
            } else {
                warning(`${hook.fileName} exists but not managed by GitPilot`);
            }
        }
    }));

// Internal Command: hook-precommit - this is the script that runs in the pre-commit hook. It checks for active locks on modified files and blocks the commit if there are conflicts. This command is not meant to be run directly by users, but is called by the pre-commit hook script.
program
    .command("hook-precommit")
    .description("Internal pre-commit hook")
    .action(async () => {
        try {
            ensureGitRepo();

            const repo = getRepoName();

            await pullState(repo);

            const user = await requireUserConfig();
            if (!user) {
                process.exit(1);
            }

            const state = normalizeState(await loadState());
            const changedFiles = (await getChangedFiles()).map((file) => normalizeRepoPath(file));

            const blocked: string[] = [];

            for (const file of changedFiles) {
                const lock = state.locks.find((l: any) => l.file === file);

                if (lock && lock.user !== user) {
                    blocked.push(`${file} (locked by ${lock.user})`);
                }
            }

            if (blocked.length > 0) {
                error("Commit blocked due to active locks");
                list(blocked);
                process.exit(1);
            }

            success("Pre-commit checks passed");
            process.exit(0);
        } catch (err) {
            error(formatErrorMessage(err));
            process.exit(1);
        }
    });

// Internal Command: hook-prepush - this is the script that runs in the pre-push hook. It checks if the local branch is behind the remote branch, and blocks the push if it is, to encourage users to pull the latest changes before pushing. This helps reduce conflicts and ensures that users are aware of any new locks or activity before pushing their changes. This command is not meant to be run directly by users, but is called by the pre-push hook script.
program
    .command("hook-prepush")
    .description("Internal pre-push hook")
    .action(async () => {
        try {
            ensureGitRepo();

            const repo = getRepoName();

            await pullState(repo);
            await pushState(repo);

            const behind = await isBehindRemote();

            if (behind > 0) {
                error(`Your branch is behind by ${behind} commits`);
                info("Run: git pull --rebase");
                process.exit(1);
            }

            success("Pre-push checks passed");
            process.exit(0);
        } catch (err) {
            error(formatErrorMessage(err));
            process.exit(1);
        }
    });


const rawArgs = process.argv;


const potentialCommandString = rawArgs[2] ?? "";

if (rawArgs.length === 3 && potentialCommandString.includes(' ')) {
    const parts = potentialCommandString.split(' ');
    const commandPart = parts[0] ?? "";
    const filePart = parts.slice(1).join(' ');


    const scriptPath = rawArgs[1] ?? "";
    const nodePath = rawArgs[0] ?? "";

    program.parse([nodePath, scriptPath, commandPart, filePart]);
} else {
    program.parse(rawArgs);
}