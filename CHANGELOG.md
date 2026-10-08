# Changelog

## Unreleased

### One container
- The image now carries its own PostgreSQL 16 — one container, one volume (`/data`): the database,
  attachments and generated secrets. `docker run -v todo-data:/data -p 3000:3000 -e APP_BASE_URL=… ghcr.io/wittbox/open-todo`.
- Scheduled jobs (reminders, the morning digest, scheduled report mail) run inside the app; no cron sidecar
  or `CRON_KEY` needed. `/api/cron/*` still works for installs that set `RUN_JOBS=0` and a `CRON_KEY`.
- A volume holding a different PostgreSQL major is refused with instructions instead of opened.
- Images are published to GHCR on `v*` tags.
- Fix: a bind-mounted host directory with mode 700 left PostgreSQL unable to enter `/data/postgres`.
- Moving from the four-container layout: see "Moving from the four-container layout" in the README.

### Calendar
- Shows five rolling weeks — last week, this week, the next three — instead of a month, so this week is
  always on the second row and the coming weeks are never cut off at the end of a month.
- ◀ ▶ move four weeks: the row you were looking at stays on screen. The title is the date range.
  The URL is `/calendar?from=YYYY-MM-DD`; old `?month=` links still open.
- The first day of a month gets a small month tag ("Oct") instead of a faded out-of-month look.
- Each Sunday cell shows the ISO 8601 week number of its row (the week of that row's Monday).
- The phone dot calendar follows the same five weeks.

### Sidebar: groups and lists
- "New group" opens a popover to name the group; it is created at the bottom of your groups, scrolled
  into view and highlighted. Create stays disabled until a name is typed.
- "New list" opens a popover with the list name and the group to put it in (defaulting to the group of
  the open list, then the group you last clicked, then your last group). With no groups yet, you name
  one in the same popover.
- **Lists always belong to a group** (the inbox aside). "Remove from group", dragging a list out of its
  group and "Ungroup" are gone; "Delete group" replaces "Ungroup" and works on empty groups only.
  The server refuses a list without a group.
- **Migration:** each user's ungrouped lists are gathered into a new group at the bottom of their groups,
  named "Other" for users who chose English and "기타" otherwise. Rename it as you like.
- Duplicating a list shared with you now lands in one of your own groups (it used to keep the other
  person's group id).

### Task details
- Step names wrap and grow with their content instead of being cut off; so does the task title (it was
  stuck at one line and scrolled inside). Enter still saves and never adds a line break; an Enter that
  arrives while an IME is composing (Korean, Japanese, …) is ignored so the last character isn't lost.
- Clicking an attached photo — on a task or in a project message — opens a viewer over the page instead
  of a new tab: fitted to the screen, arrows / arrow keys / swipe between the photos of the same task or
  message, click for actual size, with open-in-new-tab and download. Other files still download.

## 0.1.0 — 2026-09-21

First public release.
