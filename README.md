# Academic Flow

FULL LOVABLE BUILD PROMPT (COPY/PASTE)

🧠 SYSTEM: ACADEMIC DOCUMENT MANAGEMENT SYSTEM (EDMS)

Build a mobile-first Academic Document Management System (EDMS) for a polytechnic institution. The system must manage teaching and administrative academic documents with strict workflow approval.

The system integrates with Google Drive for file storage and permissions and supports role-based workflows.

🧩 1. USERS & ROLES

Users can have multiple roles (dual-role support).

USER ENTITY

 name

 email

 PF number

 department

USER ROLES (many-to-many)

Roles:

 TRAINER

 HOD

 DP_ACADEMICS

 IQA

Users may have more than one role and must be able to switch roles via UI tabs.

📚 2. TEACHING ASSIGNMENTS

Each trainer is assigned units:

 unit_code

 unit_name

 class

 department

 term

 year

 trainer_id

📄 3. DOCUMENT TYPES

The system must support:

ONE-TIME DOCUMENTS (submitted per Training Schedule Such as Jan-April, May-Aug and Sept- DEC every year

 Learning Plan

 Personal Timetable

 Workload Allocation

 Scheme of Work (KNEC)

WEEKLY DOCUMENTS

 Session Plan

 Class Attendance

📦 4. DOCUMENT DATA MODEL

Each document must store:

 assignment_id

 trainer_id

 document_type

 submission_type (ONE_TIME / WEEKLY)

 week_number (only for weekly)

 file_url (Google Drive)

 file_drive_id

 status:

 SUBMITTED

 HOD_APPROVED

 DP_APPROVED

 ARCHIVED

 REJECTED

 timestamps:

 submitted_at

 hod_approved_at

 dp_approved_at

 archived_at

🔁 5. WORKFLOW LOGIC

Strict sequential approval:

Trainer → HOD → DP Academics → IQA

RULES:

 HOD cannot approve their own submission

 DP cannot approve their own submission

 IQA only archives final approved documents

STATUS TRANSITIONS:

SUBMITTED → HOD_APPROVED → DP_APPROVED → ARCHIVED

OR

ANY STATE → REJECTED

📂 6. GOOGLE DRIVE INTEGRATION

Use Google Drive as file storage.

On Upload:

 Upload file to Drive

 Rename file:

[Department][UnitCode][Class][DocType][Week(optional)]_[PF]

 Move file into:

/DEPARTMENTS/{Department}/{Unit}

Permission Rules:

 Trainer: View only after submission

 HOD: Department access only

 DP: All departments

 IQA: Full access

📱 7. UI SCREENS

🏠 DASHBOARD

Show:

 Role cards (Trainer / HOD / DP / IQA)

 My submissions

 Pending approvals

 Weekly progress summary

🟢 TRAINER MODULE

My Teaching Screen

List assignments:

 Unit Code

 Unit Name

 Class

 Document completion status

Submit Document Screen

Fields:

 Assignment selector

 Document type

 Week number (only if weekly)

 File upload (PDF only)

Rules:

 Prevent duplicate submission for same document type

 Prevent duplicate weekly submissions per week

🟡 HOD MODULE

Department Queue

Show all submitted documents in department:

Each item:

 Trainer name

 Unit

 Document type

 Week (if applicable)

Actions:

 View

 Approve

 Reject

🔵 DP ACADEMICS MODULE

Approval Queue

 View all HOD-approved documents across departments

 Approve / Reject

⚫ IQA MODULE

Archive Screen

 View DP-approved documents

 Archive to FINAL repository

 No editing allowed

📊 REPORTS MODULE

Show:

 Missing documents per unit

 Weekly submission tracking

 Department compliance rates

 Trainer performance overview

🔔 8. NOTIFICATIONS

Send notifications via email or in-app:

 On submission → notify HOD

 On HOD approval → notify DP

 On DP approval → notify IQA

 On rejection → notify trainer

🔐 9. SECURITY & VALIDATION

 Only PDF uploads allowed

 Enforce role-based access control

 Prevent self-approval

 Log every action in audit trail

 Ensure department-level data isolation

📊 10. AUDIT LOGGING

Store:

 user_id

 role used

 action performed

 document_id

 timestamp

📱 11. UI DESIGN REQUIREMENTS

 Mobile-first design

 Large buttons

 Minimal typing

 Card-based layout

 Status color coding:

 Yellow = Submitted

 Blue = In Review

 Green = Approved

 Red = Rejected

 Grey = Archived

🔄 12. DUAL ROLE SUPPORT

If a user has multiple roles:

 Show role switcher OR tab-based dashboard

 Each role must have separate access context

 Ensure actions are role-specific

⚙️ 13. BUSINESS RULES

 One-time documents: only one submission per assignment

 Weekly documents: one per week per assignment

 No editing after HOD approval

 All documents must be traceable via Drive + database

🏁 END GOAL

Build a fully functional Academic Document Management System that:

 Is mobile-first

 Supports institutional approval workflow

 Uses Google Drive for file storage

 Enforces strict academic compliance

 Supports dual-role users

 Is scalable across multiple departments

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://nnp-edms.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c0a65a7b-0f5a-409a-b280-210e274a889a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
