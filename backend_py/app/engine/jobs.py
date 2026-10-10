"""Jadval generatsiyasini fon thread'da bajaradi (worker.js + jobRunner.js porti)."""
import json
import threading

from sqlalchemy import insert

from ..db import SessionLocal
from ..models import ScheduleEntry, SchedulingRun
from .loaddata import load_data_db
from .solve import solve_context


def solve_db(db, semester=1, max_ms=5000, group_start_pairs=None, group_end_pairs=None, rand=None):
    ctx = load_data_db(db, semester, group_start_pairs, group_end_pairs)
    return solve_context(ctx, max_ms=max_ms, rand=rand)


def run_generation(run_id, semester, max_ms, group_start_pairs, group_end_pairs):
    db = SessionLocal()
    try:
        result = solve_db(db, semester, max_ms, group_start_pairs, group_end_pairs)
        if result["entries"]:
            db.execute(insert(ScheduleEntry), [dict(e, runId=run_id) for e in result["entries"]])
        report = result["report"]
        report_json = json.dumps({
            "unplaced": report["unplaced"],
            "breakdown": report["breakdown"],
            "infeasibleEvents": report["infeasibleEvents"],
            "diagnostics": result["diagnostics"],
        }, ensure_ascii=False, separators=(",", ":"))
        run = db.get(SchedulingRun, run_id)
        run.status = "done" if report["feasible"] else "failed"
        run.hardScore = report["hard"]
        run.softScore = report["soft"]
        run.report = report_json
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run = db.get(SchedulingRun, run_id)
        if run is not None:
            run.status = "failed"
            run.report = json.dumps({"error": str(exc)}, ensure_ascii=False)
            db.commit()
        print(f"[job:error] run #{run_id}: {exc}")
    finally:
        db.close()


def start_generate_job(run_id, semester, max_ms, group_start_pairs=None, group_end_pairs=None):
    thread = threading.Thread(
        target=run_generation,
        args=(run_id, semester, max_ms, group_start_pairs or {}, group_end_pairs or {}),
        daemon=True,
    )
    thread.start()
