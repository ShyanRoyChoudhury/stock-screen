# CodeTag

Reason and warning codes from the verdict engine, shown verbatim with their plain-language label. `CodeList` renders a verdict's `reasons` then `warnings`.

- **Props:**
  - `CodeTag`: `code`, `detail` (the API's detail string, shown instead of the label), `kind` (`reason` | `warning`, inferred from the code), `showLabel`.
  - `CodeList`: `reasons`, `warnings`, `showLabel`.
- **Reason codes** tint their key by the verdict they set: `down` for EXIT, `partial` for PARTIAL, `review` for REVIEW.
- **Warnings** sit on `partial-soft` with `!`. They never change a verdict, and their styling must stay quieter than a reason.
- In dense tables, set `showLabel={false}`. The key stays and the label and detail move to the tooltip.
