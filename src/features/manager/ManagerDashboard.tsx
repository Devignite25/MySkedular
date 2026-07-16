import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import {
  calculateShiftDuration,
  detectOverlappingShifts,
  checkAvailabilityConflicts,
  validateWeeklyHoursLimit,
  parseTimeToMinutes
} from '../../utils/schedulingRules';
import {
  getMonday,
  addDays,
  formatDateString,
  formatTimeString,
  getWeekDays,
  DAY_NAMES
} from '../../utils/dateUtils';
import type { Profile, EmployeeAvailability, ScheduleWeek, Shift, ScheduleAcknowledgment } from '../../types';
import {
  Calendar,
  Users,
  CheckSquare,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Send,
  EyeOff,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  LogOut,
  UserPlus,
  Lock,
  Mail,
  User,
  Shield,
  WifiOff
} from 'lucide-react';

export const ManagerDashboard: React.FC = () => {
  const { signOut, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'scheduler' | 'employees' | 'acknowledgments'>('overview');
  
  // Data State
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [availabilities, setAvailabilities] = useState<EmployeeAvailability[]>([]);
  const [weeks, setWeeks] = useState<ScheduleWeek[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<ScheduleWeek | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [acknowledgments, setAcknowledgments] = useState<ScheduleAcknowledgment[]>([]);
  
  // App UI State
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Modals
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteName, setInviteName] = useState('');

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [shiftEmployeeId, setShiftEmployeeId] = useState('');
  const [shiftDate, setShiftDate] = useState('');
  const [shiftStartTime, setShiftStartTime] = useState('09:00');
  const [shiftEndTime, setShiftEndTime] = useState('17:00');
  const [shiftPosition, setShiftPosition] = useState('FOH');
  const [shiftNotes, setShiftNotes] = useState('');

  const [editingEmployeeAvail, setEditingEmployeeAvail] = useState<Profile | null>(null);
  const [tempAvailabilities, setTempAvailabilities] = useState<EmployeeAvailability[]>([]);

  // Validation Panel
  const [validationResults, setValidationResults] = useState<{
    errors: string[];
    warnings: string[];
    canPublish: boolean;
  }>({ errors: [], warnings: [], canPublish: true });

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch initial data
  useEffect(() => {
    fetchInitialData();
  }, []);

  // Fetch shifts/acknowledgments when selectedWeek changes
  useEffect(() => {
    if (selectedWeek) {
      fetchWeekData(selectedWeek.id);
    } else {
      setShifts([]);
      setAcknowledgments([]);
    }
  }, [selectedWeek]);

  // Run validation checks when shifts or selectedWeek updates
  useEffect(() => {
    runScheduleValidations();
  }, [shifts, selectedWeek, availabilities, employees]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Employees
      const { data: empData, error: empError } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name');
      if (empError) throw empError;
      setEmployees(empData || []);

      // 2. Fetch Availabilities
      const { data: availData, error: availError } = await supabase
        .from('employee_availability')
        .select('*');
      if (availError) throw availError;
      setAvailabilities(availData || []);

      // 3. Fetch Schedule Weeks
      const { data: weekData, error: weekError } = await supabase
        .from('schedule_weeks')
        .select('*')
        .order('week_start', { ascending: false });
      if (weekError) throw weekError;
      setWeeks(weekData || []);

      // Set default selected week to current or latest
      if (weekData && weekData.length > 0) {
        // Try to find the week starting nearest to today
        const todayMonday = getMonday(new Date());
        const matchingWeek = weekData.find(w => w.week_start === todayMonday);
        setSelectedWeek(matchingWeek || weekData[0]);
      } else {
        setSelectedWeek(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error fetching data.');
    } finally {
      setLoading(false);
    }
  };

  const fetchWeekData = async (weekId: string) => {
    try {
      // Fetch Shifts
      const { data: shiftData, error: shiftError } = await supabase
        .from('shifts')
        .select('*, profiles(*)')
        .eq('schedule_week_id', weekId);
      if (shiftError) throw shiftError;
      setShifts(shiftData || []);

      // Fetch Acknowledgments
      const { data: ackData, error: ackError } = await supabase
        .from('schedule_acknowledgments')
        .select('*, profiles(*)')
        .eq('schedule_week_id', weekId);
      if (ackError) throw ackError;
      setAcknowledgments(ackData || []);
    } catch (err: any) {
      showToast(err.message || 'Error loading week data.', 'error');
    }
  };

  const showToast = (msg: string, type: 'success' | 'error') => {
    if (type === 'success') {
      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 4000);
    }
  };

  const handleCreateDraftWeek = async () => {
    if (isOffline) return;
    setActionLoading(true);
    try {
      // Find what the next week start date should be: the week after the latest
      // existing week, but never earlier than the current week's Monday (so a
      // stale schedule from months ago doesn't produce a draft in the past).
      let nextMondayStr = getMonday(new Date());
      if (weeks.length > 0) {
        const sortedWeeks = [...weeks].sort((a, b) => b.week_start.localeCompare(a.week_start));
        const candidate = addDays(sortedWeeks[0].week_start, 7);
        if (candidate.localeCompare(nextMondayStr) > 0) {
          nextMondayStr = candidate;
        }
      }

      const { data, error } = await supabase
        .from('schedule_weeks')
        .insert({
          week_start: nextMondayStr,
          status: 'draft',
          created_by: profile?.id
        })
        .select()
        .single();

      if (error) throw error;
      
      setWeeks([data, ...weeks]);
      setSelectedWeek(data);
      showToast(`Created draft week starting ${formatDateString(nextMondayStr)}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to create draft week.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleInviteEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) return;
    setActionLoading(true);
    try {
      const { error } = await supabase.rpc('create_employee_account', {
        p_email: inviteEmail,
        p_password: invitePassword,
        p_full_name: inviteName
      });

      if (error) throw error;

      showToast(`Invited ${inviteName} successfully!`, 'success');
      setIsInviteModalOpen(false);
      
      // Reset form
      setInviteEmail('');
      setInvitePassword('');
      setInviteName('');
      
      // Reload employees
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Failed to invite employee.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleEmployeeActive = async (employeeId: string, currentActive: boolean) => {
    if (isOffline) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ active: !currentActive })
        .eq('id', employeeId);

      if (error) throw error;
      
      setEmployees(employees.map(e => e.id === employeeId ? { ...e, active: !currentActive } : e));
      showToast(`Employee status updated.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update employee status.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditAvailability = (emp: Profile) => {
    setEditingEmployeeAvail(emp);
    const empAvails = availabilities.filter(a => a.employee_id === emp.id);
    // Ensure all 7 days exist in local state
    const fullAvails = Array.from({ length: 7 }, (_, day) => {
      const existing = empAvails.find(a => a.day_of_week === day);
      return existing || {
        id: '',
        employee_id: emp.id,
        day_of_week: day,
        available: true,
        earliest_start: '09:00:00',
        latest_end: '17:00:00',
        created_at: '',
        updated_at: ''
      };
    });
    setTempAvailabilities(fullAvails);
  };

  const handleSaveAvailability = async () => {
    if (isOffline) return;
    setActionLoading(true);
    try {
      for (const av of tempAvailabilities) {
        // Validate end time > start time
        if (av.available && av.earliest_start && av.latest_end) {
          const start = parseTimeToMinutes(av.earliest_start);
          const end = parseTimeToMinutes(av.latest_end);
          if (end <= start) {
            throw new Error(`Earliest start must be before latest end on ${DAY_NAMES[av.day_of_week]}`);
          }
        }

        const payload = {
          employee_id: av.employee_id,
          day_of_week: av.day_of_week,
          available: av.available,
          earliest_start: av.available ? av.earliest_start : null,
          latest_end: av.available ? av.latest_end : null
        };

        if (av.id) {
          const { error } = await supabase
            .from('employee_availability')
            .update(payload)
            .eq('id', av.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('employee_availability')
            .insert(payload);
          if (error) throw error;
        }
      }

      showToast('Availability updated successfully.', 'success');
      setEditingEmployeeAvail(null);
      // Reload availability list
      const { data: availData } = await supabase.from('employee_availability').select('*');
      setAvailabilities(availData || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to update availability.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Shift Management
  const handleOpenAddShift = (dateStr: string) => {
    setEditingShift(null);
    setShiftEmployeeId(employees.find(e => e.active)?.id || '');
    setShiftDate(dateStr);
    setShiftStartTime('09:00');
    setShiftEndTime('17:00');
    setShiftPosition('Cook');
    setShiftNotes('');
    setIsShiftModalOpen(true);
  };

  const handleOpenEditShift = (shift: Shift) => {
    setEditingShift(shift);
    setShiftEmployeeId(shift.employee_id);
    setShiftDate(shift.shift_date);
    // Strip seconds from "HH:MM:SS"
    setShiftStartTime(shift.start_time.substring(0, 5));
    setShiftEndTime(shift.end_time.substring(0, 5));
    setShiftPosition(shift.position);
    setShiftNotes(shift.notes || '');
    setIsShiftModalOpen(true);
  };

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) return;
    if (!selectedWeek) return;

    // Client checks before DB write (blocking)
    if (parseTimeToMinutes(shiftEndTime) <= parseTimeToMinutes(shiftStartTime)) {
      showToast('End time must be later than start time.', 'error');
      return;
    }

    const duration = calculateShiftDuration(shiftStartTime, shiftEndTime);
    
    // Check overlapping shifts
    const otherShifts = shifts.filter(s => s.id !== editingShift?.id);
    const dayShifts = otherShifts.filter(s => s.shift_date === shiftDate);
    const wouldOverlap = detectOverlappingShifts(shiftEmployeeId, [
      ...dayShifts,
      { id: editingShift?.id, employee_id: shiftEmployeeId, start_time: shiftStartTime, end_time: shiftEndTime, shift_date: shiftDate }
    ]);
    
    if (wouldOverlap) {
      showToast('Cannot schedule overlapping shifts for the same employee.', 'error');
      return;
    }

    // Check weekly 39 hours limit
    const wouldExceedLimit = validateWeeklyHoursLimit(
      otherShifts,
      shiftEmployeeId,
      duration
    );

    if (wouldExceedLimit) {
      showToast('Cannot schedule employee for more than 39 hours in a single week.', 'error');
      return;
    }

    // Check if employee is inactive
    const emp = employees.find(e => e.id === shiftEmployeeId);
    if (!emp?.active) {
      showToast('Cannot schedule an inactive employee.', 'error');
      return;
    }

    setActionLoading(true);
    try {
      const payload = {
        schedule_week_id: selectedWeek.id,
        employee_id: shiftEmployeeId,
        shift_date: shiftDate,
        start_time: shiftStartTime,
        end_time: shiftEndTime,
        position: shiftPosition,
        notes: shiftNotes || null
      };

      if (editingShift) {
        const { error } = await supabase
          .from('shifts')
          .update(payload)
          .eq('id', editingShift.id);
        if (error) throw error;
        showToast('Shift updated.', 'success');
      } else {
        const { error } = await supabase
          .from('shifts')
          .insert(payload);
        if (error) throw error;
        showToast('Shift added.', 'success');
      }

      setIsShiftModalOpen(false);
      fetchWeekData(selectedWeek.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to save shift.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (isOffline) return;
    if (!confirm('Are you sure you want to delete this shift?')) return;
    
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('shifts')
        .delete()
        .eq('id', shiftId);
      if (error) throw error;
      
      showToast('Shift deleted.', 'success');
      if (selectedWeek) fetchWeekData(selectedWeek.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete shift.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyPreviousWeek = async () => {
    if (isOffline) return;
    if (!selectedWeek) return;

    // Find previous week. Week start date - 7 days.
    const prevWeekStart = addDays(selectedWeek.week_start, -7);
    const prevWeek = weeks.find(w => w.week_start === prevWeekStart);

    if (!prevWeek) {
      showToast(`No schedule week found starting on ${formatDateString(prevWeekStart)} to copy from.`, 'error');
      return;
    }

    if (shifts.length > 0 && !confirm('This will overwrite any existing shifts in the selected week. Continue?')) {
      return;
    }

    setActionLoading(true);
    try {
      // Copy runs server-side in a single transaction: if any copied shift
      // fails validation, the target week's existing shifts are untouched.
      const { data: copiedCount, error: copyError } = await supabase
        .rpc('copy_week_shifts', {
          p_source_week_id: prevWeek.id,
          p_target_week_id: selectedWeek.id
        });

      if (copyError) throw copyError;

      showToast(`Successfully copied ${copiedCount} shifts from previous week!`, 'success');
      fetchWeekData(selectedWeek.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to copy previous week.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePublishToggle = async () => {
    if (isOffline) return;
    if (!selectedWeek) return;

    const isPublishing = selectedWeek.status === 'draft';
    
    if (isPublishing) {
      // Run block validation
      if (validationResults.errors.length > 0) {
        showToast('Please resolve all validation errors before publishing.', 'error');
        return;
      }
    }

    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from('schedule_weeks')
        .update({
          status: isPublishing ? 'published' : 'draft',
          published_at: isPublishing ? new Date().toISOString() : null
        })
        .eq('id', selectedWeek.id)
        .select()
        .single();

      if (error) throw error;
      
      setSelectedWeek(data);
      setWeeks(weeks.map(w => w.id === selectedWeek.id ? data : w));
      showToast(`Schedule ${isPublishing ? 'published' : 'unpublished'} successfully!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update schedule status.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const runScheduleValidations = () => {
    if (!selectedWeek) return;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Calculate hours per employee for validation
    const employeeHours: Record<string, number> = {};
    
    shifts.forEach(shift => {
      const emp = employees.find(e => e.id === shift.employee_id);
      const empName = emp?.full_name || 'Unknown Employee';
      const duration = calculateShiftDuration(shift.start_time, shift.end_time);

      // Rule: Employee must be active
      if (emp && !emp.active) {
        errors.push(`Blocker: ${empName} is inactive but scheduled on ${formatDateString(shift.shift_date)}`);
      }

      // Rule: Shift date belongs to week
      const weekStart = selectedWeek.week_start;
      const weekEnd = addDays(weekStart, 6);
      if (shift.shift_date < weekStart || shift.shift_date > weekEnd) {
        errors.push(`Blocker: Shift on ${formatDateString(shift.shift_date)} is outside week bounds.`);
      }

      // Accumulate hours
      employeeHours[shift.employee_id] = (employeeHours[shift.employee_id] || 0) + duration;

      // Rule: Check availability conflicts
      const empAvails = availabilities.filter(a => a.employee_id === shift.employee_id);
      const hasConflict = checkAvailabilityConflicts(shift, empAvails);
      if (hasConflict) {
        warnings.push(`Warning: ${empName} is scheduled on ${formatDateString(shift.shift_date)} (${formatTimeString(shift.start_time)} - ${formatTimeString(shift.end_time)}) outside recorded availability.`);
      }
    });

    // Rule: Validate 39-hour limit
    Object.entries(employeeHours).forEach(([empId, hours]) => {
      const emp = employees.find(e => e.id === empId);
      const empName = emp?.full_name || 'Unknown Employee';
      if (hours > 39.0) {
        errors.push(`Blocker: ${empName} exceeds 39 scheduled hours (${hours.toFixed(1)} hrs).`);
      }
    });

    // Rule: Detect overlapping shifts
    const employeeDailyShifts: Record<string, Record<string, Shift[]>> = {};
    shifts.forEach(shift => {
      if (!employeeDailyShifts[shift.employee_id]) {
        employeeDailyShifts[shift.employee_id] = {};
      }
      if (!employeeDailyShifts[shift.employee_id][shift.shift_date]) {
        employeeDailyShifts[shift.employee_id][shift.shift_date] = [];
      }
      employeeDailyShifts[shift.employee_id][shift.shift_date].push(shift);
    });

    Object.entries(employeeDailyShifts).forEach(([empId, dateMap]) => {
      const emp = employees.find(e => e.id === empId);
      const empName = emp?.full_name || 'Unknown Employee';
      Object.entries(dateMap).forEach(([date, dayShifts]) => {
        if (detectOverlappingShifts(empId, dayShifts)) {
          errors.push(`Blocker: ${empName} has overlapping shifts on ${formatDateString(date)}.`);
        }
      });
    });

    setValidationResults({
      errors,
      warnings,
      canPublish: errors.length === 0
    });
  };

  // Helper Stats Calculation
  const totalLaborHours = shifts.reduce((total, s) => total + calculateShiftDuration(s.start_time, s.end_time), 0);
  const uniqueScheduledEmployees = new Set(shifts.map(s => s.employee_id)).size;
  const activeEmployeesCount = employees.filter(e => e.active).length;

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col md:flex-row">
      
      {/* SIDEBAR NAVIGATION - DESKTOP */}
      <aside className="hidden md:flex flex-col w-64 bg-[#0f172a] border-r border-slate-800 p-6 shrink-0 justify-between">
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-wider flex items-center gap-2">
              <span>Spredsheep</span>
              <Shield className="w-5 h-5 text-indigo-400" />
            </h1>
            <p className="text-xs text-indigo-300 font-semibold tracking-wide mt-1 uppercase">Manager Control</p>
          </div>

          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-5 h-5" />
              <span>Overview</span>
            </button>
            <button
              onClick={() => setActiveTab('scheduler')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'scheduler'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Clock className="w-5 h-5" />
              <span>Weekly Scheduler</span>
            </button>
            <button
              onClick={() => setActiveTab('employees')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'employees'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Users className="w-5 h-5" />
              <span>Employees</span>
            </button>
            <button
              onClick={() => setActiveTab('acknowledgments')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'acknowledgments'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <CheckSquare className="w-5 h-5" />
              <span>Acknowledgments</span>
            </button>
          </nav>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
              {profile?.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-white truncate">{profile?.full_name}</p>
              <p className="text-xs text-slate-500 truncate">Manager</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:bg-rose-950/20 hover:text-rose-300 transition cursor-pointer"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* TOP HEADER - MOBILE & OFFLINE INDICATOR */}
      <div className="flex flex-col flex-grow">
        {isOffline && (
          <div className="bg-amber-950/80 border-b border-amber-900/60 py-2 px-4 flex items-center justify-center gap-2 text-amber-300 text-xs font-semibold">
            <WifiOff className="w-4 h-4" />
            <span>You are currently offline. Modifying schedules and updates are disabled.</span>
          </div>
        )}

        <header className="md:hidden flex items-center justify-between px-6 py-4 bg-[#0f172a] border-b border-slate-800 shrink-0">
          <span className="text-xl font-black text-white flex items-center gap-2">
            <span>Spredsheep</span>
            <Shield className="w-4 h-4 text-indigo-400" />
          </span>
          <button onClick={signOut} className="text-rose-400 p-1">
            <LogOut className="w-5 h-5" />
          </button>
        </header>

        {/* MAIN PANEL CONTENT */}
        <main className="flex-grow p-6 overflow-y-auto max-w-7xl w-full mx-auto space-y-6">
          
          {/* TOAST MESSAGES */}
          {successMessage && (
            <div className="fixed top-6 right-6 z-50 p-4 bg-emerald-950 border border-emerald-800 rounded-xl text-emerald-300 text-sm flex items-center gap-2 shadow-2xl animate-fade-in-down">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="fixed top-6 right-6 z-50 p-4 bg-red-950 border border-red-800 rounded-xl text-red-300 text-sm flex items-center gap-2 shadow-2xl animate-fade-in-down">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* WEEK PICKER PANEL */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 glass-panel rounded-2xl border border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Active Scheduling Week</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <select
                    className="bg-slate-900 border border-slate-800 text-white rounded-lg px-3 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={selectedWeek?.id || ''}
                    onChange={(e) => {
                      const wk = weeks.find(w => w.id === e.target.value);
                      if (wk) setSelectedWeek(wk);
                    }}
                  >
                    {weeks.map(w => (
                      <option key={w.id} value={w.id}>
                        Week of {formatDateString(w.week_start)} ({w.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleCreateDraftWeek}
              disabled={actionLoading || isOffline}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-semibold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/15"
            >
              <Plus className="w-4 h-4" />
              <span>New Week Draft</span>
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Labor Hours</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white">{totalLaborHours.toFixed(1)}</span>
                        <span className="text-xs text-slate-400">hrs</span>
                      </div>
                    </div>
                    <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Scheduled Shifts</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white">{shifts.length}</span>
                        <span className="text-xs text-slate-400">shifts</span>
                      </div>
                    </div>
                    <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Employees</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white">{activeEmployeesCount}</span>
                        <span className="text-xs text-slate-400">staff</span>
                      </div>
                    </div>
                    <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Acknowledgments</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white">
                          {selectedWeek?.status === 'published' ? acknowledgments.length : '0'}
                        </span>
                        <span className="text-xs text-slate-400">/ {uniqueScheduledEmployees} scheduled</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Card Summary of Active Week */}
                  {selectedWeek && (
                    <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                      <div className="space-y-1">
                        <h3 className="text-lg font-bold text-white">
                          Week of {formatDateString(selectedWeek.week_start)}
                        </h3>
                        <p className="text-sm text-slate-400">
                          Status: <span className="font-semibold text-slate-200 capitalize">{selectedWeek.status}</span>
                          {selectedWeek.published_at && ` (Published: ${new Date(selectedWeek.published_at).toLocaleString()})`}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={handlePublishToggle}
                          disabled={actionLoading || isOffline || (selectedWeek.status === 'draft' && !validationResults.canPublish)}
                          className={`px-5 py-3 rounded-xl text-sm font-semibold transition cursor-pointer flex items-center gap-2 shadow-lg ${
                            selectedWeek.status === 'draft'
                              ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/10 disabled:bg-slate-800 disabled:text-slate-500'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          {selectedWeek.status === 'draft' ? (
                            <>
                              <Send className="w-4 h-4" />
                              <span>Publish Schedule</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-4 h-4" />
                              <span>Revert to Draft</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Validation Summary Card */}
                  {selectedWeek && (
                    <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
                      <h4 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-indigo-400" />
                        <span>Schedule Safety Audit</span>
                      </h4>

                      {validationResults.errors.length === 0 && validationResults.warnings.length === 0 ? (
                        <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl text-emerald-400 text-sm flex items-center gap-3">
                          <CheckCircle className="w-5 h-5 shrink-0" />
                          <span>All safety checks passed. No overlap, hours limit, or availability conflicts found.</span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {validationResults.errors.map((err, i) => (
                            <div key={i} className="p-4 bg-red-950/20 border border-red-900/50 rounded-xl text-red-300 text-sm flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
                              <span>{err}</span>
                            </div>
                          ))}
                          {validationResults.warnings.map((warn, i) => (
                            <div key={i} className="p-4 bg-amber-950/20 border border-amber-900/50 rounded-xl text-amber-300 text-sm flex items-start gap-3">
                              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
                              <span>{warn}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: WEEKLY SCHEDULER */}
              {activeTab === 'scheduler' && selectedWeek && (
                <div className="space-y-6">
                  {/* Calendar Header Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-white">7-Day Schedule Matrix</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Matrix view for week starting {formatDateString(selectedWeek.week_start)}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopyPreviousWeek}
                        disabled={actionLoading || isOffline || selectedWeek.status !== 'draft'}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 disabled:opacity-50 text-slate-300 text-sm font-semibold rounded-xl transition flex items-center gap-2 cursor-pointer"
                        title="Copy shifts from previous week"
                      >
                        <Copy className="w-4 h-4" />
                        <span className="hidden sm:inline">Copy Previous Week</span>
                      </button>
                    </div>
                  </div>

                  {/* Calendar Grid (7 columns Monday - Sunday) */}
                  <div className="grid grid-cols-1 xl:grid-cols-7 gap-4">
                    {getWeekDays(selectedWeek.week_start).map((dayStr, idx) => {
                      const dayName = DAY_NAMES[idx];
                      const dayShifts = shifts.filter(s => s.shift_date === dayStr);
                      
                      return (
                        <div key={dayStr} className="glass-panel rounded-2xl border border-slate-800/80 flex flex-col min-h-[350px]">
                          {/* Calendar Header */}
                          <div className="p-3 bg-slate-900/60 border-b border-slate-800/60 flex justify-between items-center">
                            <div>
                              <p className="text-sm font-bold text-white">{dayName}</p>
                              <p className="text-xs text-slate-500 font-semibold">{formatDateString(dayStr)}</p>
                            </div>
                            
                            {selectedWeek.status === 'draft' && !isOffline && (
                              <button
                                onClick={() => handleOpenAddShift(dayStr)}
                                className="p-1 text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition"
                                title={`Add shift for ${dayName}`}
                              >
                                <Plus className="w-4.5 h-4.5" />
                              </button>
                            )}
                          </div>

                          {/* Shifts List */}
                          <div className="flex-grow p-3 space-y-2 overflow-y-auto">
                            {dayShifts.length === 0 ? (
                              <div className="h-full flex items-center justify-center">
                                <span className="text-xs text-slate-600 italic">No shifts scheduled</span>
                              </div>
                            ) : (
                              dayShifts.map(shift => {
                                const duration = calculateShiftDuration(shift.start_time, shift.end_time);
                                
                                return (
                                  <div
                                    key={shift.id}
                                    className="p-3 bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl space-y-2 group transition"
                                  >
                                    <div className="flex items-start justify-between gap-1">
                                      <div>
                                        <p className="text-xs font-extrabold text-white truncate max-w-[120px]">
                                          {shift.profiles?.full_name || 'Staff'}
                                        </p>
                                        <span className="inline-block text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded-md mt-1">
                                          {shift.position}
                                        </span>
                                      </div>

                                      {selectedWeek.status === 'draft' && !isOffline && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                                          <button
                                            onClick={() => handleOpenEditShift(shift)}
                                            className="p-0.5 text-slate-400 hover:text-indigo-400"
                                          >
                                            <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteShift(shift.id)}
                                            className="p-0.5 text-slate-400 hover:text-rose-400"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/40">
                                      <span className="font-medium">
                                        {formatTimeString(shift.start_time)} - {formatTimeString(shift.end_time)}
                                      </span>
                                      <span className="font-bold text-slate-500">
                                        {duration.toFixed(1)}h
                                      </span>
                                    </div>

                                    {shift.notes && (
                                      <p className="text-[10px] text-slate-500 italic border-t border-slate-800/20 pt-1 leading-normal truncate" title={shift.notes}>
                                        Note: {shift.notes}
                                      </p>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: EMPLOYEES DIRECTORY */}
              {activeTab === 'employees' && (
                <div className="space-y-6">
                  {/* Actions Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-white">Team Roster</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Manage employee list, status, and custom work availability.</p>
                    </div>

                    <button
                      onClick={() => setIsInviteModalOpen(true)}
                      disabled={actionLoading || isOffline}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-sm font-semibold rounded-xl transition flex items-center gap-2 cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Add Employee</span>
                    </button>
                  </div>

                  {/* Employees Table Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {employees.map(emp => {
                      const empAvails = availabilities.filter(a => a.employee_id === emp.id);
                      const unavailableDaysCount = empAvails.filter(a => !a.available).length;
                      
                      return (
                        <div key={emp.id} className={`glass-panel p-5 rounded-2xl border transition relative flex flex-col justify-between min-h-[220px] ${
                          emp.active ? 'border-slate-800' : 'border-slate-900/60 opacity-60'
                        }`}>
                          
                          {/* Header info */}
                          <div>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${
                                  emp.role === 'manager' ? 'bg-indigo-600/10 text-indigo-400' : 'bg-slate-800 text-slate-300'
                                }`}>
                                  {emp.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div className="overflow-hidden">
                                  <h4 className="text-base font-bold text-white truncate">{emp.full_name}</h4>
                                  <span className="inline-block text-[10px] font-bold tracking-wider uppercase text-slate-500 mt-0.5">
                                    {emp.role}
                                  </span>
                                </div>
                              </div>

                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                emp.active ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-900 text-slate-500'
                              }`}>
                                {emp.active ? 'Active' : 'Inactive'}
                              </span>
                            </div>

                            {/* Availability Summary */}
                            <div className="mt-4 space-y-1.5 border-t border-slate-800/40 pt-3">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Weekly Availability</p>
                              {emp.role === 'manager' ? (
                                <p className="text-xs text-slate-500 italic">Managers are unscheduled</p>
                              ) : (
                                <p className="text-xs text-slate-300">
                                  {unavailableDaysCount === 0
                                    ? 'Fully available (Mon - Sun)'
                                    : `Restricted (${unavailableDaysCount} unavailable days)`}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Footer Actions */}
                          {emp.role !== 'manager' && !isOffline && (
                            <div className="flex items-center gap-2 pt-4 border-t border-slate-800/40 mt-4 justify-end">
                              <button
                                onClick={() => handleEditAvailability(emp)}
                                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-bold text-slate-300 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                              >
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                <span>Availability</span>
                              </button>

                              <button
                                onClick={() => handleToggleEmployeeActive(emp.id, emp.active)}
                                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                                  emp.active
                                    ? 'bg-rose-950/20 text-rose-400 border border-rose-900/30 hover:bg-rose-950/40'
                                    : 'bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 hover:bg-emerald-950/40'
                                }`}
                              >
                                {emp.active ? 'Deactivate' : 'Activate'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 4: ACKNOWLEDGMENTS TRACKER */}
              {activeTab === 'acknowledgments' && selectedWeek && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-bold text-white">Acknowledgment Log</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Verify which employees have viewed and accepted their scheduled shifts.</p>
                  </div>

                  {selectedWeek.status === 'draft' ? (
                    <div className="glass-panel p-10 rounded-2xl border border-slate-800/80 text-center space-y-2">
                      <EyeOff className="w-10 h-10 text-slate-600 mx-auto" />
                      <h4 className="text-base font-bold text-white">Schedule is in Draft Mode</h4>
                      <p className="text-sm text-slate-500 max-w-sm mx-auto">
                        Employees cannot view draft schedules, and acknowledgments will be tracked once this schedule is published.
                      </p>
                    </div>
                  ) : (
                    <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-900/80 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            <th className="p-4">Employee Name</th>
                            <th className="p-4">Role</th>
                            <th className="p-4">Status</th>
                            <th className="p-4">Date Acknowledged</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 text-sm">
                          {employees
                            .filter(e => e.role === 'employee')
                            .map(emp => {
                              const isScheduled = shifts.some(s => s.employee_id === emp.id);
                              const ack = acknowledgments.find(a => a.employee_id === emp.id);
                              
                              if (!isScheduled) return null; // Only show scheduled employees

                              return (
                                <tr key={emp.id} className="hover:bg-slate-900/40 transition">
                                  <td className="p-4 font-bold text-white">{emp.full_name}</td>
                                  <td className="p-4 text-slate-400 text-xs uppercase">{emp.role}</td>
                                  <td className="p-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                      ack
                                        ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30'
                                        : 'bg-red-950/20 text-red-400 border border-red-900/30'
                                    }`}>
                                      {ack ? (
                                        <>
                                          <CheckCircle className="w-3.5 h-3.5" />
                                          <span>Acknowledged</span>
                                        </>
                                      ) : (
                                        <>
                                          <AlertCircle className="w-3.5 h-3.5" />
                                          <span>Unconfirmed</span>
                                        </>
                                      )}
                                    </span>
                                  </td>
                                  <td className="p-4 text-slate-400 text-xs">
                                    {ack ? new Date(ack.acknowledged_at).toLocaleString() : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* FOOTER TAB NAV FOR MOBILE */}
      <footer className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0f172a] border-t border-slate-800 py-2 px-6 flex items-center justify-between">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'overview' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span>Overview</span>
        </button>
        <button
          onClick={() => setActiveTab('scheduler')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'scheduler' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Clock className="w-5 h-5" />
          <span>Scheduler</span>
        </button>
        <button
          onClick={() => setActiveTab('employees')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'employees' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Users className="w-5 h-5" />
          <span>Employees</span>
        </button>
        <button
          onClick={() => setActiveTab('acknowledgments')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'acknowledgments' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <CheckSquare className="w-5 h-5" />
          <span>Confirm</span>
        </button>
      </footer>

      {/* MODAL 1: INVITE/CREATE EMPLOYEE */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-filter backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-2xl space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white">Create Employee Account</h3>
                <p className="text-xs text-slate-400 mt-1">This user will be added with employee credentials.</p>
              </div>
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleInviteEmployee} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Full Name</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500"><User className="w-4 h-4" /></span>
                  <input
                    type="text"
                    required
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 pl-9 pr-3 text-sm text-white focus:outline-none"
                    placeholder="Carla Smith"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email Address</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500"><Mail className="w-4 h-4" /></span>
                  <input
                    type="email"
                    required
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 pl-9 pr-3 text-sm text-white focus:outline-none"
                    placeholder="carla@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Password</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500"><Lock className="w-4 h-4" /></span>
                  <input
                    type="password"
                    required
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 pl-9 pr-3 text-sm text-white focus:outline-none"
                    placeholder="••••••••"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-grow py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold text-white transition cursor-pointer"
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm font-semibold text-slate-300 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD/EDIT SHIFT */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-filter backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-2xl space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white">{editingShift ? 'Edit Shift' : 'Add New Shift'}</h3>
                <p className="text-xs text-slate-400 mt-1">Assign an employee to a shift date and position block.</p>
              </div>
              <button
                onClick={() => setIsShiftModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveShift} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Assign Employee</label>
                <select
                  required
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none"
                  value={shiftEmployeeId}
                  onChange={(e) => setShiftEmployeeId(e.target.value)}
                >
                  {employees
                    .filter(e => e.role === 'employee' && e.active)
                    .map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Start Time</label>
                  <input
                    type="time"
                    required
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 px-3 text-sm text-white focus:outline-none"
                    value={shiftStartTime}
                    onChange={(e) => setShiftStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">End Time</label>
                  <input
                    type="time"
                    required
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 px-3 text-sm text-white focus:outline-none"
                    value={shiftEndTime}
                    onChange={(e) => setShiftEndTime(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Position</label>
                <select
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none"
                  value={shiftPosition}
                  onChange={(e) => setShiftPosition(e.target.value)}
                >
                  <option value="Lead">Lead</option>
                  <option value="FOH">FOH</option>
                  <option value="Opener">Opener</option>
                  <option value="Closer">Closer</option>
                  <option value="Cook">Cook</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Notes (Optional)</label>
                <textarea
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 px-3 text-sm text-white focus:outline-none h-20 resize-none"
                  placeholder="e.g. Bring keycard, register setup..."
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-grow py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold text-white transition cursor-pointer"
                >
                  {editingShift ? 'Save Changes' : 'Create Shift'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsShiftModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm font-semibold text-slate-300 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT AVAILABILITY (MANAGER EDITING EMPLOYEE) */}
      {editingEmployeeAvail && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-filter backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white">Edit Availability: {editingEmployeeAvail.full_name}</h3>
                <p className="text-xs text-slate-400 mt-1">Configure permitted hourly scheduling ranges for each weekday.</p>
              </div>
              <button
                onClick={() => setEditingEmployeeAvail(null)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {tempAvailabilities.map((av, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-indigo-600 bg-slate-900 border-slate-800 rounded focus:ring-indigo-500"
                      checked={av.available}
                      onChange={(e) => {
                        setTempAvailabilities(tempAvailabilities.map((item, d) => 
                          d === idx ? { ...item, available: e.target.checked } : item
                        ));
                      }}
                    />
                    <span className="text-sm font-bold text-white w-24">{DAY_NAMES[idx]}</span>
                  </div>

                  {av.available ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none"
                        value={av.earliest_start?.substring(0, 5) || '09:00'}
                        onChange={(e) => {
                          setTempAvailabilities(tempAvailabilities.map((item, d) => 
                            d === idx ? { ...item, earliest_start: e.target.value + ':00' } : item
                          ));
                        }}
                      />
                      <span className="text-xs text-slate-500">to</span>
                      <input
                        type="time"
                        className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none"
                        value={av.latest_end?.substring(0, 5) || '17:00'}
                        onChange={(e) => {
                          setTempAvailabilities(tempAvailabilities.map((item, d) => 
                            d === idx ? { ...item, latest_end: e.target.value + ':00' } : item
                          ));
                        }}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 italic">Unavailable all day</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleSaveAvailability}
                disabled={actionLoading}
                className="flex-grow py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold text-white transition cursor-pointer"
              >
                Save Availability
              </button>
              <button
                type="button"
                onClick={() => setEditingEmployeeAvail(null)}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm font-semibold text-slate-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
