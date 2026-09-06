# Trainer onboarding — consolidate, don't duplicate

## What exists today

Two overlapping guides already render on every user's dashboard:

1. **"What you need to do here"** (`RoleGuideCard`) — a dismissible per-role walkthrough.
2. **"Your setup checklist"** (`OnboardingChecklist`) — near-identical steps with checkboxes, progress bar, and profile/signature auto-ticks.

For trainers these two cards repeat each other (units, templates, upload, track rejections) and neither explains the document lifecycle (submit → view PDF → approve) or what the status labels on their cards mean.

## Easiest, least-duplicated approach

Keep **one** onboarding surface per role and add the missing "how the portal works" content to it, instead of a third page.

### Changes

1. **Merge the two dashboard cards into one** (`OnboardingChecklist` becomes the single trainer guide):
   - Keep its interactive checklist, progress bar and auto-ticks.
   - Absorb `RoleGuideCard`'s headline intro, then **remove `RoleGuideCard` from the Dashboard** for trainers (and other roles) so nothing renders twice. Keep the "Show role guide" replay button working by pointing it at the checklist's storage key.

2. **Add a "How a document moves" strip** inside the trainer checklist card:
   - Simple 4-step visual: You submit (PDF) → HOD verifies → IQAO reviews → DP Academics approves → IQAO archives.
   - One line under each step saying what the trainer sees at that point.

3. **Add a "What each status means" legend** (small list with the same colored badges used on document cards):
   - Submitted = waiting for HOD · Verified by HOD = with IQAO · Reviewed by IQAO = with DP Academics · Approved = finalized · Rejected = needs correction, read the comment and resubmit · Archived = final, stored on Google Drive.

4. **Trainer-only:** the legend + lifecycle strip show only when the active role is Trainer, keeping other roles' checklists unchanged except for the merge.

### Files touched

- `src/components/common/OnboardingChecklist.tsx` — merge guide content, add lifecycle strip + status legend.
- `src/pages/Dashboard.tsx` — remove `RoleGuideCard` render.
- `src/components/common/RoleGuideCard.tsx` — keep the file for the replay button only (or fold the button into the checklist and delete the card).

No backend, routing, or data changes.
