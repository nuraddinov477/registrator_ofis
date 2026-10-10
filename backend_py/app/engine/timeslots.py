"""Vaqt modeli: 5 kun (Dushanba..Juma) × 6 juftlik = 30 slot. slot = day*PAIRS + (pair-1)."""

DAYS = 5
PAIRS = 6
SLOTS = DAYS * PAIRS

DAY_NAMES = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma"]

# Har bir juftlikning real soat oralig'i (frontenddagi PAIR_TIMES bilan bir xil bo'lishi shart)
PAIR_TIMES = ["8:00–9:20", "9:30–10:50", "11:30–12:50", "13:00–14:20", "14:30–15:50", "16:00–17:20"]


def slot_index(day: int, pair: int) -> int:
    return day * PAIRS + (pair - 1)


def day_of(slot: int) -> int:
    return slot // PAIRS


def pair_of(slot: int) -> int:
    return (slot % PAIRS) + 1


def pairs_for_range(start_pair: int, end_pair: int):
    return list(range(start_pair, end_pair + 1))


def allowed_slots(start_pair: int, end_pair: int = PAIRS):
    slots = []
    for pair in pairs_for_range(start_pair, end_pair):
        for day in range(DAYS):
            slots.append(slot_index(day, pair))
    return slots
