"""Differensial sinov (2/2): Python port natijalarini JS etaloni bilan bit-bit solishtiradi.
Ishga tushirish: PARITY_DIR=<papka> python compare.py <base_seed> <seed...>
"""
import json, sys, math
import os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
from app.engine.loaddata import build_context
from app.engine.greedy import greedy_construct
from app.engine.solve import solve_context

D = os.environ.get("PARITY_DIR", HERE)  # gen.mjs chiqargan papka

def mulberry32(seed):
    a = [seed & 0xFFFFFFFF]
    M = 0xFFFFFFFF
    def imul(x, y):
        return (x * y) & M
    def rnd():
        a[0] = (a[0] + 0x6D2B79F5) & M
        t = a[0]
        t = imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + imul(t ^ (t >> 7), t | 61)) & M)) & M
        return ((t ^ (t >> 14)) & M) / 4294967296
    return rnd

def norm(x):
    if isinstance(x, dict):
        return {str(k): norm(v) for k, v in x.items() if v is not None}
    if isinstance(x, (list, tuple)):
        return [norm(v) for v in x]
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x

def evsum(ctx):
    out = []
    for e in ctx.events:
        out.append(norm({"id": e.id, "workloadId": e.workloadId, "groupIds": e.groupIds, "teacherId": e.teacherId,
            "subjectId": e.subjectId, "type": e.type, "part": e.part, "slots": e.slots, "rooms": e.rooms,
            "roomCapacities": e.roomCapacities, "reason": e.reason, "blockKind": e.blockKind,
            "suggestions": e.suggestions, "slot": e.slot, "room": e.room, "groupSize": e.groupSize,
            "facultyIds": e.facultyIds, "assignedRooms": e.assignedRooms}))
    return out

def build(inst, seed_semester=1):
    gs = {int(k): v for k, v in inst["starts"].items()}
    ge = {int(k): v for k, v in inst["ends"].items()}
    return build_context(inst["workloads"], inst["rooms"], inst["constraints"], 1, gs, ge)

def compare(name, a, b, errs):
    if norm(a) != norm(b):
        errs.append(name)

BASE = int(sys.argv[1])
seeds = [int(x) for x in sys.argv[2:]]
total_bad = 0
for seed in seeds:
    inst = json.load(open(f"{D}/inst_{seed}.json", encoding="utf-8"))
    exp = [r for r in json.load(open(f"{D}/expected_{BASE}.json", encoding="utf-8")) if r["seed"] == seed][0]
    errs = []
    ctx0 = build(inst)
    s0 = evsum(ctx0)
    if s0 != exp["build"]["events"]:
        for i, (x, y) in enumerate(zip(s0, exp["build"]["events"])):
            if norm(x) != norm(y):
                errs.append(f"build event {i}: py={norm(x)} js={norm(y)}"); break
        if len(s0) != len(exp["build"]["events"]): errs.append("build event count")
    if [e.id for e in ctx0.infeasible] != exp["build"]["infeasible"]:
        errs.append("infeasible list")
    greedy_construct(ctx0)
    gslots = [[e.slot, e.room] for e in ctx0.events]
    if gslots != exp["greedySlots"]:
        errs.append(f"greedy slots differ")
    ctx = build(inst)
    res = solve_context(ctx, max_ms=1e8, rand=mulberry32(seed + 1000))
    if norm(res["entries"]) != norm(exp["entries"]):
        errs.append(f"entries differ: py={len(res['entries'])} js={len(exp['entries'])}")
    rep = dict(res["report"]); 
    if norm(rep) != norm(exp["report"]):
        errs.append(f"report differ: py={norm(rep)} js={norm(exp['report'])}")
    if norm(res["diagnostics"]) != norm(exp["diagnostics"]):
        errs.append("diagnostics differ")
    if norm(res["greedy"]) != norm(exp["greedy"]):
        errs.append("greedy stats differ")
    ai = exp["annealIters"]
    st = res["anneal"]
    if ai and (st["iterations"] != ai["first"] or st["accepted"] != ai["first_acc"]
               or [[s["iterations"], s["accepted"]] for s in st["strict"]] != ai["strict"]):
        errs.append(f"anneal counts differ: py={st['iterations']},{st['accepted']} js={ai['first']},{ai['first_acc']}")
    status = "OK" if not errs else "DIFF"
    total_bad += bool(errs)
    print(seed, status, len(ctx.events), (errs[:3] if errs else ""))
print("instances with diffs:", total_bad)
