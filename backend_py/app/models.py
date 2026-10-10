"""Ma'lumotlar modeli — server/prisma/schema.prisma bilan AYNAN bir xil jadval va ustun nomlari.

Shu sabab mavjud (Neon PostgreSQL) bazaga to'g'ridan-to'g'ri ulanish mumkin: Prisma
jadvallari "Faculty", "Department"... nomida, ustunlar camelCase (facultyId ...).
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Table
from sqlalchemy.orm import relationship

from .db import Base, now


class Timestamps:
    createdAt = Column(DateTime, nullable=False, default=now)
    updatedAt = Column(DateTime, nullable=False, default=now, onupdate=now)


# Prisma'ning implicit M2M jadvali: Building ↔ Faculty (A = Building.id, B = Faculty.id)
building_faculties = Table(
    "_BuildingFaculties",
    Base.metadata,
    Column("A", Integer, ForeignKey("Building.id", ondelete="CASCADE"), primary_key=True),
    Column("B", Integer, ForeignKey("Faculty.id", ondelete="CASCADE"), primary_key=True),
    Index("_BuildingFaculties_B_index", "B"),
)


class Faculty(Base, Timestamps):
    __tablename__ = "Faculty"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    code = Column(String)
    description = Column(String)


class Department(Base, Timestamps):
    __tablename__ = "Department"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    code = Column(String)
    head = Column(String)
    facultyId = Column(Integer, ForeignKey("Faculty.id", ondelete="SET NULL"))
    faculty = relationship("Faculty")


class Specialty(Base, Timestamps):
    __tablename__ = "Specialty"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    code = Column(String)
    form = Column(String)
    years = Column(Integer, nullable=False, default=4)
    facultyId = Column(Integer, ForeignKey("Faculty.id", ondelete="SET NULL"))
    faculty = relationship("Faculty")


class Teacher(Base, Timestamps):
    __tablename__ = "Teacher"
    id = Column(Integer, primary_key=True, autoincrement=True)
    fullName = Column(String, nullable=False)
    position = Column(String)
    degree = Column(String)
    email = Column(String)
    status = Column(String, nullable=False, default="faol")
    departmentId = Column(Integer, ForeignKey("Department.id", ondelete="SET NULL"))
    department = relationship("Department")


class Subject(Base, Timestamps):
    __tablename__ = "Subject"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    code = Column(String)
    type = Column(String)
    credit = Column(Integer, nullable=False, default=3)
    lecture = Column(Integer, nullable=False, default=30)
    practice = Column(Integer, nullable=False, default=30)
    semester = Column(Integer, nullable=False, default=1)
    difficulty = Column(Integer, nullable=False, default=3)


class Group(Base, Timestamps):
    __tablename__ = "Group"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    course = Column(Integer, nullable=False, default=1)
    size = Column(Integer, nullable=False, default=25)
    form = Column(String)
    facultyId = Column(Integer, ForeignKey("Faculty.id", ondelete="SET NULL"))
    specialtyId = Column(Integer, ForeignKey("Specialty.id", ondelete="SET NULL"))
    faculty = relationship("Faculty")
    specialty = relationship("Specialty")


class Building(Base, Timestamps):
    __tablename__ = "Building"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    floors = Column(Integer, nullable=False, default=1)
    address = Column(String)
    # ESKI (yagona egalik) — DEPRECATED, faqat bir martalik backfill uchun saqlanadi
    facultyId = Column(Integer, ForeignKey("Faculty.id", ondelete="SET NULL"))
    faculty = relationship("Faculty")
    faculties = relationship("Faculty", secondary=building_faculties, passive_deletes=True)


class Room(Base, Timestamps):
    __tablename__ = "Room"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False, default=30)
    type = Column(String, nullable=False, default="umumiy")
    kind = Column(String)
    features = Column(String)
    buildingId = Column(Integer, ForeignKey("Building.id", ondelete="SET NULL"))
    building = relationship("Building")
    permissions = relationship("RoomPermission", back_populates="room", passive_deletes=True)


class RoomPermission(Base):
    __tablename__ = "RoomPermission"
    id = Column(Integer, primary_key=True, autoincrement=True)
    roomId = Column(Integer, ForeignKey("Room.id", ondelete="CASCADE"), nullable=False)
    teacherId = Column(Integer, ForeignKey("Teacher.id", ondelete="CASCADE"))
    groupId = Column(Integer, ForeignKey("Group.id", ondelete="CASCADE"))
    specialtyId = Column(Integer, ForeignKey("Specialty.id", ondelete="CASCADE"))
    subjectId = Column(Integer, ForeignKey("Subject.id", ondelete="CASCADE"))
    exclusive = Column(Boolean, nullable=False, default=False)
    createdAt = Column(DateTime, nullable=False, default=now)
    room = relationship("Room", back_populates="permissions")
    teacher = relationship("Teacher")
    group = relationship("Group")
    specialty = relationship("Specialty")
    subject = relationship("Subject")


class TeacherConstraint(Base, Timestamps):
    __tablename__ = "TeacherConstraint"
    id = Column(Integer, primary_key=True, autoincrement=True)
    teacherId = Column(Integer, ForeignKey("Teacher.id", ondelete="CASCADE"), nullable=False, unique=True)
    blockedDays = Column(String)
    allowedPairs = Column(String)
    teacher = relationship("Teacher")


class SiteSetting(Base):
    __tablename__ = "SiteSetting"
    id = Column(Integer, primary_key=True, default=1)
    maintenanceMode = Column(Boolean, nullable=False, default=False)
    maintenanceMessage = Column(String)
    updatedAt = Column(DateTime, nullable=False, default=now, onupdate=now)


class Workload(Base, Timestamps):
    __tablename__ = "Workload"
    id = Column(Integer, primary_key=True, autoincrement=True)
    teacherId = Column(Integer, ForeignKey("Teacher.id", ondelete="CASCADE"), nullable=False)
    subjectId = Column(Integer, ForeignKey("Subject.id", ondelete="CASCADE"), nullable=False)
    weeklyHours = Column(Integer, nullable=False, default=2)
    type = Column(String, nullable=False, default="Amaliy")
    semester = Column(Integer, nullable=False, default=1)
    archived = Column(Boolean, nullable=False, default=False)
    teacher = relationship("Teacher")
    subject = relationship("Subject")
    groups = relationship("WorkloadGroup", back_populates="workload", passive_deletes=True,
                          cascade="all, delete-orphan")


class WorkloadGroup(Base):
    __tablename__ = "WorkloadGroup"
    workloadId = Column(Integer, ForeignKey("Workload.id", ondelete="CASCADE"), primary_key=True)
    groupId = Column(Integer, ForeignKey("Group.id", ondelete="CASCADE"), primary_key=True)
    workload = relationship("Workload", back_populates="groups")
    group = relationship("Group")


class SchedulingRun(Base, Timestamps):
    __tablename__ = "SchedulingRun"
    id = Column(Integer, primary_key=True, autoincrement=True)
    semester = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default="draft")
    hardScore = Column(Integer, nullable=False, default=0)
    softScore = Column(Integer, nullable=False, default=0)
    report = Column(String)
    archived = Column(Boolean, nullable=False, default=False)


class ScheduleEntry(Base):
    __tablename__ = "ScheduleEntry"
    id = Column(Integer, primary_key=True, autoincrement=True)
    runId = Column(Integer, ForeignKey("SchedulingRun.id", ondelete="CASCADE"), nullable=False)
    groupId = Column(Integer, nullable=False)
    teacherId = Column(Integer, nullable=False)
    subjectId = Column(Integer, nullable=False)
    roomId = Column(Integer, nullable=False)
    day = Column(Integer, nullable=False)
    pair = Column(Integer, nullable=False)
    type = Column(String, nullable=False, default="Amaliy")
    __table_args__ = (Index("ScheduleEntry_runId_idx", "runId"),)


class User(Base, Timestamps):
    __tablename__ = "User"
    id = Column(Integer, primary_key=True, autoincrement=True)
    login = Column(String, nullable=False, unique=True)
    fullName = Column(String, nullable=False)
    email = Column(String)
    role = Column(String, nullable=False, default="Fakultet operatori")
    active = Column(Boolean, nullable=False, default=True)
    passwordHash = Column(String)
    facultyId = Column(Integer, ForeignKey("Faculty.id", ondelete="SET NULL"))
    departmentId = Column(Integer, ForeignKey("Department.id", ondelete="SET NULL"))
    teacherId = Column(Integer, ForeignKey("Teacher.id", ondelete="SET NULL"))
    restrictions = Column(String)
    isOwner = Column(Boolean, nullable=False, default=False)
    faculty = relationship("Faculty")
    department = relationship("Department")
    teacher = relationship("Teacher")


class AuditLog(Base):
    __tablename__ = "AuditLog"
    id = Column(Integer, primary_key=True, autoincrement=True)
    time = Column(DateTime, nullable=False, default=now)
    user = Column(String, nullable=False, default="admin")
    action = Column(String, nullable=False)
    detail = Column(String, nullable=False)
    ip = Column(String, nullable=False, default="127.0.0.1")


class TeachingRequest(Base, Timestamps):
    __tablename__ = "TeachingRequest"
    id = Column(Integer, primary_key=True, autoincrement=True)
    fromDepartmentId = Column(Integer, ForeignKey("Department.id", ondelete="SET NULL"))
    toDepartmentId = Column(Integer, ForeignKey("Department.id", ondelete="SET NULL"))
    teacherId = Column(Integer, ForeignKey("Teacher.id", ondelete="SET NULL"))
    subjectId = Column(Integer, ForeignKey("Subject.id", ondelete="SET NULL"))
    roomId = Column(Integer, ForeignKey("Room.id", ondelete="SET NULL"))
    course = Column(Integer)
    targetGroups = Column(String)
    weeklyHours = Column(Integer)
    message = Column(String)
    status = Column(String, nullable=False, default="pending")
    responseNote = Column(String)
    respondedBy = Column(String)
    respondedAt = Column(DateTime)
    createdBy = Column(String)
    fromDepartment = relationship("Department", foreign_keys=[fromDepartmentId])
    toDepartment = relationship("Department", foreign_keys=[toDepartmentId])
    teacher = relationship("Teacher")
    subject = relationship("Subject")
    room = relationship("Room")
    __table_args__ = (
        Index("TeachingRequest_status_idx", "status"),
        Index("TeachingRequest_fromDepartmentId_idx", "fromDepartmentId"),
        Index("TeachingRequest_toDepartmentId_idx", "toDepartmentId"),
    )
