import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { error } from "./ui.js";

const git = simpleGit();

export const ensureGitRepo = () => {
    const gitPath = path.join(process.cwd(), ".git");

    if (!fs.existsSync(gitPath)) {
        error("Not a git repository");
        process.exit(1);
    }
}

export const isBehindRemote = async () => {
    try {
        await git.fetch();

        const status = await git.status();

        return status.behind;
    } catch (err) {
        return 0;
    }
}

export const getChangedFiles = async () => {
    const status = await git.status();

    return [
        ...status.modified,
        ...status.created,
        ...status.not_added,
    ];

}

export const getDiffStats = async () => {
    const result = await git.diff(["--numstat"]);

   const lines = result.split("\n").filter(Boolean);

    return lines.map((line) => {
        const [added, removed, file] = line.split("\t");

        return {
            file,
            added: Number(added),
            removed: Number(removed),
        };
    });
}