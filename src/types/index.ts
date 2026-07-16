export type UserRole = 'manager' | 'employee';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
  email?: string; // Loaded dynamically if needed
}

export interface EmployeeAvailability {
  id: string;
  employee_id: string;
  day_of_week: number; // 0 = Mon, ..., 6 = Sun
  available: boolean;
  earliest_start: string | null; // TIME format e.g. "09:00:00"
  latest_end: string | null;     // TIME format e.g. "17:00:00"
  created_at: string;
  updated_at: string;
}

export interface ScheduleWeek {
  id: string;
  week_start: string; // "YYYY-MM-DD"
  status: 'draft' | 'published';
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shift {
  id: string;
  schedule_week_id: string;
  employee_id: string;
  shift_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:MM:SS" or "HH:MM"
  end_time: string;   // "HH:MM:SS" or "HH:MM"
  position: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  
  // Optional relations
  profiles?: Profile;
}

export interface ScheduleAcknowledgment {
  id: string;
  schedule_week_id: string;
  employee_id: string;
  acknowledged_at: string;
  
  // Optional relations
  profiles?: Profile;
}

export interface WeekOverviewStats {
  weekStart: string;
  status: 'draft' | 'published';
  activeEmployeesCount: number;
  scheduledShiftsCount: number;
  totalLaborHours: number;
  acknowledgedCount: number;
}
