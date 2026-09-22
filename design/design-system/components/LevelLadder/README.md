# LevelLadder

A one-line picture of a position's levels: stop, trail, entry, T1 and T2, with the last close pinned above. The risk span is tinted `down-soft`, the reward span `up-soft`.

- **Props:** `entry` (use `avg_entry_price`, the adjusted one), `close`, `stop`, `trail`, `t1`, `t2`, `matched`.
- **Matched positions** use the signal's frozen stop and targets, plus a separate chandelier trail.
- **Unmatched positions** (`matched={false}`) show only the trail as the stop and state "Unmatched: trailing stop only, no targets".
