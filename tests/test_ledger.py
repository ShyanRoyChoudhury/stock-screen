"""Unit tests for the pure FIFO allocator in app.positions.ledger.

No DB: only allocate_fifo is exercised.
"""

from datetime import date

from app.positions.ledger import allocate_fifo


def test_allocate_fifo_consumes_oldest_position_first():
    positions = [
        (1, date(2026, 9, 10), 10),
        (2, date(2026, 9, 15), 10),
    ]

    allocations, leftover = allocate_fifo(positions, 5)

    assert allocations == [(1, 5)]
    assert leftover == 0


def test_allocate_fifo_spills_over_into_the_next_oldest_position():
    positions = [
        (1, date(2026, 9, 10), 10),
        (2, date(2026, 9, 15), 10),
    ]

    allocations, leftover = allocate_fifo(positions, 15)

    assert allocations == [(1, 10), (2, 5)]
    assert leftover == 0


def test_allocate_fifo_reports_leftover_when_sell_exceeds_open_quantity():
    positions = [(1, date(2026, 9, 10), 10)]

    allocations, leftover = allocate_fifo(positions, 15)

    assert allocations == [(1, 10)]
    assert leftover == 5


def test_allocate_fifo_on_empty_positions_returns_full_leftover():
    allocations, leftover = allocate_fifo([], 10)

    assert allocations == []
    assert leftover == 10


def test_allocate_fifo_ignores_input_order_sorts_by_opened_on_then_id():
    # Passed newest-first; the allocator must still consume oldest-first.
    positions = [
        (2, date(2026, 9, 15), 10),
        (1, date(2026, 9, 10), 10),
    ]

    allocations, leftover = allocate_fifo(positions, 12)

    assert allocations == [(1, 10), (2, 2)]
    assert leftover == 0


def test_allocate_fifo_ties_on_opened_on_break_by_position_id():
    same_day = date(2026, 9, 10)
    positions = [
        (5, same_day, 10),
        (3, same_day, 10),
    ]

    allocations, leftover = allocate_fifo(positions, 12)

    assert allocations == [(3, 10), (5, 2)]
    assert leftover == 0
