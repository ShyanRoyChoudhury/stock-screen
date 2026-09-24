# VerdictChip

The daily verdict for an open position: EXIT, PARTIAL, REVIEW or HOLD. This is the primary visual on Positions and Today.

- **Props:** `verdict`, `size` (`md` | `sm`), `title` (defaults to the plain-language meaning).
- **The four verdicts differ by shape and glyph as well as colour:**
  - EXIT is a solid red fill with ■.
  - PARTIAL is a solid marigold fill with ◧.
  - REVIEW is a violet hatched outline with ?.
  - HOLD is a quiet outline with ·.
- REVIEW means "check the data" and must never be styled like EXIT.
- Always place the reason codes (`CodeList`) next to the chip. Never show a verdict alone.
