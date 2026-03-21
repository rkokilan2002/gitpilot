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
npm install -g git-pilot
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

## Usage

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

- VS Code extension
- Web dashboard
- Conflict prediction

## License

MIT
