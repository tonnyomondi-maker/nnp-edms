export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_current: boolean
          late_grace_days: number
          notes: string | null
          session_term: string
          session_year: number
          status: string
          submission_closes_at: string | null
          submission_opens_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          late_grace_days?: number
          notes?: string | null
          session_term: string
          session_year: number
          status?: string
          submission_closes_at?: string | null
          submission_opens_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          late_grace_days?: number
          notes?: string | null
          session_term?: string
          session_year?: number
          status?: string
          submission_closes_at?: string | null
          submission_opens_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          document_id: string | null
          id: string
          performed_by: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          document_id?: string | null
          id?: string
          performed_by?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          document_id?: string | null
          id?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_metadata: {
        Row: {
          audit_logs_count: number | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          documents_count: number | null
          id: string
          note: string | null
          snapshot_key: string
          storage_files_count: number | null
          total_bytes: number | null
        }
        Insert: {
          audit_logs_count?: number | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          documents_count?: number | null
          id?: string
          note?: string | null
          snapshot_key: string
          storage_files_count?: number | null
          total_bytes?: number | null
        }
        Update: {
          audit_logs_count?: number | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          documents_count?: number | null
          id?: string
          note?: string | null
          snapshot_key?: string
          storage_files_count?: number | null
          total_bytes?: number | null
        }
        Relationships: []
      }
      department_pack_capacity: {
        Row: {
          active_pack_limit: number
          department: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_pack_limit?: number
          department: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_pack_limit?: number
          department?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      document_templates: {
        Row: {
          created_at: string
          department: string | null
          description: string | null
          document_type: string
          file_name: string | null
          file_path: string
          id: string
          is_active: boolean
          source_document_id: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          department?: string | null
          description?: string | null
          document_type: string
          file_name?: string | null
          file_path: string
          id?: string
          is_active?: boolean
          source_document_id?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          department?: string | null
          description?: string | null
          document_type?: string
          file_name?: string | null
          file_path?: string
          id?: string
          is_active?: boolean
          source_document_id?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: []
      }
      document_type_policy: {
        Row: {
          document_type: Database["public"]["Enums"]["document_type"]
          forbid_text_only_fallback: boolean
          notes: string | null
          signature_only_allowed: boolean
          stamp_required: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          document_type: Database["public"]["Enums"]["document_type"]
          forbid_text_only_fallback?: boolean
          notes?: string | null
          signature_only_allowed?: boolean
          stamp_required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          document_type?: Database["public"]["Enums"]["document_type"]
          forbid_text_only_fallback?: boolean
          notes?: string | null
          signature_only_allowed?: boolean
          stamp_required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          approved_by_dp_academics_at: string | null
          archived_at: string | null
          assignment_id: string | null
          class_code: string | null
          course_type: string | null
          created_at: string
          department: string
          document_type: Database["public"]["Enums"]["document_type"]
          dp_approved_at: string | null
          dp_approved_by: string | null
          dp_autofill: boolean | null
          dp_sig_h: number | null
          dp_sig_opacity: number | null
          dp_sig_page: number | null
          dp_sig_rot: number | null
          dp_sig_w: number | null
          dp_sig_x: number | null
          dp_sig_y: number | null
          dp_signature_url: string | null
          dp_stamp_h: number | null
          dp_stamp_opacity: number | null
          dp_stamp_page: number | null
          dp_stamp_rot: number | null
          dp_stamp_url: string | null
          dp_stamp_w: number | null
          dp_stamp_x: number | null
          dp_stamp_y: number | null
          drive_offloaded_at: string | null
          drive_offloaded_by: string | null
          exported_at: string | null
          exported_by: string | null
          file_drive_id: string | null
          file_name: string
          file_url: string | null
          gdrive_attempt_count: number
          gdrive_file_id: string | null
          gdrive_last_attempt_at: string | null
          gdrive_last_error: string | null
          gdrive_sync_status: string
          gdrive_web_view_link: string | null
          hod_approved_at: string | null
          hod_approved_by: string | null
          hod_autofill: boolean | null
          hod_sig_h: number | null
          hod_sig_opacity: number | null
          hod_sig_page: number | null
          hod_sig_rot: number | null
          hod_sig_w: number | null
          hod_sig_x: number | null
          hod_sig_y: number | null
          hod_signature_url: string | null
          hod_stamp_h: number | null
          hod_stamp_opacity: number | null
          hod_stamp_page: number | null
          hod_stamp_rot: number | null
          hod_stamp_url: string | null
          hod_stamp_w: number | null
          hod_stamp_x: number | null
          hod_stamp_y: number | null
          id: string
          iqa_archived_by: string | null
          iqa_autofill: boolean | null
          iqa_sig_h: number | null
          iqa_sig_opacity: number | null
          iqa_sig_page: number | null
          iqa_sig_rot: number | null
          iqa_sig_w: number | null
          iqa_sig_x: number | null
          iqa_sig_y: number | null
          iqa_signature_url: string | null
          iqa_stamp_h: number | null
          iqa_stamp_opacity: number | null
          iqa_stamp_page: number | null
          iqa_stamp_rot: number | null
          iqa_stamp_url: string | null
          iqa_stamp_w: number | null
          iqa_stamp_x: number | null
          iqa_stamp_y: number | null
          module_number: number | null
          rejection_reason: string | null
          return_note: string | null
          returned_at: string | null
          returned_by: string | null
          session_index: number | null
          session_term: string | null
          session_year: number | null
          sessions_per_week: number | null
          signed_file_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          storage_tier: string
          submission_type: Database["public"]["Enums"]["submission_type"]
          submitted_at: string
          term_number: number | null
          trainer_id: string
          unit_code: string | null
          unit_name: string | null
          updated_at: string
          verified_by_hod_at: string | null
          week_number: number | null
        }
        Insert: {
          approved_by_dp_academics_at?: string | null
          archived_at?: string | null
          assignment_id?: string | null
          class_code?: string | null
          course_type?: string | null
          created_at?: string
          department: string
          document_type: Database["public"]["Enums"]["document_type"]
          dp_approved_at?: string | null
          dp_approved_by?: string | null
          dp_autofill?: boolean | null
          dp_sig_h?: number | null
          dp_sig_opacity?: number | null
          dp_sig_page?: number | null
          dp_sig_rot?: number | null
          dp_sig_w?: number | null
          dp_sig_x?: number | null
          dp_sig_y?: number | null
          dp_signature_url?: string | null
          dp_stamp_h?: number | null
          dp_stamp_opacity?: number | null
          dp_stamp_page?: number | null
          dp_stamp_rot?: number | null
          dp_stamp_url?: string | null
          dp_stamp_w?: number | null
          dp_stamp_x?: number | null
          dp_stamp_y?: number | null
          drive_offloaded_at?: string | null
          drive_offloaded_by?: string | null
          exported_at?: string | null
          exported_by?: string | null
          file_drive_id?: string | null
          file_name: string
          file_url?: string | null
          gdrive_attempt_count?: number
          gdrive_file_id?: string | null
          gdrive_last_attempt_at?: string | null
          gdrive_last_error?: string | null
          gdrive_sync_status?: string
          gdrive_web_view_link?: string | null
          hod_approved_at?: string | null
          hod_approved_by?: string | null
          hod_autofill?: boolean | null
          hod_sig_h?: number | null
          hod_sig_opacity?: number | null
          hod_sig_page?: number | null
          hod_sig_rot?: number | null
          hod_sig_w?: number | null
          hod_sig_x?: number | null
          hod_sig_y?: number | null
          hod_signature_url?: string | null
          hod_stamp_h?: number | null
          hod_stamp_opacity?: number | null
          hod_stamp_page?: number | null
          hod_stamp_rot?: number | null
          hod_stamp_url?: string | null
          hod_stamp_w?: number | null
          hod_stamp_x?: number | null
          hod_stamp_y?: number | null
          id?: string
          iqa_archived_by?: string | null
          iqa_autofill?: boolean | null
          iqa_sig_h?: number | null
          iqa_sig_opacity?: number | null
          iqa_sig_page?: number | null
          iqa_sig_rot?: number | null
          iqa_sig_w?: number | null
          iqa_sig_x?: number | null
          iqa_sig_y?: number | null
          iqa_signature_url?: string | null
          iqa_stamp_h?: number | null
          iqa_stamp_opacity?: number | null
          iqa_stamp_page?: number | null
          iqa_stamp_rot?: number | null
          iqa_stamp_url?: string | null
          iqa_stamp_w?: number | null
          iqa_stamp_x?: number | null
          iqa_stamp_y?: number | null
          module_number?: number | null
          rejection_reason?: string | null
          return_note?: string | null
          returned_at?: string | null
          returned_by?: string | null
          session_index?: number | null
          session_term?: string | null
          session_year?: number | null
          sessions_per_week?: number | null
          signed_file_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_tier?: string
          submission_type: Database["public"]["Enums"]["submission_type"]
          submitted_at?: string
          term_number?: number | null
          trainer_id: string
          unit_code?: string | null
          unit_name?: string | null
          updated_at?: string
          verified_by_hod_at?: string | null
          week_number?: number | null
        }
        Update: {
          approved_by_dp_academics_at?: string | null
          archived_at?: string | null
          assignment_id?: string | null
          class_code?: string | null
          course_type?: string | null
          created_at?: string
          department?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          dp_approved_at?: string | null
          dp_approved_by?: string | null
          dp_autofill?: boolean | null
          dp_sig_h?: number | null
          dp_sig_opacity?: number | null
          dp_sig_page?: number | null
          dp_sig_rot?: number | null
          dp_sig_w?: number | null
          dp_sig_x?: number | null
          dp_sig_y?: number | null
          dp_signature_url?: string | null
          dp_stamp_h?: number | null
          dp_stamp_opacity?: number | null
          dp_stamp_page?: number | null
          dp_stamp_rot?: number | null
          dp_stamp_url?: string | null
          dp_stamp_w?: number | null
          dp_stamp_x?: number | null
          dp_stamp_y?: number | null
          drive_offloaded_at?: string | null
          drive_offloaded_by?: string | null
          exported_at?: string | null
          exported_by?: string | null
          file_drive_id?: string | null
          file_name?: string
          file_url?: string | null
          gdrive_attempt_count?: number
          gdrive_file_id?: string | null
          gdrive_last_attempt_at?: string | null
          gdrive_last_error?: string | null
          gdrive_sync_status?: string
          gdrive_web_view_link?: string | null
          hod_approved_at?: string | null
          hod_approved_by?: string | null
          hod_autofill?: boolean | null
          hod_sig_h?: number | null
          hod_sig_opacity?: number | null
          hod_sig_page?: number | null
          hod_sig_rot?: number | null
          hod_sig_w?: number | null
          hod_sig_x?: number | null
          hod_sig_y?: number | null
          hod_signature_url?: string | null
          hod_stamp_h?: number | null
          hod_stamp_opacity?: number | null
          hod_stamp_page?: number | null
          hod_stamp_rot?: number | null
          hod_stamp_url?: string | null
          hod_stamp_w?: number | null
          hod_stamp_x?: number | null
          hod_stamp_y?: number | null
          id?: string
          iqa_archived_by?: string | null
          iqa_autofill?: boolean | null
          iqa_sig_h?: number | null
          iqa_sig_opacity?: number | null
          iqa_sig_page?: number | null
          iqa_sig_rot?: number | null
          iqa_sig_w?: number | null
          iqa_sig_x?: number | null
          iqa_sig_y?: number | null
          iqa_signature_url?: string | null
          iqa_stamp_h?: number | null
          iqa_stamp_opacity?: number | null
          iqa_stamp_page?: number | null
          iqa_stamp_rot?: number | null
          iqa_stamp_url?: string | null
          iqa_stamp_w?: number | null
          iqa_stamp_x?: number | null
          iqa_stamp_y?: number | null
          module_number?: number | null
          rejection_reason?: string | null
          return_note?: string | null
          returned_at?: string | null
          returned_by?: string | null
          session_index?: number | null
          session_term?: string | null
          session_year?: number | null
          sessions_per_week?: number | null
          signed_file_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_tier?: string
          submission_type?: Database["public"]["Enums"]["submission_type"]
          submitted_at?: string
          term_number?: number | null
          trainer_id?: string
          unit_code?: string | null
          unit_name?: string | null
          updated_at?: string
          verified_by_hod_at?: string | null
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_folder_map: {
        Row: {
          department: string | null
          folder_id: string
          folder_name: string | null
          id: string
          scope: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          department?: string | null
          folder_id: string
          folder_name?: string | null
          id?: string
          scope: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          department?: string | null
          folder_id?: string
          folder_name?: string | null
          id?: string
          scope?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      export_progress: {
        Row: {
          actor: string | null
          department: string | null
          finished_at: string | null
          id: string
          job_id: string
          kind: string
          message: string | null
          phase: string
          processed: number
          retries: number
          session_term: string | null
          session_year: number | null
          skipped: number
          started_at: string
          total: number
          updated_at: string
        }
        Insert: {
          actor?: string | null
          department?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          kind: string
          message?: string | null
          phase?: string
          processed?: number
          retries?: number
          session_term?: string | null
          session_year?: number | null
          skipped?: number
          started_at?: string
          total?: number
          updated_at?: string
        }
        Update: {
          actor?: string | null
          department?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          kind?: string
          message?: string | null
          phase?: string
          processed?: number
          retries?: number
          session_term?: string | null
          session_year?: number | null
          skipped?: number
          started_at?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      integration_health_runs: {
        Row: {
          actor: string | null
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          started_at: string
          status: string
          steps: Json
        }
        Insert: {
          actor?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          started_at?: string
          status: string
          steps?: Json
        }
        Update: {
          actor?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          started_at?: string
          status?: string
          steps?: Json
        }
        Relationships: []
      }
      offload_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          cron_schedule: string
          department: string
          enabled: boolean
          id: string
          last_result: Json | null
          last_run_at: string | null
          max_files_per_run: number
          min_age_days: number
          only_tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cron_schedule?: string
          department: string
          enabled?: boolean
          id?: string
          last_result?: Json | null
          last_run_at?: string | null
          max_files_per_run?: number
          min_age_days?: number
          only_tier?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cron_schedule?: string
          department?: string
          enabled?: boolean
          id?: string
          last_result?: Json | null
          last_run_at?: string | null
          max_files_per_run?: number
          min_age_days?: number
          only_tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          default_sig_h: number | null
          default_sig_opacity: number | null
          default_sig_rot: number | null
          default_sig_w: number | null
          default_stamp_h: number | null
          default_stamp_opacity: number | null
          default_stamp_rot: number | null
          default_stamp_w: number | null
          department: string | null
          email: string
          full_name: string
          id: string
          is_test_user: boolean
          pf_number: string | null
          preferred_stamp_mode: string
          signature_url: string | null
          stamp_required: boolean
          stamp_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_sig_h?: number | null
          default_sig_opacity?: number | null
          default_sig_rot?: number | null
          default_sig_w?: number | null
          default_stamp_h?: number | null
          default_stamp_opacity?: number | null
          default_stamp_rot?: number | null
          default_stamp_w?: number | null
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          is_test_user?: boolean
          pf_number?: string | null
          preferred_stamp_mode?: string
          signature_url?: string | null
          stamp_required?: boolean
          stamp_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_sig_h?: number | null
          default_sig_opacity?: number | null
          default_sig_rot?: number | null
          default_sig_w?: number | null
          default_stamp_h?: number | null
          default_stamp_opacity?: number | null
          default_stamp_rot?: number | null
          default_stamp_w?: number | null
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          is_test_user?: boolean
          pf_number?: string | null
          preferred_stamp_mode?: string
          signature_url?: string | null
          stamp_required?: boolean
          stamp_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_change_audit: {
        Row: {
          action: string
          changed_by: string | null
          changed_by_email: string | null
          created_at: string
          id: string
          new_value: string | null
          old_value: string | null
          target_email: string | null
          target_name: string | null
          target_user_id: string
        }
        Insert: {
          action: string
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          target_email?: string | null
          target_name?: string | null
          target_user_id: string
        }
        Update: {
          action?: string
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          target_email?: string | null
          target_name?: string | null
          target_user_id?: string
        }
        Relationships: []
      }
      sla_targets: {
        Row: {
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          id: string
          notes: string | null
          stage: string
          target_hours: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          document_type: Database["public"]["Enums"]["document_type"]
          id?: string
          notes?: string | null
          stage: string
          target_hours: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          notes?: string | null
          stage?: string
          target_hours?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          id: number
          lock_active: boolean
          lock_reason: string | null
          locked_at: string | null
          locked_by: string | null
          locked_by_email: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          lock_active?: boolean
          lock_reason?: string | null
          locked_at?: string | null
          locked_by?: string | null
          locked_by_email?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          lock_active?: boolean
          lock_reason?: string | null
          locked_at?: string | null
          locked_by?: string | null
          locked_by_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      teaching_assignments: {
        Row: {
          academic_year: string
          class_code: string
          created_at: string
          department: string
          id: string
          term: string
          trainer_id: string
          unit_code: string
          unit_name: string
          updated_at: string
        }
        Insert: {
          academic_year?: string
          class_code: string
          created_at?: string
          department: string
          id?: string
          term?: string
          trainer_id: string
          unit_code: string
          unit_name: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_code?: string
          created_at?: string
          department?: string
          id?: string
          term?: string
          trainer_id?: string
          unit_code?: string
          unit_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      unit_session_config: {
        Row: {
          class_code: string | null
          course_type: string
          created_at: string
          department: string
          id: string
          module_number: number | null
          session_term: string
          session_year: number
          sessions_per_week: number
          term_number: number | null
          trainer_id: string
          unit_code: string
          unit_name: string | null
          updated_at: string
        }
        Insert: {
          class_code?: string | null
          course_type?: string
          created_at?: string
          department: string
          id?: string
          module_number?: number | null
          session_term: string
          session_year: number
          sessions_per_week?: number
          term_number?: number | null
          trainer_id: string
          unit_code: string
          unit_name?: string | null
          updated_at?: string
        }
        Update: {
          class_code?: string | null
          course_type?: string
          created_at?: string
          department?: string
          id?: string
          module_number?: number | null
          session_term?: string
          session_year?: number
          sessions_per_week?: number
          term_number?: number | null
          trainer_id?: string
          unit_code?: string
          unit_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_pack_assignees: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          email_sent_at: string | null
          first_opened_at: string | null
          id: string
          pack_id: string
          reminder_sent_at: string | null
          verifier_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          email_sent_at?: string | null
          first_opened_at?: string | null
          id?: string
          pack_id: string
          reminder_sent_at?: string | null
          verifier_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          email_sent_at?: string | null
          first_opened_at?: string | null
          id?: string
          pack_id?: string
          reminder_sent_at?: string | null
          verifier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_pack_assignees_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "verification_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_pack_assignees_verifier_id_fkey"
            columns: ["verifier_id"]
            isOneToOne: false
            referencedRelation: "verifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_packs: {
        Row: {
          created_at: string
          created_by: string
          department: string
          download_count: number
          expires_at: string
          id: string
          include_text_only_fallbacks: boolean
          included_document_types: string[] | null
          revoked_at: string | null
          session_term: string
          session_year: number
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          department: string
          download_count?: number
          expires_at?: string
          id?: string
          include_text_only_fallbacks?: boolean
          included_document_types?: string[] | null
          revoked_at?: string | null
          session_term: string
          session_year: number
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          department?: string
          download_count?: number
          expires_at?: string
          id?: string
          include_text_only_fallbacks?: boolean
          included_document_types?: string[] | null
          revoked_at?: string | null
          session_term?: string
          session_year?: number
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      verifier_reviews: {
        Row: {
          decision: Database["public"]["Enums"]["verifier_decision"]
          document_id: string
          id: string
          notes: string | null
          pack_id: string
          reviewed_at: string
          updated_at: string
          verifier_id: string | null
        }
        Insert: {
          decision: Database["public"]["Enums"]["verifier_decision"]
          document_id: string
          id?: string
          notes?: string | null
          pack_id: string
          reviewed_at?: string
          updated_at?: string
          verifier_id?: string | null
        }
        Update: {
          decision?: Database["public"]["Enums"]["verifier_decision"]
          document_id?: string
          id?: string
          notes?: string | null
          pack_id?: string
          reviewed_at?: string
          updated_at?: string
          verifier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verifier_reviews_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifier_reviews_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "verification_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifier_reviews_verifier_id_fkey"
            columns: ["verifier_id"]
            isOneToOne: false
            referencedRelation: "verifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      verifiers: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          departments: string[]
          email: string
          full_name: string
          id: string
          notes: string | null
          organisation: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          departments?: string[]
          email: string
          full_name: string
          id?: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          departments?: string[]
          email?: string
          full_name?: string
          id?: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_super_admin: { Args: { target_email: string }; Returns: Json }
      can_stamp_document_file: { Args: { _path: string }; Returns: boolean }
      document_pack_timeline: { Args: { _document_id: string }; Returns: Json }
      get_system_lock_public: {
        Args: never
        Returns: {
          lock_active: boolean
          lock_reason: string
          locked_at: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      verification_pack_stats: {
        Args: { _capacity?: number; _department?: string }
        Returns: Json
      }
      verification_pack_stats_by_dept: {
        Args: { _capacity?: number }
        Returns: {
          active: number
          capacity: number
          department: string
          expired: number
          next_expiry: string
          remaining_capacity: number
          revoked: number
          total_downloads: number
          total_packs: number
        }[]
      }
    }
    Enums: {
      app_role: "TRAINER" | "HOD" | "DP_ACADEMICS" | "IQA" | "SUPER_ADMIN"
      document_status:
        | "SUBMITTED"
        | "HOD_APPROVED"
        | "DP_APPROVED"
        | "ARCHIVED"
        | "REJECTED"
        | "EXPORTED"
      document_type:
        | "Learning Plan"
        | "Personal Timetable"
        | "Workload Allocation"
        | "Scheme of Work"
        | "Session Plan"
        | "Class Attendance"
        | "Course Outline"
      submission_type: "ONE_TIME" | "WEEKLY"
      verifier_decision: "APPROVED" | "QUERY" | "REJECTED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["TRAINER", "HOD", "DP_ACADEMICS", "IQA", "SUPER_ADMIN"],
      document_status: [
        "SUBMITTED",
        "HOD_APPROVED",
        "DP_APPROVED",
        "ARCHIVED",
        "REJECTED",
        "EXPORTED",
      ],
      document_type: [
        "Learning Plan",
        "Personal Timetable",
        "Workload Allocation",
        "Scheme of Work",
        "Session Plan",
        "Class Attendance",
        "Course Outline",
      ],
      submission_type: ["ONE_TIME", "WEEKLY"],
      verifier_decision: ["APPROVED", "QUERY", "REJECTED"],
    },
  },
} as const
