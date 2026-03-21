import fs from 'fs-extra';
import path from 'path';



const stateDir = path.join(process.cwd(), '.git', 'gitpilot');
const stateFile = path.join(stateDir, 'state.json');

export const loadState = async () => {
    await fs.ensureDir(stateDir);

    if (!(await fs.pathExists(stateFile))) {
        const initial = { locks: [], activity: [] };
        await fs.writeJSON(stateFile, initial, { spaces: 2 });
        return initial;
    }

    return fs.readJSON(stateFile);
}

export const saveState = async (state: any) => {
    await fs.ensureDir(stateDir);
    await fs.writeJSON(stateFile, state, { spaces: 2 });
}