"""Tez sinov CLI (server/src/engine/cli.js porti): HTTP'siz jadval generatsiyasi.

  python -m app.engine.cli [semester] [maxMs]
"""
import json
import sys

from sqlalchemy import insert

from ..db import SessionLocal
from ..models import ScheduleEntry, SchedulingRun
from .jobs import solve_db
from .timeslots import DAY_NAMES, PAIRS, day_of, pair_of


def _print_group(ctx, gid):
    evs = ctx.by_group.get(gid, [])
    if not evs:
        return
    print(f"\n  Guruh: {', '.join(evs[0].groupNames)}")
    grid = [[None] * 5 for _ in range(PAIRS)]
    for e in evs:
        if e.slot >= 0:
            grid[pair_of(e.slot) - 1][day_of(e.slot)] = (e.subjectName or "")[:12]
    print("  " + "".join(d[:4].ljust(16) for d in ["Para"] + DAY_NAMES))
    for i, row in enumerate(grid):
        cells = [c if c else "·" for c in row]
        print("  " + "".join(str(x).ljust(16) for x in [str(i + 1)] + cells))


def main():
    semester = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    max_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    db = SessionLocal()
    try:
        result = solve_db(db, semester=semester, max_ms=max_ms)
        report = result["report"]
        print("═══════════════════ JADVAL NATIJASI ═══════════════════")
        print(f"Eventlar (darslar):  {result.get('events', 0)}")
        if result.get("greedy"):
            print(f"Greedy:              hard={result['greedy']['hard']}  soft={result['greedy']['soft']}")
        print(f"Annealing:           hard={report['hard']}  soft={report['soft']}")
        print(f"  qattiq taqsim:     {report['breakdown']}")
        print(f"FEASIBLE:            {'HA' if report['feasible'] else 'YOQ'}")
        if report["infeasibleEvents"]:
            print(f"⚠️  mos xonasiz:      {len(report['infeasibleEvents'])} ta")
        if not result.get("empty"):
            for gid in list(result["ctx"].by_group.keys())[:2]:
                _print_group(result["ctx"], gid)

        run = SchedulingRun(
            semester=semester, status="done" if report["feasible"] else "failed",
            hardScore=report["hard"], softScore=report["soft"],
            report=json.dumps({"breakdown": report["breakdown"], "infeasibleEvents": report["infeasibleEvents"],
                               "diagnostics": result["diagnostics"]}, ensure_ascii=False),
        )
        db.add(run)
        db.flush()
        if result["entries"]:
            db.execute(insert(ScheduleEntry), [dict(e, runId=run.id) for e in result["entries"]])
        db.commit()
        print(f"\n💾 Saqlandi: SchedulingRun #{run.id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
