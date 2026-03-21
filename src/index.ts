#!/usr/bin/env node

import { Command } from 'commander';
import simpleGit from "simple-git";
import fs from "fs";
import path from "path";
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
            if (existing.user === user) {
                warning(`Already locked: ${targetFile} (you)`);
            } else {
                warning(`Already locked by ${existing.user}: ${targetFile}`);
            }
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
                console.log(`${l.file.padEnd(lockWidth)} -> ${l.user}`);
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
                    console.log(`${a.file.padEnd(activityWidth)} -> ${a.user} (+${a.added} / -${a.removed})`);
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
            changedFiles.forEach(file => {
                const lock = state.locks.find((l: any) => l.file === file);
                if (lock) {
                    const status = lock.user === config.user ? "[Locked by You]" : `[LOCKED BY ${lock.user}]`;
                    console.log(`${file} ${status}`);
                } else {
                    console.log(`${file} [UNLOCKED]`);
                }
            });
        }

        const otherLocks = state.locks.filter((l: any) => !changedFiles.includes(l.file));
        section("Other Active Locks");
        if (otherLocks.length > 0) {
            otherLocks.forEach((l: any) => {
                console.log(`${l.file} -> ${l.user}`);
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

        const hooksDir = path.join(process.cwd(), ".git", "hooks");


        const preCommitPath = path.join(hooksDir, "pre-commit");

        const preCommitScript = `#!/bin/sh
gitpilot hook-precommit
`;

        fs.writeFileSync(preCommitPath, preCommitScript);
        fs.chmodSync(preCommitPath, 0o755);

        const prePushPath = path.join(hooksDir, "pre-push");

        const prePushScript = `#!/bin/sh
gitpilot hook-prepush
`;

        fs.writeFileSync(prePushPath, prePushScript);
        fs.chmodSync(prePushPath, 0o755);

        success("Hooks installed");
    }));

// Internal Command: hook-precommit - this is the script that runs in the pre-commit hook. It checks for active locks on modified files and blocks the commit if there are conflicts. This command is not meant to be run directly by users, but is called by the pre-commit hook script.
program
    .command("hook-precommit")
    .description("Internal pre-commit hook")
    .action(safeAction(async () => {
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
    }, { exitOnError: true }));

// Internal Command: hook-prepush - this is the script that runs in the pre-push hook. It checks if the local branch is behind the remote branch, and blocks the push if it is, to encourage users to pull the latest changes before pushing. This helps reduce conflicts and ensures that users are aware of any new locks or activity before pushing their changes. This command is not meant to be run directly by users, but is called by the pre-push hook script.
program
    .command("hook-prepush")
    .description("Internal pre-push hook")
    .action(safeAction(async () => {
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
    }, { exitOnError: true }));


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