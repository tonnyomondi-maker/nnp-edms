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
          exported_at: string | null
          exported_by: string | null
          file_drive_id: string | null
          file_name: string
          file_url: string | null
          gdrive_file_id: string | null
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
          session_index: number | null
          session_term: string | null
          session_year: number | null
          sessions_per_week: number | null
          signed_file_url: string | null
          status: Database["public"]["Enums"]["document_status"]
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
          exported_at?: string | null
          exported_by?: string | null
          file_drive_id?: string | null
          file_name: string
          file_url?: string | null
          gdrive_file_id?: string | null
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
          session_index?: number | null
          session_term?: string | null
          session_year?: number | null
          sessions_per_week?: number | null
          signed_file_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
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
          exported_at?: string | null
          exported_by?: string | null
          file_drive_id?: string | null
          file_name?: string
          file_url?: string | null
          gdrive_file_id?: string | null
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
          session_index?: number | null
          session_term?: string | null
          session_year?: number | null
          sessions_per_week?: number | null
          signed_file_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
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
      profiles: {
        Row: {
          created_at: string
          department: string | null
          email: string
          full_name: string
          id: string
          is_test_user: boolean
          pf_number: string | null
          signature_url: string | null
          stamp_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          is_test_user?: boolean
          pf_number?: string | null
          signature_url?: string | null
          stamp_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          is_test_user?: boolean
          pf_number?: string | null
          signature_url?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_super_admin: { Args: { target_email: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
    },
  },
} as const
