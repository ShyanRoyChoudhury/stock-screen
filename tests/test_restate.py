"""Unit tests for the pure restatement arithmetic in app.positions.restate.

No DB: only restate() is exercised.
"""

from app.positions.restate import restate


def test_5_to_1_bonus_factor_scales_levels_down_by_1_6th_and_qty_up_6x():
    factor = 1 / 6  # 6 shares out for every 1 held
    frozen = {
        "entry": 120.0,
        "stop": 108.0,
        "target_1": 132.0,
        "target_2": 144.0,
        "unset": None,
    }

    result = restate(
        avg_entry_price=120.0,
        frozen=frozen,
        qty_open=60,
        qty_total=60,
        factor=factor,
    )

    assert result["avg_entry_price"] == 20.0
    assert result["frozen"] == {
        "entry": 20.0,
        "stop": 18.0,
        "target_1": 22.0,
        "target_2": 24.0,
        "unset": None,
    }
    assert result["qty_open"] == 360
    assert result["qty_total"] == 360


def test_2_to_1_split_factor_halves_levels_and_doubles_qty():
    factor = 0.5

    result = restate(
        avg_entry_price=200.0,
        frozen={"entry": 200.0, "stop": None, "target_1": 220.0, "target_2": 240.0},
        qty_open=10,
        qty_total=10,
        factor=factor,
    )

    assert result["avg_entry_price"] == 100.0
    assert result["frozen"] == {
        "entry": 100.0,
        "stop": None,
        "target_1": 110.0,
        "target_2": 120.0,
    }
    assert result["qty_open"] == 20
    assert result["qty_total"] == 20


def test_non_integral_qty_over_factor_rounds_half_to_even_python_builtin_round():
    # qty_open/factor = 1/0.4 = 2.5 -> rounds to 2 (nearest even);
    # qty_total/factor = 3/0.4 = 7.5 -> rounds to 8 (nearest even).
    # restate() uses Python's built-in round(), which is banker's rounding
    # (round-half-to-even), not the "round half away from zero" some might
    # expect -- this test documents that behaviour explicitly.
    result = restate(
        avg_entry_price=40.0,
        frozen={},
        qty_open=1,
        qty_total=3,
        factor=0.4,
    )

    assert result["qty_open"] == 2
    assert result["qty_total"] == 8
