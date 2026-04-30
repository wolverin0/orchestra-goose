#!/usr/bin/env python
"""
refresh-tom-briefing.py — pre-compute the look-ahead briefing and write it
to the file goose's `tom` (Top Of Mind) extension reads on every turn.

Architectural pivot from MIGRATION_MAPPING.md "CRITICAL latency finding":
the recipe-as-pre-prompt-hook approach hit 47-57s per invoke. The `tom`
extension reads `GOOSE_MOIM_MESSAGE_FILE` (or `GOOSE_MOIM_MESSAGE_TEXT`)
each turn at near-zero cost — so we move briefing computation OUT of the
agent loop and INTO a scheduled job that updates the file.

Flow:
    1. This script runs on a schedule (Windows Task Scheduler / cron / goose schedule)
       every 30-60 seconds while goosed is up.
    2. It reads <project>/vault/active_tasks.md (or active_tasks.md at root).
    3. Calls memorymaster.context_hook.query_for_task() directly — same code
       path as the existing CC L1 hook (mm-2883). Sub-second when MM warm.
    4. Writes the briefing XML to the goose tom-message file:
           Windows: %USERPROFILE%\\.orchestra-goose\\tom-message.txt
           POSIX: ~/.orchestra-goose/tom-message.txt
    5. Goose's tom extension picks it up on the NEXT user prompt — zero
       per-turn LLM/recipe overhead.

Idempotent: if active_tasks.md hasn't changed AND the briefing file
mtime is < 60s old, skip the recompute. Saves ~80% of MM queries.

Per-project mode: when run with --project <path>, scopes to that project.
Without --project: cycles through known orchestrated projects (read from
~/.orchestra-goose/orchestrated-projects.txt if present).

Usage:
    python refresh-tom-briefing.py --project G:/_OneDrive/.../wezbridge
    python refresh-tom-briefing.py --all  # all orchestrated projects
"""

from __future__ import annotations
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

PROJECT_ROOT = r"G:\_OneDrive\OneDrive\Desktop\Py Apps\memorymaster"
DB_PATH = os.path.join(PROJECT_ROOT, "memorymaster.db")

# Make memorymaster importable
sys.path.insert(0, PROJECT_ROOT)
os.environ["MEMORYMASTER_DEFAULT_DB"] = DB_PATH
os.chdir(PROJECT_ROOT)

# Briefing target file — read by goose tom extension on every turn
HOME = Path(os.environ.get("USERPROFILE") or os.environ.get("HOME") or ".")
TOM_DIR = HOME / ".orchestra-goose"
TOM_DIR.mkdir(parents=True, exist_ok=True)
TOM_FILE = TOM_DIR / "tom-message.txt"

# State file: tracks which active_tasks.md mtime + scope last produced this briefing,
# so we skip recompute when nothing changed.
STATE_FILE = TOM_DIR / "tom-briefing-state.json"

_HEADER_RE = re.compile(r"^##\s+(?:Task:\s+)?(.+?)\s*$", re.MULTILINE)


def find_active_tasks_md(project_root: Path) -> Path | None:
    for rel in ("vault/active_tasks.md", "active_tasks.md"):
        p = project_root / rel
        if p.is_file():
            return p
    return None


def parse_active_task(active_path: Path) -> tuple[str, str] | None:
    text = active_path.read_text(encoding="utf-8")
    sections: list[tuple[str, str]] = []
    last_pos = 0
    last_title = None
    for m in _HEADER_RE.finditer(text):
        if last_title is not None:
            sections.append((last_title, text[last_pos:m.start()]))
        last_title = m.group(1).strip()
        last_pos = m.end()
    if last_title is not None:
        sections.append((last_title, text[last_pos:]))

    in_progress = None
    pending = None
    for title, body in sections:
        ym = re.search(r"```yaml\s*\n(.*?)\n```", body, re.DOTALL)
        if not ym:
            continue
        sm = re.search(r"^status:\s*([a-zA-Z_]+)", ym.group(1), re.MULTILINE)
        if not sm:
            continue
        status = sm.group(1).lower()
        if status == "in_progress" and in_progress is None:
            in_progress = (title, body)
        elif status == "pending" and pending is None:
            pending = (title, body)

    chosen = in_progress or pending
    if not chosen:
        return None
    title, body = chosen
    narrative = re.sub(r"```yaml\s*\n.*?\n```", "", body, flags=re.DOTALL).strip()
    return title, narrative


def project_scope(project_root: Path) -> str:
    return f"project:{project_root.name}"


def load_state() -> dict:
    if STATE_FILE.is_file():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def refresh_for_project(project_root: Path, force: bool = False) -> dict:
    if not project_root.is_dir():
        return {"ok": False, "reason": f"project not found: {project_root}"}

    monitoring = project_root / "monitoring.md"
    if not monitoring.is_file():
        # Also check .goose/project.toml as the new orchestra convention
        goose_toml = project_root / ".goose" / "project.toml"
        if not goose_toml.is_file():
            return {"ok": False, "reason": "no monitoring.md or .goose/project.toml — project not orchestrated"}

    active_md = find_active_tasks_md(project_root)
    if active_md is None:
        return {"ok": False, "reason": "no active_tasks.md"}

    # Idempotency check
    state_key = str(project_root.resolve())
    state = load_state()
    proj_state = state.get(state_key, {})
    mtime = active_md.stat().st_mtime
    if not force and proj_state.get("active_mtime") == mtime and (time.time() - proj_state.get("written_at", 0)) < 60:
        return {"ok": True, "skipped": "unchanged within 60s", "tom_file": str(TOM_FILE)}

    parsed = parse_active_task(active_md)
    if parsed is None:
        return {"ok": False, "reason": "no in_progress or pending task"}
    title, narrative = parsed
    query = title if not narrative else f"{title}. {narrative[:400]}"
    scope = project_scope(project_root)

    t0 = time.perf_counter()
    from memorymaster.context_hook import query_for_task
    briefing = query_for_task(query, scope, db_path=DB_PATH, skip_qdrant=True) or ""
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    # Write briefing for tom — keep it under 2KB
    if len(briefing) > 2048:
        briefing = briefing[:2040] + "...\n"

    payload = (
        f"# Look-ahead briefing — {scope}\n"
        f"# Refreshed {time.strftime('%Y-%m-%d %H:%M:%S')} via refresh-tom-briefing.py\n"
        f"# Active task: {title}\n"
        f"\n"
        f"{briefing}"
    )
    TOM_FILE.write_text(payload, encoding="utf-8")

    state[state_key] = {
        "active_mtime": mtime,
        "written_at": time.time(),
        "scope": scope,
        "title": title[:120],
        "briefing_chars": len(briefing),
        "elapsed_ms": elapsed_ms,
    }
    save_state(state)

    return {
        "ok": True,
        "tom_file": str(TOM_FILE),
        "scope": scope,
        "title": title[:120],
        "briefing_chars": len(briefing),
        "elapsed_ms": elapsed_ms,
    }


def main():
    ap = argparse.ArgumentParser(description="Pre-compute the goose tom briefing.")
    ap.add_argument("--project", help="Path to a single project root.")
    ap.add_argument("--all", action="store_true", help="Cycle all orchestrated projects.")
    ap.add_argument("--force", action="store_true", help="Recompute even if unchanged.")
    args = ap.parse_args()

    if args.project:
        result = refresh_for_project(Path(args.project), force=args.force)
        print(json.dumps(result, indent=2, default=str))
        sys.exit(0 if result["ok"] else 1)

    if args.all:
        list_file = TOM_DIR / "orchestrated-projects.txt"
        if not list_file.is_file():
            print(json.dumps({"ok": False, "reason": f"no {list_file}"}, indent=2))
            sys.exit(1)
        results = {}
        for line in list_file.read_text(encoding="utf-8").splitlines():
            p = line.strip()
            if not p or p.startswith("#"):
                continue
            results[p] = refresh_for_project(Path(p), force=args.force)
        print(json.dumps(results, indent=2, default=str))
        sys.exit(0)

    ap.error("must pass --project <path> or --all")


if __name__ == "__main__":
    main()
