---
name: jakeloud
description: Manage a self-hosted JakeLoud service. Use when the user asks to list JakeLoud projects, inspect project deployment status or logs, or fully reboot/redeploy a JakeLoud project.
license: MIT
compatibility: Requires Bash, curl, and jq.
metadata:
  author: jakeloud
  repository: https://github.com/jakeloud/skill
---

# JakeLoud

Use the bundled client to operate the user's configured JakeLoud service. Resolve `scripts/jakeloud.sh` relative to this `SKILL.md` file and invoke it with Bash.

## Setup

If the client reports that configuration is missing, ask the user to run this command in their own terminal:

```bash
bash <skill-directory>/scripts/jakeloud.sh configure
```

The command prompts for the self-hosted service URL, email, and password. Never ask the user to paste their JakeLoud password into chat. Never read, print, summarize, or modify the credential file directly. Let the client load it.

HTTP is rejected except for localhost. For a trusted private deployment that cannot use HTTPS, the user can explicitly run `configure --allow-http`.

## Operations

List projects:

```bash
bash <skill-directory>/scripts/jakeloud.sh projects --json
```

Get status and recent logs:

```bash
bash <skill-directory>/scripts/jakeloud.sh status <project> --json
```

The JSON response includes `state`, `additional.currentRelease`, `additional.runtime`, `additional.ps`, and `additional.logs` when available. Summarize relevant fields rather than dumping long logs unless the user requests full output.

Full reboot/redeploy:

1. Run `status` first and verify the project exists.
2. Explain that a full reboot clones the configured repository, builds a new release, and replaces the running release after liveness succeeds.
3. Obtain explicit user confirmation immediately before running the reboot.
4. Then run:

```bash
bash <skill-directory>/scripts/jakeloud.sh reboot <project> --yes
```

Never add `--yes` without explicit confirmation. The reboot preserves the project's existing repository, domain, and build/start command.

## Errors

- If authentication fails, tell the user to rerun `configure`; do not inspect the credential file.
- If JakeLoud says registration is required, direct the user to finish initial registration in the web UI.
- Report connection and API failures exactly enough to identify the service, but never include request bodies or credentials.
