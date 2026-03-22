# GitPilot

GitPilot is a local-first Git collaboration assistant for teams.
It helps prevent merge conflicts before they happen, tracks file ownership, blocks unsafe actions, and improves visibility into team activity.

GitPilot runs in two modes:
- Local only (no server required)
- Optional MongoDB sync for team collaboration

GitPilot CLI commands:
- `gitpilot`
- `gtp` (alias)

## Project Overview

GitPilot adds a lightweight coordination layer on top of Git.
It is designed for fast, daily use in real repositories.

With GitPilot, teams can:
- Prevent merge conflicts early
- Track who is working on which files
- Block unsafe commits and pushes
- See recent file-level activity

## Core Features

### 1) File Locking

- Lock files before editing to signal ownership
- Only the lock owner can unlock
- Reduce accidental overlap on critical files

### 2) Safe Add

GitPilot blocks staging when:
- Your branch is behind remote
- A changed file is locked by another user

### 3) Activity Tracking

- Records added and removed lines per file
- Shows recent collaboration history
- Maintains practical history limits for speed

### 4) Status Command

The status view shows:
- Modified files
- Lock status per modified file
- Other active locks in the repository

### 5) Who Command

The who view shows:
- Active locks
- Recent activity

### 6) Git Hooks

- Pre-commit blocks commits when locked files are modified by non-owners
- Pre-push blocks push when branch is behind remote
- Pre-push also runs state sync

### 7) Auto Sync (Hybrid)

- Local-first by default
- Optional MongoDB sync
- Sync happens during command execution (no daemon)
- Sync runs automatically before commit and before push, and on relevant read and lock operations

## Installation

Install globally:

~~~bash
npm install -g @rkokilan2002/git-pilot
~~~

## Setup

Initialize GitPilot in your repository:

~~~bash
gtp init
~~~

This will:
- verify you are in a Git repository
- set your user name (interactive)
- optionally configure MongoDB
- install Git hooks

### Setup with defaults (non-interactive):

~~~bash
gtp init --yes
~~~

This skips prompts and uses defaults where possible.

## Usage

Lock a file:

~~~bash
gtp lock <file>
~~~

Unlock a file:

~~~bash
gtp unlock <file>
~~~

View team activity and locks:

~~~bash
gtp who
~~~

Repository status:

~~~bash
gtp status
~~~

Safe add (with lock and remote checks):

~~~bash
gtp add <path>
~~~

Manual sync with MongoDB:

~~~bash
gtp sync
~~~

Doctor (check GitPilot setup):

~~~bash
gtp doctor
~~~

## Configuration

View current configuration:

~~~bash
gtp config list
~~~

Set your user name:

~~~bash
gtp config set-user <name>
~~~

Remove user configuration:

~~~bash
gtp config unset-user
~~~

Set MongoDB for team sync:

~~~bash
gtp config set-mongo <uri>
~~~

Remove MongoDB configuration:

~~~bash
gtp config unset-mongo
~~~

Reset all configuration:

~~~bash
gtp config reset
~~~

### MongoDB Setup

For team sync, set up MongoDB Atlas:

1. Create a MongoDB cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a database user and copy the connection URI
3. Whitelist your IP in Network Access
4. Share the URI securely (not in Git or public channels)
5. Configure on each machine:

~~~bash
gtp config set-mongo <mongo-uri>
~~~

After setup, locks and activity are shared across team members.

## Hooks

Install hooks in the repository:

~~~bash
gtp install
~~~

Remove GitPilot hooks:

~~~bash
gtp uninstall
~~~

(Only removes GitPilot-managed hooks, preserves others)

## Advanced

### State Storage

Local state is stored in:

~~~text
.git/gitpilot/state.json
~~~

User configuration is stored in:

~~~text
~/.gitpilot/config.json
~~~

### Emergency (Bypass hooks)

In critical situations, bypass hooks temporarily:

~~~bash
git commit --no-verify
git push --no-verify
~~~

**Warning:** Using `--no-verify` may cause merge conflicts or overwrite another developer's work.

### Example Output

Status view:

~~~text
[OK] GitPilot Repository Status

Modified Files
  src/auth.ts         -> locked by kokilan
  src/utils.ts        -> unlocked

Other Active Locks
  src/config.ts       -> alex
~~~

Who view:

~~~text
[OK] GitPilot Status

Active Locks
  src/auth.ts         -> kokilan

Recent Activity
  src/auth.ts         -> kokilan (+20 / -5)
  src/utils.ts        -> alex (+10 / -2)
~~~

### Design Principles

- Local-first
- No background processes
- Fast CLI execution
- Fail-safe offline behavior
- Minimal friction for daily Git workflows

### How It Works

GitPilot maintains state separately from Git. Each repository is identified by its Git remote URL, ensuring that all team members working on the same repository share the same locks and activity data, regardless of their local folder names.

When MongoDB is configured, state is synced automatically during relevant operations. Without MongoDB, GitPilot works entirely locally within `.git/gitpilot/`.

## Why GitPilot

Git is excellent at version control, but it does not coordinate active file ownership before conflicts happen.
GitPilot adds that coordination layer so teams can avoid overwriting each other and reduce review and merge friction.

## Roadmap

- Cloud version
- VS Code extension
- Web dashboard
- Conflict prediction

## License

MIT
