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
- In narrow panes the send button no longer shrinks until its label wraps one letter per line.

### Issue tracking in projects
- A project admin can turn on **issues** in project settings and pick a short key (`BUG` → `BUG-23`;
  2–6 capital letters or digits, starting with a letter; fixed once the first issue exists). The project
  header then shows **Messages | Issues** tabs. Turning issues off hides the tab and keeps the issues.
- Issues have a title, a body (pre-filled from the project's template — "Steps to reproduce / Expected /
  Actual / Environment" by default), status **Open → In progress → Resolved → Closed**, priority
  (Urgent / High / Normal / Low), an assignee, labels (Bug / Improvement / Question to start, with colours),
  a due date and attachments (paste a screenshot with Ctrl+V). The default template and label names are
  written in the language of the admin who turns issues on.
- The issue list filters by state, assignee, label and priority and searches title, body and `BUG-23`.
  A **board** view has one column per status (closed: last 7 days) — drag a card to change its status.
- The issue pane edits every field in place and keeps an activity log (status, priority, assignee, labels,
  due date, title) interleaved with comments; comments take @mentions and files. A resolved issue asks its
  reporter to **confirm and close** or **reopen**. `/i/BUG-23` links straight to an issue; `BUG-23` in a
  message, comment or issue body becomes a link (only that project's key, so `ISO-9001` stays text).
- Notifications: assigned to you, status changes, comments and mentions — to the reporter, the assignee
  and anyone **watching** the issue.
- **Message → issue**: "Make an issue" in a message's ⋯ menu opens a new issue pre-filled from it (its
  files come along); the message then links to the issue.
- Issues assigned to you that are open or in progress are **mirrored, not copied**: they show under your
  tasks in "Assigned to me" (and count in its sidebar number) and, when due in the visible weeks, as purple
  flag chips on the calendar. They're completed once, in the issue.
- **Weekly report**: your issues land in the same sections as tasks — resolved this week is done (closing is
  the reporter's part), in progress is in progress — listed as `BUG-23` and grouped per project
  ("# Project (issues)" in the scope picker).
- The issues tab **refreshes itself**: every 10 seconds it asks for a small change stamp and redraws only
  when something changed (paused while the browser tab is hidden). Filters, the board/list choice and a
  half-written comment survive; the pane's title follows someone else's edit unless you are editing it.
- An issue opens as a **page** under the project header (not a side pane): a large title, the body in a card
  with photos at full column width, then a timeline of comment cards with status/assignee/due changes as thin
  lines between them, ending with the comment box. Next to Send: "Resolved" for open issues, "Reopen" for
  closed ones. Fields (status, assignee, priority, labels, due, reporter, watching, source message) sit in a
  right column; on phones they fold into a chip line under the title. "← Issues" returns to the list with
  its filters kept.
- The **sidebar search** finds issues too — title, body and comments in projects you belong to — in a
  separate "Issues" group (five each, "N more" to expand; closed ones last and dimmed). Typing `BUG-23` puts
  "Jump to" at the top.
- **Migration** `20261008000000_issues` adds the issue tables and project columns; no existing data changes.

## 0.1.0 — 2026-09-21

First public release.
