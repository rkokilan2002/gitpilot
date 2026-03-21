# GitPilot

GitPilot is a local-first Git collaboration assistant for teams.
It helps prevent merge conflicts before they happen, tracks file ownership, blocks unsafe actions, and improves visibility into team activity.

GitPilot runs in two modes:
- Local only (no server required)
- Optional MongoDB sync for team collaboration

GitPilot CLI commands:
- gitpilot
- gtp (alias)

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

~~~bash
npm install -g @rkokilan2002/git-pilot
~~~

## Setup

Set your user name:

~~~bash
gtp config set-user <your-name>
~~~

Optional MongoDB sync:

~~~bash
gtp config set-mongo <mongo-uri>
~~~

## Team Setup (Mongo Sync)

GitPilot supports optional team synchronization using MongoDB.
GitPilot works locally by default, and MongoDB is only needed for team collaboration.

Step 1 - Create a MongoDB database

Use MongoDB Atlas for setup.
Create a cluster and copy the connection URI.

Step 2 - Share the URI securely

Do not commit the Mongo URI into the repository.
Share it only through secure channels, not public messages or public files.

Step 3 - Configure GitPilot on each machine

~~~bash
gtp config set-mongo <mongo-uri>
~~~

After setup, locks are shared across team members and activity is synced across machines.
Commands like `gtp who` show team-wide data.

Security note:
Do not expose credentials.
Treat the Mongo URI as a secret.

## Installing Hooks

~~~bash
gtp install
~~~

## Removing Hooks

~~~bash
gtp uninstall
~~~

Removes only GitPilot-managed hooks.

## Doctor

~~~bash
gtp doctor
~~~

Checks GitPilot setup including:
- git repository
- user config
- Mongo config
- hooks status

## Usage

Run commands with either:

~~~bash
gtp <command>
gitpilot <command>
~~~

Lock file:

~~~bash
gtp lock src/auth.ts
~~~

Unlock file:

~~~bash
gtp unlock src/auth.ts
~~~

See team activity:

~~~bash
gtp who
~~~

Safe add:

~~~bash
gtp add .
~~~

Repository status:

~~~bash
gtp status
~~~

Manual sync (optional):

~~~bash
gtp sync
~~~

Install hooks:

~~~bash
gtp install
~~~

Bypass hooks (emergency only):

~~~bash
git commit --no-verify
git push --no-verify
~~~

## Example Output

~~~text
=== GITPILOT STATUS ===

ACTIVE LOCKS

src/auth.ts    -> kokilan

RECENT ACTIVITY

src/auth.ts    -> kokilan (+20 / -5)
~~~

## How It Works

State storage:

~~~text
.git/gitpilot/state.json
~~~

Config storage:

~~~text
~/.gitpilot/config.json
~~~

Optional MongoDB sync shares lock and activity state across team members.

## Design Principles

- Local-first
- No background processes
- Fast CLI execution
- Fail-safe offline behavior
- Minimal friction for daily Git workflows

## Why GitPilot

Git is excellent at version control, but it does not coordinate active file ownership before conflicts happen.
GitPilot adds that coordination layer so teams can avoid overwriting each other and reduce review and merge friction.

## Roadmap

- Cloud version
- VS Code extension
- Web dashboard
- Conflict prediction

## Bypassing Hooks (Emergency Only)

GitPilot uses Git hooks to enforce safety checks during commit and push operations.
In critical situations, hooks can be bypassed temporarily, but this should be used only when necessary.

~~~bash
git commit --no-verify
git push --no-verify
~~~

These commands skip GitPilot checks.
Using them may cause merge conflicts or overwrite another developer's work.

## License

MIT
