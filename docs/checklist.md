# The checklist

The checklist turns scan results into **small tasks you can finish in a click or a minute**, ordered by effort and payoff. It lives on the *Checklist* page and as "Your plan for today" on the Overview.

| Type | Example | Buttons | Why it is a task |
|---|---|---|---|
| **auto** (safe) | Clear Gradle caches · +2.8 GB | *Clean up* | Regenerates by itself. One click, nothing to decide. |
| **auto** (grouped) | Clear 9 smaller items | *Clean up* | Items < 300 MB are bundled so the list stays short. |
| **review** | Remove node_modules in an active project · Decide on “My first video.mov” | *Keep* / *Remove* or *Move to Trash* | Only you know whether you still need it. *Keep* hides it for good. |
| **manual** | Clean the Anaconda package cache · Run Homebrew cleanup · Empty the Trash | *Run it* / *Copy command* / *I did it* | Needs a tool's own command. *Run it* uses a fixed whitelist and reports the space actually freed (disk free before vs after). |
| **open** | Tidy up Downloads (800 loose items) | *Open folder* / *Done* | A habit task; opens the Explorer on the folder. |

## How you use it
1. **Tick the circle** to *select* a task (nothing happens yet), or press the task's own button.
2. Press **Run selected** (or the task button) — a **confirmation** lists exactly what will happen and how much it frees.
3. Tasks that need a decision offer *Move to Trash* (undoable) or *Delete permanently*.
4. Tasks Storage can't run for you (open a folder, a command without a runner) have *I did it* / *Done*; their circle just marks them done.

> Early versions ran a task the moment you ticked its circle. That was a bug and is fixed — ticking only selects.

## Rules
- Safe items ≥ 300 MB get their own task; smaller safe items are grouped.
- Review items appear from 150 MB.
- Manual/open tasks reappear 14 days after you mark them done (caches refill).
- Progress = tasks completed in the last 24 h ÷ (open + completed). "Freed today" sums the real bytes.
- Completed tasks are logged in `data/tasks.json`; deletions are also in the History page's cleanup log.

## Adding a task
Add a rule in `buildTasks()` (`server.js`) that pushes `{ id, type, title, detail, undo, kb, effort, risk, … }`. If it needs a command, add it to `RUNNABLE` — the front-end renders the rest.
