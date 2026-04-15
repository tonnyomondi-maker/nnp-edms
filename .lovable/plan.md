# Google Drive Integration Plan

## Current State

The app is a UI prototype with mock data — no backend, no database, no Lovable Cloud. The submit flow currently shows a toast and navigates away without actually uploading anything.

## What's Needed

Google Drive integration requires server-side code (Edge Functions) to securely handle Google API credentials and file operations. This means we need to set up Lovable Cloud first.

## Prerequisites (You Need to Do)

1. **Create a Google Cloud project** at [console.cloud.google.com](https://console.cloud.google.com)
2. **Enable the Google Drive API** in that project
3. **Create a Service Account** (recommended for server-to-server access — no user OAuth needed):
  - Go to IAM & Admin → Service Accounts → Create
  - Download the JSON key file
4. **Create a shared Drive folder** (or regular folder) for the institution and share it with the service account email
5. **Enable Lovable Cloud** on this project (needed for Edge Functions and database)

## Implementation Steps

### Step 1: Enable Lovable Cloud & Store Secrets

- Enable Lovable Cloud for database + Edge Functions
- Store `GOOGLE_SERVICE_ACCOUNT_KEY` as a project secret

### Step 2: Create Database Tables

- `documents` table matching the existing mock data model
- `audit_logs` table for action tracking
- `teaching_assignments` table
- RLS policies for role-based access

### Step 3: Create Edge Function — `upload-to-drive`

Handles:

- Receiving the PDF file from the frontend
- **Auto-naming**: `[Department][UnitName][UnitCode][Class][DocType][Week(optional)]_[PF].pdf`
  - Example: `ComputerScience_CS101_DITY1_SessionPlan_W3_PF001.pdf`
- **Folder organization**: Creates/finds `/DEPARTMENTS/{Department}/{UnitCode}/` folder hierarchy
- Uploading to Google Drive via service account
- Setting permissions (view-only for trainer, department access for HOD, etc.)
- Returning `file_url` and `file_drive_id`
- Inserting the document record into the database

### Step 4: Create Edge Function — `manage-drive-permissions`

Called during approval workflow to update Drive file permissions:

- HOD approval → grants DP view access
- DP approval → grants IQA view access
- Archive → sets final read-only permissions

### Step 5: Update Frontend

- **SubmitDocument.tsx**: Replace mock submit with real upload to Edge Function, show upload progress
- **All queue screens**: Fetch from database instead of mock data
- **DocumentCard**: Link to actual Google Drive file URL

### Step 6: Drive Folder Structure

```text
/DEPARTMENTS/
├── Computer Science/
│   ├── CS101/
│   │   ├── ComputerScience_CS101_DITY1_LearningPlan_PF001.pdf
│   │   └── ComputerScience_CS101_DITY1_SessionPlan_W1_PF001.pdf
│   └── CS205/
├── Electrical Engineering/
│   └── EE101/
└── Business Studies/
```

Also take note that the documents are sorted per trainer per department

## Technical Details

- **Google Drive API**: Uses `googleapis` npm package in Deno Edge Functions via `npm:googleapis`
- **Auth**: JWT-based service account authentication (no user consent needed)
- **File naming function**: Pure utility that constructs the standardized name from document metadata
- **Permission model**: Service account owns all files; shares with appropriate Google accounts based on role transitions

## Order of Work

Since this requires Lovable Cloud + secrets setup before any code can work, I recommend:

1. You enable Lovable Cloud and provide the Google service account JSON key
2. I then build everything (database, Edge Functions, frontend updates) in one go