# Handwritten test pages (CP-19)

Each case is a photo of one handwritten page and the text its writer typed from it, under the
same name: `xk-01.jpg` and `xk-01.txt` (writer's initials, then a number). The eval
(`eval/transcribe_handwriting.py`) scores the transcription of each photo against its text.

Writing a page:

- Write it as you would on site: abbreviations (spk, CV, FHR), pressures and dates, arrows, a
  crossed-out word or two. Invent the site and people; never use a real client's.
- Type the `.txt` straight after, exactly as written: your spelling slips and abbreviations as
  they are, one line per line of writing. Leave crossed-out words out. Write `[?]` for a word
  you can't read yourself; it isn't scored.
- A page with no handwriting (a blank or a printed form) gets an empty `.txt`.

Photographing it:

- Use a phone, JPG or PNG. Most in decent light; a few hard ones (a shadow, an angle, messy
  writing) are worth having.
- Shrink each photo to 1600 px on its long edge before committing. S5 shrinks it to that before
  sending it anyway, so the model sees the same page and the repo stays small.

Real Marsh notes go in only once anonymised.
