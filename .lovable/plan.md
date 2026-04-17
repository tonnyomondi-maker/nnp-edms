
The user wants a password reset flow. This requires:
1. A "Forgot password?" link on the login form in `Auth.tsx`
2. A way to request the reset (calls `supabase.auth.resetPasswordForEmail` with `redirectTo`)
3. A new `/reset-password` page where users land from the email link to set a new password (calls `supabase.auth.updateUser({ password })`)
4. Route added in `App.tsx` (must be a public route, not behind auth)

Keeping it simple — inline the "forgot password" UI as a third tab or a small inline mode on the login tab to avoid creating an extra page for the request step. A separate page is only required for the reset (post-email-click) step.

# Plan: Password Reset Flow

## 1. Update `src/pages/Auth.tsx`
- Add a "Forgot password?" link below the login password field
- Clicking it switches the login form into "reset request" mode (email field + "Send reset link" button)
- On submit: call `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })`
- Show a toast confirming the email was sent
- Add a "Back to login" link to return

## 2. Create `src/pages/ResetPassword.tsx`
- Public route — no auth guard
- Supabase auto-creates a recovery session when the user clicks the email link, so the page just needs:
  - New password + confirm password inputs
  - On submit: `supabase.auth.updateUser({ password })`
  - On success: toast + navigate to `/` (user is now logged in with new password)
- Show a loading state while the recovery session is being established
- Handle the case where the user lands here without a recovery session (show error + link back to `/auth`)

## 3. Update `src/App.tsx`
- Add `/reset-password` route pointing to `ResetPassword` component
- Place it alongside `/auth` as a public route (outside the authenticated `AppShell`)

## 4. Email delivery note
The reset email will be sent using Lovable's default auth email template. No custom email setup is required for this to work. If the user later wants branded reset emails from their own domain, that's a separate setup step.

## Files
- **Modify**: `src/pages/Auth.tsx`, `src/App.tsx`
- **Create**: `src/pages/ResetPassword.tsx`
