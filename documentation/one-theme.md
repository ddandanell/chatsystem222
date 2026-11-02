## Colour: one theme (B4)

There is one theme. `globals.css` declares 77 custom properties in `:root`, and `@theme inline`
maps them to Tailwind names. There is **no** `.dark` block, no `@custom-variant dark`, and no
`dark:` utility anywhere in `src/`.

Why: the dark block was 33 declarations and the components carried 46 `dark:` utilities, but
nothing ever added the `.dark` class and no `prefers-color-scheme` rule existed. It was a second
theme that could not render — dead weight that made the token set look twice as large as it is and
invited edits that would never be seen.

Rules that follow:

- One new visual state means one token in `:root` (or a `color-mix` of an existing one), never a
  `dark:` variant.
- The contrast baseline is pinned by `tests/no-dark-mode.test.ts`: `--background`,
  `--card`, `--border`, `--input` and `--muted-foreground` must keep their exact values, and the
  file must stay under 5,238 bytes with 77 declarations over 77 distinct names.
- Adding a theme later is a product decision, not a Token Pass: it needs an activator, a
  `prefers-color-scheme` or explicit switch, and its own contrast gate.
