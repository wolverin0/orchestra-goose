#!/usr/bin/env python3
"""
Pre-compute look-ahead briefing for a project and write it to a file
that the goose `tom` (Top Of Mind) extension reads via
GOOSE_MOIM_MESSAGE_FILE env var.

Architectural fix for the 47-57s latency problem in lookahead-brief
recipe (mm-3457 plus benchmark commit 0bb1e404). Run this on a
schedule (cron / Windows Task Scheduler / a goose schedule recipe);
goose's tom extension picks up the file content per-turn at zero cost.

Usage:
    python precompute-briefing.py <project_root>

Output:
    <project_root>/.goose/briefing.txt   — the briefing block
    <project_root>/.goose/briefing.json  — metadata (timestamp, scope, source)

Tom extension config in user's goose config.yaml:
    tom:
      enabled: true
      type: platform
      ...
And shell env:
    GOOSE_MOIM_MESSAGE_FILE=<project_root>/.goose/briefing.txt

Run cadence:
    - On every project-toml change → re-precompute (filewatch)
    - Every 5 min during active work → refresh
    - On commit (post-commit hook) → invalidate + recompute
"""

import json
import os
import re
import sys
import time
from pathlib import Path

MM_PATH = r"G:\_OneDrive\OneDrive\Desktop\Py Apps\memorymaster"
sys.path.insert(0, MM_PATH)
os.environ.setdefault("MEMORYMASTER_DEFAULT_DB", os.path.join(MM_PATH, "memorymaster.db"))


def find_active_task(project_root: Path) -> dict | None:
    candidates = [
        project_root / "vault" / "active_tasks.md",
        project_root / "active_tasks.md",
    ]
    source = next((c for c in candidates if c.is_file()), None)
    if source is None:
        return None
    text = source.read_text(encoding="utf-8")
    header_re = re.compile(r"^##\s+(?:Task:\s+)?(.+?)\s*$", re.MULTILINE)
    positions = [(m.start(), m.end(), m.group(1).strip()) for m in header_re.finditer(text)]
    for i, (start, end, title) in enumerate(positions):
        body = text[end : positions[i + 1][0] if i + 1 < len(positions) else len(text)]
        ym = re.search(r"```yaml\s*\n(.*?)\n```", body, re.DOTALL)
        status = "unknown"
        if ym:
            sm = re.search(r"^status:\s*(\w+)", ym.group(1), re.MULTILINE)
            if sm:
                status = sm.group(1).strip().lower()
        if status == "in_progress":
            narrative = re.sub(r"```yaml\s*\n.*?\n```", "", body, flags=re.DOTALL).strip()
            return {"title": title, "status": status, "narrative": narrative[:400], "source": str(source)}
    # fall back to first pending
    for i, (start, end, title) in enumerate(positions):
        body = text[end : positions[i + 1][0] if i + 1 < len(positions) else len(text)]
        ym = re.search(r"```yaml\s*\n(.*?)\n```", body, re.DOTALL)
        if ym and re.search(r"^status:\s*pending", ym.group(1), re.MULTILINE):
            narrative = re.sub(r"```yaml\s*\n.*?\n```", "", body, flags=re.DOTALL).strip()
            return {"title": title, "status": "pending", "narrative": narrative[:400], "source": str(source)}
    return None


def precompute(project_root: Path) -> dict:
    project_root = project_root.resolve()
    out_dir = project_root / ".goose"
    out_dir.mkdir(exist_ok=True)
    briefing_txt = out_dir / "briefing.txt"
    briefing_json = out_dir / "briefing.json"

    # Gate 1: monitoring.md presence
    if not (project_root / "monitoring.md").is_file():
        briefing_txt.write_text("", encoding="utf-8")
        briefing_json.write_text(json.dumps({"empty": True, "reason": "no monitoring.md"}), encoding="utf-8")
        return {"status": "skipped", "reason": "no monitoring.md"}

    # Gate 2: active task
    task = find_active_task(project_root)
    if not task:
        briefing_txt.write_text("", encoding="utf-8")
        briefing_json.write_text(json.dumps({"empty": True, "reason": "no active task"}), encoding="utf-8")
        return {"status": "skipped", "reason": "no active task"}

    # Compose briefing via direct MM Python import (no MCP overhead)
    scope = f"project:{project_root.name}"
    try:
        from memorymaster.context_hook import query_for_task
        t0 = time.perf_counter()
        briefing = query_for_task(
            f"{task['title']}. {task['narrative'][:200]}",
            scope,
            db_path=os.environ["MEMORYMASTER_DEFAULT_DB"],
            token_budget=600,
            skip_qdrant=True,
        )
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
    except Exception as exc:
        briefing = f"[briefer error: {exc}]"
        elapsed_ms = -1

    if not briefing.strip():
        briefing = (
            f"<task_briefing project=\"{scope}\">\n"
            f"  <task>{task['title']}</task>\n"
            f"  <relevant_memory>(no relevant claims for this scope yet)</relevant_memory>\n"
            f"</task_briefing>"
        )

    briefing_txt.write_text(briefing, encoding="utf-8")
    metadata = {
        "computed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scope": scope,
        "task_title": task["title"],
        "task_status": task["status"],
        "elapsed_ms": elapsed_ms,
        "briefing_chars": len(briefing),
        "source_active_tasks": task["source"],
    }
    briefing_json.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return {"status": "ok", **metadata}


def main():
    if len(sys.argv) < 2:
        print("usage: precompute-briefing.py <project_root>", file=sys.stderr)
        sys.exit(2)
    project = Path(sys.argv[1])
    if not project.is_dir():
        print(f"error: not a directory: {project}", file=sys.stderr)
        sys.exit(2)
    result = precompute(project)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
