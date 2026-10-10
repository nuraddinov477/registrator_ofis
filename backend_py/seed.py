"""Demo ma'lumot — server/prisma/seed.js ning Python nusxasi.

Ishga tushirish:  python seed.py   (DATABASE_URL muhit o'zgaruvchisi kerak)
"""
from app.auth import hash_password
from app.db import Base, SessionLocal, engine
from app.models import (AuditLog, Building, Department, Faculty, Group, Room, RoomPermission,
                        ScheduleEntry, SchedulingRun, Specialty, Subject, Teacher, User, Workload, WorkloadGroup)


def main():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        print("🌱 Seed boshlandi...")
        # Tozalash (bog'liqlik tartibida)
        for model in (ScheduleEntry, SchedulingRun, WorkloadGroup, Workload, RoomPermission, Room, Building,
                      Group, Subject, Teacher, Specialty, Department, Faculty, User, AuditLog):
            db.query(model).delete()
        db.commit()

        fac = {}
        for code, name in [
            ("AF", "Amaliy fanlar fakulteti"),
            ("SHSF", "Sharq sivilizatsiyasi va falsafa fakulteti"),
            ("SHXTAI", "Sharq xalqlari tillari va adabiyoti instituti"),
            ("TSXIMI", "Tashqi siyosat va xalqaro iqtisodiy munosabatlar instituti"),
        ]:
            row = Faculty(name=name, code=code)
            db.add(row)
            db.flush()
            fac[code] = row.id

        db.add_all([
            Department(name="Arabshunoslik oliy maktabi", code="arab", facultyId=fac["SHXTAI"], head="Bultakov Ikrom Yusupovich"),
            Department(name="G'arb tillari kafedrasi", code="Garb-tillari", facultyId=fac["AF"], head="Saidabarova Saodat Parxadjanovna"),
            Department(name="Iqtisodiyot va menejment kafedrasi", code="Iqtisod", facultyId=fac["TSXIMI"], head="Kadirova Zulayho Abduxalimovna"),
            Department(name="Pedagogika va psixologiya kafedrasi", code="Ped", facultyId=fac["AF"], head="Abdullayeva Shoira Xamidovna"),
        ])

        spec = {}
        for name, code, faculty in [
            ("Arab tili va adabiyoti", "AR-01", "SHXTAI"),
            ("Xalqaro iqtisodiy munosabatlar", "XIM-01", "TSXIMI"),
        ]:
            row = Specialty(name=name, code=code, facultyId=fac[faculty], form="Kunduzgi", years=4)
            db.add(row)
            db.flush()
            spec[code] = row.id

        tch = {}
        for name, position, degree in [
            ("Karimov Akbar", "Dotsent", "PhD"),
            ("Yusupova Dilnoza", "Katta o'qituvchi", "—"),
            ("Rashidov Sardor", "Professor", "DSc"),
            ("Olimova Malika", "Assistent", "—"),
        ]:
            row = Teacher(fullName=name, position=position, degree=degree)
            db.add(row)
            db.flush()
            tch[name] = row.id

        sub = {}
        for name, code, difficulty in [
            ("Arab tili grammatikasi", "AR-GR", 4),
            ("Makroiqtisodiyot", "ECO-MAC", 5),
            ("Pedagogika", "PED-01", 2),
            ("Jismoniy tarbiya", "PE-01", 1),
        ]:
            row = Subject(name=name, code=code, type="Majburiy", difficulty=difficulty)
            db.add(row)
            db.flush()
            sub[code] = row.id

        grp = {}
        for name, course, size, spec_code in [
            ("AR-101", 1, 28, "AR-01"),
            ("AR-401", 4, 22, "AR-01"),
            ("XIM-201", 2, 30, "XIM-01"),
        ]:
            row = Group(name=name, course=course, size=size, specialtyId=spec[spec_code], form="Kunduzgi")
            db.add(row)
            db.flush()
            grp[name] = row.id

        building = Building(name="Asosiy bino", floors=4, address="Toshkent")
        db.add(building)
        db.flush()
        room = {}
        for name, capacity, type_, kind in [
            ("101", 30, "umumiy", "Ma'ruza"),
            ("102", 25, "umumiy", "Amaliy"),
            ("Lingafon-1", 20, "maxsus", "Laboratoriya"),
            ("Sport zali", 60, "umumiy", "Amaliy"),
        ]:
            row = Room(name=name, capacity=capacity, type=type_, kind=kind, buildingId=building.id)
            db.add(row)
            db.flush()
            room[name] = row.id

        db.add(RoomPermission(roomId=room["Lingafon-1"], specialtyId=spec["AR-01"]))

        for group_names, teacher, subject, hours in [
            (["AR-101"], "Karimov Akbar", "AR-GR", 3),
            (["AR-101"], "Olimova Malika", "PE-01", 2),
            (["AR-401"], "Karimov Akbar", "AR-GR", 2),
            (["XIM-201"], "Rashidov Sardor", "ECO-MAC", 3),
            (["XIM-201"], "Yusupova Dilnoza", "PED-01", 2),
        ]:
            w = Workload(teacherId=tch[teacher], subjectId=sub[subject], weeklyHours=hours)
            w.groups = [WorkloadGroup(groupId=grp[g]) for g in group_names]
            db.add(w)

        db.add_all([
            User(login="developer", fullName="Developer", role="Super Admin", active=True, isOwner=True,
                 passwordHash=hash_password("developer123")),
            User(login="admin", fullName="Admin Super", email="admin@university.uz", role="Super Admin", active=True,
                 passwordHash=hash_password("admin123")),
            User(login="operator", fullName="Egamberdiyev Abduvahob", role="Fakultet operatori", active=True,
                 passwordHash=hash_password("operator123")),
        ])
        db.commit()
        counts = {
            "faculties": db.query(Faculty).count(), "departments": db.query(Department).count(),
            "specialties": db.query(Specialty).count(), "teachers": db.query(Teacher).count(),
            "subjects": db.query(Subject).count(), "groups": db.query(Group).count(),
            "rooms": db.query(Room).count(), "workloads": db.query(Workload).count(),
        }
        print("✅ Seed tugadi:", counts)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        print("❌ Seed xatosi:", e)
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
