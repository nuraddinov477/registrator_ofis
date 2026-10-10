"""AI yordamchi — server/src/routes/assistant.js porti (Claude asosiy, Gemini zaxira).

AI faqat tushuntiradi va tool orqali O'QIYDI / engine'ni ishga tushiradi. Xonalarni taqsimlash
deterministik engine'da — AI natija o'ylab topmaydi.
"""
import json
import os

import anthropic
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import restriction_blocks, scope_where
from ..auth import CurrentUser, current_user
from ..crud import client_ip, get_body
from ..db import audit, get_db
from ..engine.jobs import start_generate_job
from ..engine.timeslots import DAY_NAMES
from ..models import (Building, Department, Faculty, Group, Room, ScheduleEntry, SchedulingRun,
                      Specialty, Subject, Teacher, Workload, WorkloadGroup)

MODEL = "claude-opus-4-8"
GEMINI_MODEL = "gemini-flash-latest"
MAX_TOOL_TURNS = 8

SYSTEM_PROMPT = """Sen — SmartJadval tizimining AI yordamchisisan. SmartJadval — universitetlar uchun dars jadvali tuzish tizimi.

MODULLAR (chap menyu): Dashboard (statistika) · Tuzilma: Fakultetlar, Kafedralar, Mutaxassisliklar · Resurslar: O'qituvchilar, Fanlar bazasi, Akademik guruhlar, Bino va xonalar · Jarayon: O'quv yuklamasi, Talabnomalar, Dars jadvali · Boshqaruv: Foydalanuvchilar, Audit logi.

ROLLAR: Super Admin — hamma narsa, tuzilma va akkauntlar; Fakultet operatori — o'z fakultetida guruh/mutaxassislik/yuklama kiritadi, fanlar va xonalarni tahrirlaydi, jadval generatsiya qiladi; Kafedra mudiri — o'z kafedrasi o'qituvchilari va yuklamalarini boshqaradi, talabnomalarga javob beradi; O'qituvchi — faqat ko'radi.

ISH TARTIBI: 1) Super Admin tuzilmani (fakultet/kafedra/xona) va akkauntlarni yaratadi → 2) operator mutaxassislik, guruh, fan va yuklamani kiritadi → 3) mudir yuklamalarga o'z o'qituvchilarini biriktiradi (kerak bo'lsa talabnoma orqali boshqa kafedradan so'raydi) → 4) operator "Dars jadvali" sahifasida generatsiyani bosadi → 5) hamma o'z jadvalini ko'radi.

JADVAL DVIGATELI (muhim!): darslarni vaqt va xonalarga taqsimlashni AI emas, maxsus optimallashtirish dvigateli (greedy + simulated annealing) bajaradi. QATTIQ cheklovlar hech qachon buzilmaydi: bitta o'qituvchi/guruh/xona bir paytda faqat bitta darsda; xona sig'imi guruhga yetadi; maxsus xonalar faqat ruxsat bilan. YUMSHOQ maqsadlar: qiyin fanlar ertalabki juftliklarga, o'qituvchiga yolg'iz juftlik qoldirmaslik, ish kunlarini ixchamlash. Hafta: 5 kun (Dushanba–Juma), kuniga 6 juftlik. Shuning uchun natija matematik jihatdan konfliktsiz — "xatosiz taqsimlash" shu dvigatel kafolati.

QOIDALAR:
- Ma'lumot haqidagi HAR QANDAY savolda tool ishlat — sondan/nomdan taxmin qilma, o'ylab topma.
- Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob ber (odatda o'zbek yoki rus). Aniq va qisqa yoz.
- Jadval tuzish so'ralsa: avval tayyorlik_tekshir tool'ini chaqir. Nimadir yetishmasa (masalan guruh yoki yuklama 0 ta) — nimani, qaysi bo'limda kiritishni tushuntir. Hammasi tayyor bo'lsa va foydalanuvchi roli ruxsat bersa jadval_yaratish'ni ishlat.
- Foydalanuvchi rolida ruxsat bo'lmagan amalni so'rasa, buni muloyim tushuntir.
- Xatolik yoki muammo aytilsa: avval tool bilan holatni tekshir, keyin aniq yechim ber (qaysi sahifa, qaysi tugma)."""

TOOLS = [
    {
        "name": "malumot_qidir",
        "description": "Bazadagi ro'yxatlarni o'qiydi (fakultet, kafedra, mutaxassislik, o'qituvchi, fan, guruh, xona, yuklama). Nom bo'yicha qidirish mumkin. Foydalanuvchi ko'ra oladigan doiradagina qaytaradi.",
        "input_schema": {
            "type": "object",
            "properties": {
                "resource": {"type": "string", "enum": ["faculties", "departments", "specialties", "teachers", "subjects", "groups", "rooms", "workloads"], "description": "Qaysi turdagi maʼlumot"},
                "search": {"type": "string", "description": "Nom bo'yicha qidiruv (ixtiyoriy)"},
                "limit": {"type": "integer", "description": "Nechta qaytarish (standart 15, max 40)"},
            },
            "required": ["resource"],
        },
    },
    {
        "name": "tayyorlik_tekshir",
        "description": "Jadval generatsiyasiga tayyorlikni tekshiradi: har jadvaldagi yozuvlar soni, nima yetishmayotgani va oxirgi generatsiya holati.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "jadval_korish",
        "description": "Tayyor dars jadvalini ko'rsatadi — guruh nomi yoki o'qituvchi nomi bo'yicha (oxirgi muvaffaqiyatli generatsiyadan).",
        "input_schema": {
            "type": "object",
            "properties": {
                "groupName": {"type": "string", "description": "Guruh nomi (qismi ham boʻladi)"},
                "teacherName": {"type": "string", "description": "O'qituvchi nomi (qismi ham bo'ladi)"},
            },
        },
    },
    {
        "name": "bosh_xonalar",
        "description": "Berilgan kun va juftlikda bo'sh xonalarni topadi (oxirgi tayyor jadvalga ko'ra).",
        "input_schema": {
            "type": "object",
            "properties": {
                "day": {"type": "integer", "description": "0=Dushanba .. 4=Juma"},
                "pair": {"type": "integer", "description": "Juftlik 1..6"},
                "minCapacity": {"type": "integer", "description": "Minimal sig'im (ixtiyoriy)"},
            },
            "required": ["day", "pair"],
        },
    },
    {
        "name": "jadval_yaratish",
        "description": "Jadval generatsiyasini ishga tushiradi (faqat Super Admin va Fakultet operatori). Darhol runId qaytaradi, jarayon fonda boradi — holatini jarayon_holati bilan tekshirish mumkin.",
        "input_schema": {
            "type": "object",
            "properties": {
                "semester": {"type": "integer", "description": "Semestr (standart 1)"},
                "maxMs": {"type": "integer", "description": "Optimallashtirish vaqti ms (standart 5000, max 120000)"},
            },
        },
    },
    {
        "name": "jarayon_holati",
        "description": "Generatsiya jarayoni holatini qaytaradi: running/done/failed, ballar va darslar soni.",
        "input_schema": {
            "type": "object",
            "properties": {"runId": {"type": "integer", "description": "Generatsiya raqami"}},
            "required": ["runId"],
        },
    },
]

# resurs → (model, qidiruv maydoni, include-yordamchi, map)
LIST_CONFIG = {
    "faculties": (Faculty, "name"),
    "departments": (Department, "name"),
    "specialties": (Specialty, "name"),
    "teachers": (Teacher, "fullName"),
    "subjects": (Subject, "name"),
    "groups": (Group, "name"),
    "rooms": (Room, "name"),
    "workloads": (Workload, None),
}


def _map_row(resource, r):
    if resource == "faculties":
        return {"id": r.id, "nom": r.name, "kod": r.code}
    if resource == "departments":
        return {"id": r.id, "nom": r.name, "fakultet": r.faculty.name if r.faculty else None}
    if resource == "specialties":
        return {"id": r.id, "nom": r.name, "kod": r.code, "fakultet": r.faculty.name if r.faculty else None}
    if resource == "teachers":
        return {"id": r.id, "nom": r.fullName, "lavozim": r.position, "kafedra": r.department.name if r.department else None, "holat": r.status}
    if resource == "subjects":
        return {"id": r.id, "nom": r.name, "kredit": r.credit, "semestr": r.semester, "qiyinlik": r.difficulty}
    if resource == "groups":
        return {"id": r.id, "nom": r.name, "kurs": r.course, "talabalar": r.size, "fakultet": r.faculty.name if r.faculty else None}
    if resource == "rooms":
        return {"id": r.id, "nom": r.name, "sigim": r.capacity, "turi": r.type, "bino": r.building.name if r.building else None}
    if resource == "workloads":
        return {"id": r.id, "guruh": ", ".join(x.group.name for x in r.groups if x.group and x.group.name),
                "fan": r.subject.name if r.subject else None, "oqituvchi": r.teacher.fullName if r.teacher else None,
                "soat": r.weeklyHours, "semestr": r.semester}
    return {"id": r.id}


def _latest_done_run(db: Session):
    return db.scalars(select(SchedulingRun).where(SchedulingRun.status == "done").order_by(SchedulingRun.id.desc())).first()


def run_tool(db: Session, name: str, inp: dict, user: CurrentUser, req_ip: str):
    if name == "malumot_qidir":
        resource = inp.get("resource")
        if resource not in LIST_CONFIG:
            return {"xato": f"Noma'lum resurs: {resource}"}
        model, field = LIST_CONFIG[resource]
        clauses = []
        scoped = scope_where(resource, user)
        if scoped is not None:
            clauses.append(scoped)
        if resource == "workloads":
            clauses.append(Workload.archived == False)  # noqa: E712
        search = inp.get("search")
        if search and field:
            clauses.append(getattr(model, field).contains(search))
        limit = min(max(int(inp.get("limit") or 15), 1), 40)
        stmt = select(model)
        for c in clauses:
            stmt = stmt.where(c)
        total_rows = db.scalars(stmt).all()
        return {"jami": len(total_rows), "korsatilgan": min(len(total_rows), limit),
                "royxat": [_map_row(resource, r) for r in total_rows[:limit]]}

    if name == "tayyorlik_tekshir":
        counts = {
            "fakultet": db.query(Faculty).count(), "kafedra": db.query(Department).count(),
            "oqituvchi": db.query(Teacher).count(), "fan": db.query(Subject).count(),
            "guruh": db.query(Group).count(), "xona": db.query(Room).count(),
            "yuklama": db.query(Workload).filter(Workload.archived == False).count(),  # noqa: E712
        }
        missing = []
        if not counts["fakultet"]:
            missing.append("fakultetlar (Tuzilma → Fakultetlar)")
        if not counts["fan"]:
            missing.append("fanlar (Resurslar → Fanlar bazasi)")
        if not counts["guruh"]:
            missing.append("guruhlar (Resurslar → Akademik guruhlar)")
        if not counts["xona"]:
            missing.append("xonalar (Resurslar → Bino va xonalar)")
        if not counts["yuklama"]:
            missing.append("yuklamalar (Jarayon → O'quv yuklamasi: guruh+fan+o'qituvchi+soat)")
        last = db.scalars(select(SchedulingRun).order_by(SchedulingRun.id.desc())).first()
        return {
            "sonlar": counts,
            "generatsiyaga_tayyor": not missing,
            "yetishmaydi": missing,
            "oxirgi_generatsiya": {"runId": last.id, "holat": last.status, "qattiq_buzilish": last.hardScore,
                                   "yumshoq_ball": last.softScore} if last else None,
        }

    if name == "jadval_korish":
        run = _latest_done_run(db)
        if run is None:
            return {"xato": "Hali tayyor jadval yo'q — avval generatsiya qilish kerak"}
        stmt = select(ScheduleEntry).where(ScheduleEntry.runId == run.id)
        title = ""
        if inp.get("groupName"):
            g = db.scalars(select(Group).where(Group.name.contains(inp["groupName"]))).first()
            if g is None:
                return {"xato": f"Guruh topilmadi: {inp['groupName']}"}
            stmt = stmt.where(ScheduleEntry.groupId == g.id)
            title = f"Guruh: {g.name}"
        elif inp.get("teacherName"):
            t = db.scalars(select(Teacher).where(Teacher.fullName.contains(inp["teacherName"]))).first()
            if t is None:
                return {"xato": f"O'qituvchi topilmadi: {inp['teacherName']}"}
            stmt = stmt.where(ScheduleEntry.teacherId == t.id)
            title = f"O'qituvchi: {t.fullName}"
        else:
            return {"xato": "groupName yoki teacherName bering"}
        entries = db.scalars(stmt.order_by(ScheduleEntry.day, ScheduleEntry.pair)).all()

        def nm(model, oid, attr="name"):
            obj = db.get(model, oid)
            return getattr(obj, attr) if obj else f"#{oid}"

        return {
            "runId": run.id, "kim": title, "darslar_soni": len(entries),
            "darslar": [{
                "kun": DAY_NAMES[e.day], "juftlik": e.pair,
                "fan": nm(Subject, e.subjectId), "guruh": nm(Group, e.groupId),
                "oqituvchi": nm(Teacher, e.teacherId, "fullName"), "xona": nm(Room, e.roomId),
            } for e in entries],
        }

    if name == "bosh_xonalar":
        day, pair = int(inp.get("day")), int(inp.get("pair"))
        if day < 0 or day > 4 or pair < 1 or pair > 6:
            return {"xato": "day 0..4, pair 1..6 bo'lishi kerak"}
        run = _latest_done_run(db)
        busy = set()
        if run is not None:
            busy = {e.roomId for e in db.scalars(select(ScheduleEntry).where(
                ScheduleEntry.runId == run.id, ScheduleEntry.day == day, ScheduleEntry.pair == pair)).all()}
        stmt = select(Room).order_by(Room.capacity.desc())
        if inp.get("minCapacity"):
            stmt = stmt.where(Room.capacity >= int(inp["minCapacity"]))
        rooms = [r for r in db.scalars(stmt).all() if r.id not in busy][:30]
        return {
            "kun": DAY_NAMES[day], "juftlik": pair,
            "eslatma": f"Run #{run.id} bo'yicha" if run else "Hali tayyor jadval yo'q — barcha xonalar bo'sh hisoblanadi",
            "bosh_xonalar": [{"nom": r.name, "sigim": r.capacity, "turi": r.type,
                              "bino": r.building.name if r.building else None} for r in rooms],
        }

    if name == "jadval_yaratish":
        allowed = ["Super Admin", "Fakultet operatori"]
        if user.role not in allowed:
            return {"xato": f"Sizning rolingiz ({user.role}) jadval generatsiya qila olmaydi — bu faqat Super Admin va Fakultet operatoriga ruxsat etilgan"}
        if restriction_blocks(user, "schedule", "write"):
            return {"xato": "Sizga jadval bo'limiga yozish cheklangan"}
        semester = int(inp.get("semester") or 1)
        max_ms = min(120_000, int(inp.get("maxMs") or 5000))
        run = SchedulingRun(semester=semester, status="running")
        db.add(run)
        db.commit()
        start_generate_job(run.id, semester, max_ms)
        audit("Jadval generatsiyasi boshlandi (AI yordamchi)", f"run #{run.id}", user.login, req_ip)
        return {"runId": run.id, "holat": "running",
                "xabar": "Generatsiya boshlandi — bir necha soniyadan keyin jarayon_holati bilan tekshiring"}

    if name == "jarayon_holati":
        run = db.get(SchedulingRun, int(inp.get("runId")))
        if run is None:
            return {"xato": f"Run #{inp.get('runId')} topilmadi"}
        count = db.query(ScheduleEntry).filter(ScheduleEntry.runId == run.id).count()
        return {"runId": run.id, "holat": run.status, "qattiq_buzilish": run.hardScore,
                "yumshoq_ball": run.softScore, "darslar_soni": count}

    return {"xato": f"Noma'lum tool: {name}"}


def _run_tool_safe(db, name, inp, user, ip):
    try:
        return run_tool(db, name, inp or {}, user, ip)
    except Exception as e:  # noqa: BLE001
        return {"xato": f"Tool xatosi: {e}"}


def chat_claude(db, clean, user_ctx, user, ip):
    client = anthropic.Anthropic()
    system = [
        {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": user_ctx},
    ]
    messages = list(clean)
    response = None
    for _ in range(MAX_TOOL_TURNS):
        response = client.messages.create(
            model=MODEL, max_tokens=2048, thinking={"type": "adaptive"},
            system=system, tools=TOOLS, messages=messages,
        )
        if response.stop_reason != "tool_use":
            break
        messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in response.content]})
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            result = _run_tool_safe(db, block.name, block.input, user, ip)
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, ensure_ascii=False)})
        messages.append({"role": "user", "content": results})
    return "\n".join(b.text for b in response.content if b.type == "text").strip()


def chat_gemini(db, clean, user_ctx, user, ip):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    declarations = []
    for t in TOOLS:
        decl = {"name": t["name"], "description": t["description"]}
        if t["input_schema"].get("properties"):
            decl["parameters"] = t["input_schema"]
        declarations.append(decl)
    tools = [{"functionDeclarations": declarations}]
    contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in clean]

    for _ in range(MAX_TOOL_TURNS):
        r = httpx.post(url, timeout=60, headers={"Content-Type": "application/json", "x-goog-api-key": os.environ.get("GEMINI_API_KEY", "")},
                       json={"systemInstruction": {"parts": [{"text": f"{SYSTEM_PROMPT}\n\n{user_ctx}"}]},
                             "contents": contents, "tools": tools})
        if r.status_code >= 400:
            if r.status_code in (400, 403):
                raise HTTPException(503, "AI kaliti noto'g'ri yoki muddati o'tgan — GEMINI_API_KEY tekshirilsin")
            if r.status_code == 429:
                raise HTTPException(503, "Bepul AI limiti vaqtincha tugadi — bir daqiqadan keyin qayta urinib ko'ring")
            raise HTTPException(502, f"AI xatosi (HTTP {r.status_code}): {r.text[:200]}")
        data = r.json()
        parts = (((data.get("candidates") or [{}])[0]).get("content") or {}).get("parts") or []
        calls = [p for p in parts if "functionCall" in p]
        if not calls:
            return "\n".join(p["text"] for p in parts if "text" in p).strip()
        contents.append({"role": "model", "parts": parts})
        responses = []
        for c in calls:
            fc = c["functionCall"]
            result = _run_tool_safe(db, fc["name"], fc.get("args") or {}, user, ip)
            responses.append({"functionResponse": {"name": fc["name"], "response": {"natija": result}}})
        contents.append({"role": "user", "parts": responses})
    return ""


def assistant_router() -> APIRouter:
    r = APIRouter(prefix="/assistant")

    @r.post("/chat")
    def chat(request: Request, body: dict = Depends(get_body), user: CurrentUser = Depends(current_user),
             db: Session = Depends(get_db)):
        if os.environ.get("ANTHROPIC_API_KEY"):
            provider = "claude"
        elif os.environ.get("GEMINI_API_KEY"):
            provider = "gemini"
        else:
            raise HTTPException(503, "AI yordamchi hali sozlanmagan (serverda ANTHROPIC_API_KEY yoki GEMINI_API_KEY yo'q)")

        history = body.get("messages") if isinstance(body.get("messages"), list) else []
        clean = [{"role": m["role"], "content": m["content"][:4000]} for m in history
                 if isinstance(m, dict) and m.get("role") in ("user", "assistant")
                 and isinstance(m.get("content"), str) and m["content"].strip()][-20:]
        if not clean or clean[-1]["role"] != "user":
            raise HTTPException(400, "messages oxiri user xabari bo'lishi kerak")

        user_ctx = f"Hozirgi foydalanuvchi: {user.fullName or user.login} (login: {user.login}), roli: {user.role}."
        ip = client_ip(request)
        try:
            reply = chat_claude(db, clean, user_ctx, user, ip) if provider == "claude" \
                else chat_gemini(db, clean, user_ctx, user, ip)
        except anthropic.AuthenticationError:
            raise HTTPException(503, "AI kaliti noto'g'ri — ANTHROPIC_API_KEY tekshirilsin")
        except anthropic.RateLimitError:
            raise HTTPException(503, "AI hozir band — bir ozdan keyin qayta urinib ko'ring")
        except anthropic.APIError as e:
            raise HTTPException(502, f"AI xatosi: {e.message}")
        return {"reply": reply or "Javob topilmadi — savolni boshqacha yozib ko'ring."}

    return r
