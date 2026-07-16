import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import {
  calculateShiftDuration,
  calculateWeeklyHours,
  getDayOfWeekFromDate
} from '../../utils/schedulingRules';
import {
  getMonday,
  formatDateString,
  formatTimeString,
  getWeekDays,
  DAY_NAMES
} from '../../utils/dateUtils';
import type { Profile, EmployeeAvailability, ScheduleWeek, Shift, ScheduleAcknowledgment, TimeOffRequest } from '../../types';
import {
  Calendar,
  User,
  Clock,
  CheckSquare,
  Users,
  LogOut,
  AlertCircle,
  CheckCircle,
  WifiOff,
  ThumbsUp,
  CalendarOff,
  Trash2
} from 'lucide-react';

export const EmployeeDashboard: React.FC = () => {
  const { signOut, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'myschedule' | 'teamschedule' | 'availability' | 'timeoff'>('home');

  // Data State
  const [weeks, setWeeks] = useState<ScheduleWeek[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<ScheduleWeek | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [myAvailability, setMyAvailability] = useState<EmployeeAvailability[]>([]);
  const [myAcknowledgment, setMyAcknowledgment] = useState<ScheduleAcknowledgment | null>(null);
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [myTimeOff, setMyTimeOff] = useState<TimeOffRequest[]>([]);

  // Time-off request form
  const [timeOffStart, setTimeOffStart] = useState('');
  const [timeOffEnd, setTimeOffEnd] = useState('');
  const [timeOffReason, setTimeOffReason] = useState('');

  // UI State
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

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

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (selectedWeek) {
      fetchWeekDetails(selectedWeek.id);
    }
  }, [selectedWeek]);

  const fetchInitialData = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      // 1. Fetch team members (for name lookup in team schedule, profiles RLS permits employees reading active profiles)
      const { data: teamData, error: teamError } = await supabase
        .from('profiles')
        .select('*');
      if (teamError) throw teamError;
      setTeamMembers((teamData as Profile[]) || []);

      // 2. Fetch employee availability
      const { data: availData, error: availError } = await supabase
        .from('employee_availability')
        .select('*')
        .eq('employee_id', profile.id)
        .order('day_of_week');
      if (availError) throw availError;
      
      // Seed missing day records in UI state if needed
      const fullAvails = Array.from({ length: 7 }, (_, day) => {
        const existing = availData?.find(a => a.day_of_week === day);
        return existing || {
          id: '',
          employee_id: profile.id,
          day_of_week: day,
          available: true,
          earliest_start: '09:00:00',
          latest_end: '17:00:00',
          created_at: '',
          updated_at: ''
        };
      });
      setMyAvailability(fullAvails);

      // 3. Fetch my time-off requests
      const { data: timeOffData, error: timeOffError } = await supabase
        .from('time_off_requests')
        .select('*')
        .eq('employee_id', profile.id)
        .order('start_date', { ascending: false });
      if (timeOffError) throw timeOffError;
      setMyTimeOff(timeOffData || []);

      // 4. Fetch published weeks (RLS restricts employees from viewing drafts)
      const { data: weekData, error: weekError } = await supabase
        .from('schedule_weeks')
        .select('*')
        .eq('status', 'published')
        .order('week_start', { ascending: false });
      if (weekError) throw weekError;
      setWeeks(weekData || []);

      // Set to current week if published, else the latest published week
      if (weekData && weekData.length > 0) {
        const todayMonday = getMonday(new Date());
        const matchingWeek = weekData.find(w => w.week_start === todayMonday);
        setSelectedWeek(matchingWeek || weekData[0]);
      } else {
        setSelectedWeek(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error loading employee dashboard.');
    } finally {
      setLoading(false);
    }
  };

  const fetchWeekDetails = async (weekId: string) => {
    if (!profile) return;
    try {
      // 1. Fetch shifts belonging to published week
      const { data: shiftData, error: shiftError } = await supabase
        .from('shifts')
        .select('*')
        .eq('schedule_week_id', weekId);
      if (shiftError) throw shiftError;
      setShifts(shiftData || []);

      // 2. Fetch employee's acknowledgment for this week
      const { data: ackData, error: ackError } = await supabase
        .from('schedule_acknowledgments')
        .select('*')
        .eq('schedule_week_id', weekId)
        .eq('employee_id', profile.id)
        .maybeSingle();
      if (ackError) throw ackError;
      setMyAcknowledgment(ackData);
    } catch (err: any) {
      showToast(err.message || 'Error loading week shifts.', 'error');
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

  const handleAcknowledgeSchedule = async () => {
    if (isOffline || !selectedWeek || !profile || myAcknowledgment) return;
    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from('schedule_acknowledgments')
        .insert({
          schedule_week_id: selectedWeek.id,
          employee_id: profile.id
        })
        .select()
        .single();

      if (error) throw error;
      setMyAcknowledgment(data);
      showToast('Schedule acknowledged. Thank you!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to acknowledge schedule.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestTimeOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline || !profile) return;
    if (!timeOffStart || !timeOffEnd) return;
    if (timeOffEnd < timeOffStart) {
      showToast('End date cannot be before the start date.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from('time_off_requests')
        .insert({
          employee_id: profile.id,
          start_date: timeOffStart,
          end_date: timeOffEnd,
          reason: timeOffReason.trim() || null
        })
        .select()
        .single();
      if (error) throw error;
      setMyTimeOff([data, ...myTimeOff]);
      setTimeOffStart('');
      setTimeOffEnd('');
      setTimeOffReason('');
      showToast('Time-off request submitted. Your manager will review it.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to submit time-off request.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelTimeOff = async (request: TimeOffRequest) => {
    if (isOffline) return;
    if (!confirm('Cancel this pending time-off request?')) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('time_off_requests')
        .delete()
        .eq('id', request.id);
      if (error) throw error;
      setMyTimeOff(myTimeOff.filter(r => r.id !== request.id));
      showToast('Request cancelled.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel request.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateAvailability = async (idx: number, key: string, value: any) => {
    setMyAvailability(myAvailability.map((item, d) => 
      d === idx ? { ...item, [key]: value } : item
    ));
  };

  const handleSaveAvailability = async () => {
    if (isOffline || !profile) return;
    setActionLoading(true);
    try {
      for (const av of myAvailability) {
        // Validate end time > start time if available
        if (av.available && av.earliest_start && av.latest_end) {
          const partsStart = av.earliest_start.split(':');
          const partsEnd = av.latest_end.split(':');
          const startMin = parseInt(partsStart[0], 10) * 60 + (parseInt(partsStart[1], 10) || 0);
          const endMin = parseInt(partsEnd[0], 10) * 60 + (parseInt(partsEnd[1], 10) || 0);
          if (endMin <= startMin) {
            throw new Error(`Earliest start must be before latest end on ${DAY_NAMES[av.day_of_week]}`);
          }
        }

        const payload = {
          employee_id: profile.id,
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

      showToast('Availability settings updated successfully.', 'success');
      // Reload from DB
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update availability.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Helper selectors

  const myShifts = shifts.filter(s => s.employee_id === profile?.id);
  const totalMyWeeklyHours = calculateWeeklyHours(myShifts);

  // Today's shift and Next Shift
  const todayStr = new Date().toISOString().split('T')[0];
  const todayShift = myShifts.find(s => s.shift_date === todayStr);

  const getNextShift = () => {
    const futureShifts = myShifts
      .filter(s => s.shift_date > todayStr)
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date));
    return futureShifts[0] || null;
  };
  const nextShift = getNextShift();

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col md:flex-row pb-20 md:pb-0">
      
      {/* SIDEBAR NAVIGATION - DESKTOP */}
      <aside className="hidden md:flex flex-col w-64 bg-[#0f172a] border-r border-slate-800 p-6 shrink-0 justify-between">
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-wider flex items-center gap-2">
              <span>Spredsheep</span>
            </h1>
            <p className="text-xs text-indigo-300 font-semibold tracking-wide mt-1 uppercase">Employee Dashboard</p>
          </div>

          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('home')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'home'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <User className="w-5 h-5" />
              <span>Home</span>
            </button>
            <button
              onClick={() => setActiveTab('myschedule')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'myschedule'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-5 h-5" />
              <span>My Schedule</span>
            </button>
            <button
              onClick={() => setActiveTab('teamschedule')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'teamschedule'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Users className="w-5 h-5" />
              <span>Team Schedule</span>
            </button>
            <button
              onClick={() => setActiveTab('availability')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'availability'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Clock className="w-5 h-5" />
              <span>My Availability</span>
            </button>
            <button
              onClick={() => setActiveTab('timeoff')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition cursor-pointer ${
                activeTab === 'timeoff'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <CalendarOff className="w-5 h-5" />
              <span>Time Off</span>
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
              <p className="text-xs text-slate-500 truncate">Employee</p>
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

      {/* MOBILE HEADER */}
      <div className="flex flex-col flex-grow">
        {isOffline && (
          <div className="bg-amber-950/80 border-b border-amber-900/60 py-2 px-4 flex items-center justify-center gap-2 text-amber-300 text-xs font-semibold">
            <WifiOff className="w-4 h-4" />
            <span>Working Offline. Previously loaded schedules are visible.</span>
          </div>
        )}

        <header className="md:hidden flex items-center justify-between px-6 py-4 bg-[#0f172a] border-b border-slate-800 shrink-0">
          <span className="text-xl font-black text-white">Spredsheep</span>
          <button onClick={signOut} className="text-rose-400 p-1">
            <LogOut className="w-5 h-5" />
          </button>
        </header>

        {/* MAIN PANEL CONTENT */}
        <main className="flex-grow p-6 overflow-y-auto max-w-4xl w-full mx-auto space-y-6">
          
          {/* TOASTS */}
          {successMessage && (
            <div className="fixed top-6 right-6 z-50 p-4 bg-emerald-950 border border-emerald-800 rounded-xl text-emerald-300 text-sm flex items-center gap-2 shadow-2xl animate-fade-in-down">
              <CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="fixed top-6 right-6 z-50 p-4 bg-red-950 border border-red-800 rounded-xl text-red-300 text-sm flex items-center gap-2 shadow-2xl animate-fade-in-down">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ACTIVE WEEK SUMMARY SELECTOR */}
          <div className="flex items-center justify-between p-4 glass-panel rounded-2xl border border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Viewing Schedule Week</span>
                <div className="flex items-center gap-2 mt-0.5">
                  {weeks.length === 0 ? (
                    <span className="text-sm font-semibold text-slate-500 italic">No published schedules</span>
                  ) : (
                    <select
                      className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2.5 py-1 text-sm font-semibold focus:outline-none"
                      value={selectedWeek?.id || ''}
                      onChange={(e) => {
                        const wk = weeks.find(w => w.id === e.target.value);
                        if (wk) setSelectedWeek(wk);
                      }}
                    >
                      {weeks.map(w => (
                        <option key={w.id} value={w.id}>
                          Week of {formatDateString(w.week_start)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* TAB 1: HOME */}
              {activeTab === 'home' && (
                <div className="space-y-6">
                  {/* Welcoming Card */}
                  <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div>
                      <h2 className="text-2xl font-black text-white">Hello, {profile?.full_name}!</h2>
                      <p className="text-sm text-slate-400 mt-1">Today is {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-center p-3 bg-slate-900/60 border border-slate-800 rounded-xl min-w-[100px]">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Weekly Hours</p>
                        <p className={`text-2xl font-extrabold mt-1 ${
                          totalMyWeeklyHours >= 35 ? 'text-amber-400' : 'text-white'
                        }`}>
                          {totalMyWeeklyHours.toFixed(1)}h
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Today / Next Shift Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Today's Shift */}
                    <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Today's Shift</h4>
                      {todayShift ? (
                        <div className="p-4 bg-indigo-600/10 border border-indigo-500/25 rounded-xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-extrabold text-white">{todayShift.position}</span>
                            <span className="text-xs font-bold text-indigo-400">
                              {calculateShiftDuration(todayShift.start_time, todayShift.end_time).toFixed(1)} hrs
                            </span>
                          </div>
                          <p className="text-base font-bold text-white">
                            {formatTimeString(todayShift.start_time)} - {formatTimeString(todayShift.end_time)}
                          </p>
                          {todayShift.notes && (
                            <p className="text-xs text-slate-400 italic border-t border-slate-800/40 pt-2">
                              Note: {todayShift.notes}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 italic py-4">No shift scheduled for today</p>
                      )}
                    </div>

                    {/* Next Shift */}
                    <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Next Shift</h4>
                      {nextShift ? (
                        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-extrabold text-slate-200">{nextShift.position}</span>
                            <span className="text-xs text-slate-500">
                              {formatDateString(nextShift.shift_date)}
                            </span>
                          </div>
                          <p className="text-base font-bold text-white">
                            {formatTimeString(nextShift.start_time)} - {formatTimeString(nextShift.end_time)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 italic py-4">No future shifts scheduled</p>
                      )}
                    </div>
                  </div>

                  {/* Acknowledgment Alert Panel */}
                  {selectedWeek && (
                    <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
                      <h4 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                        <CheckSquare className="w-4.5 h-4.5 text-indigo-400" />
                        <span>Schedule Acknowledgment</span>
                      </h4>

                      {myAcknowledgment ? (
                        <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl text-emerald-400 text-sm flex items-center gap-3">
                          <CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
                          <div>
                            <p className="font-bold">Schedule Acknowledged</p>
                            <p className="text-xs text-emerald-500 mt-0.5">
                              Confirmed at: {new Date(myAcknowledgment.acknowledged_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
                          <p className="text-sm text-slate-300 leading-relaxed">
                            "I have reviewed my schedule for the week of <strong className="text-white">{formatDateString(selectedWeek.week_start)}</strong>."
                          </p>
                          <button
                            onClick={handleAcknowledgeSchedule}
                            disabled={actionLoading || isOffline || myShifts.length === 0}
                            className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-bold text-xs text-white transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10"
                          >
                            <ThumbsUp className="w-4 h-4" />
                            <span>Confirm Acknowledgment</span>
                          </button>
                          {myShifts.length === 0 && (
                            <p className="text-[11px] text-slate-500 italic">No shifts assigned to you this week; no confirmation required.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: MY SCHEDULE */}
              {activeTab === 'myschedule' && selectedWeek && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-white">My Weekly Shifts</h3>
                  
                  {myShifts.length === 0 ? (
                    <div className="glass-panel p-10 rounded-2xl border border-slate-800/80 text-center space-y-2">
                      <Calendar className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-sm text-slate-500 italic">No shifts assigned to you for the week starting {formatDateString(selectedWeek.week_start)}.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {myShifts
                        .sort((a, b) => a.shift_date.localeCompare(b.shift_date))
                        .map(shift => {
                          const duration = calculateShiftDuration(shift.start_time, shift.end_time);
                          return (
                            <div key={shift.id} className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                                    {getDayOfWeekFromDate(shift.shift_date) === 6 ? 'Sunday' : DAY_NAMES[getDayOfWeekFromDate(shift.shift_date)]}
                                  </p>
                                  <p className="text-sm font-extrabold text-white mt-0.5">{formatDateString(shift.shift_date)}</p>
                                </div>
                                <span className="text-xs font-bold bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg text-slate-300">
                                  {shift.position}
                                </span>
                              </div>

                              <div className="flex justify-between items-baseline pt-2 border-t border-slate-800/40">
                                <p className="text-lg font-extrabold text-white">
                                  {formatTimeString(shift.start_time)} - {formatTimeString(shift.end_time)}
                                </p>
                                <span className="text-xs font-bold text-slate-500">{duration.toFixed(1)} hrs</span>
                              </div>

                              {shift.notes && (
                                <p className="text-xs text-slate-400 italic bg-slate-900/60 border border-slate-800/40 p-2.5 rounded-xl leading-normal">
                                  Note: {shift.notes}
                                </p>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: TEAM SCHEDULE */}
              {activeTab === 'teamschedule' && selectedWeek && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">Team Shifts</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Shifts for all team members for the week starting {formatDateString(selectedWeek.week_start)}.</p>
                  </div>

                  {shifts.length === 0 ? (
                    <div className="glass-panel p-10 rounded-2xl border border-slate-800/80 text-center space-y-2">
                      <Users className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-sm text-slate-500 italic">No shifts published for this week yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {getWeekDays(selectedWeek.week_start).map(dayStr => {
                        const dayShifts = shifts.filter(s => s.shift_date === dayStr);
                        const dayNum = getDayOfWeekFromDate(dayStr);
                        
                        return (
                          <div key={dayStr} className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden">
                            {/* Day Header */}
                            <div className="p-4 bg-slate-900/60 border-b border-slate-800/60 flex justify-between items-center">
                              <span className="text-sm font-bold text-white">
                                {DAY_NAMES[dayNum]}
                              </span>
                              <span className="text-xs text-slate-500 font-semibold">
                                {formatDateString(dayStr)}
                              </span>
                            </div>

                            {/* Daily Shifts */}
                            <div className="p-4 divide-y divide-slate-800/40">
                              {dayShifts.length === 0 ? (
                                <p className="text-xs text-slate-600 italic py-2">No shifts scheduled</p>
                              ) : (
                                dayShifts.map(s => {
                                  const empProfile = teamMembers.find(t => t.id === s.employee_id);
                                  const empName = empProfile?.full_name || 'Staff Member';
                                  const duration = calculateShiftDuration(s.start_time, s.end_time);

                                  return (
                                    <div key={s.id} className="flex justify-between items-center py-3 first:pt-0 last:pb-0">
                                      <div>
                                        <p className="text-sm font-bold text-white">{empName}</p>
                                        <span className="inline-block text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded-md mt-1">
                                          {s.position}
                                        </span>
                                      </div>
                                      
                                      <div className="text-right">
                                        <p className="text-xs font-semibold text-slate-200">
                                          {formatTimeString(s.start_time)} - {formatTimeString(s.end_time)}
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-bold mt-0.5">{duration.toFixed(1)} hrs</p>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: MY AVAILABILITY */}
              {activeTab === 'availability' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">Configure Availability</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Let managers know which days you can be scheduled and your preferred hour ranges.</p>
                  </div>

                  <div className="space-y-4">
                    {myAvailability.map((av, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-indigo-600 bg-slate-900 border-slate-800 rounded focus:ring-indigo-500"
                            checked={av.available}
                            disabled={actionLoading}
                            onChange={(e) => handleUpdateAvailability(idx, 'available', e.target.checked)}
                          />
                          <span className="text-sm font-bold text-white w-24">{DAY_NAMES[idx]}</span>
                        </div>

                        {av.available ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none"
                              value={av.earliest_start?.substring(0, 5) || '09:00'}
                              disabled={actionLoading}
                              onChange={(e) => handleUpdateAvailability(idx, 'earliest_start', e.target.value + ':00')}
                            />
                            <span className="text-xs text-slate-500">to</span>
                            <input
                              type="time"
                              className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none"
                              value={av.latest_end?.substring(0, 5) || '17:00'}
                              disabled={actionLoading}
                              onChange={(e) => handleUpdateAvailability(idx, 'latest_end', e.target.value + ':00')}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">Unavailable all day</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleSaveAvailability}
                    disabled={actionLoading || isOffline}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-bold text-sm rounded-xl transition cursor-pointer"
                  >
                    {actionLoading ? 'Saving...' : 'Save Availability Preferences'}
                  </button>
                </div>
              )}

              {activeTab === 'timeoff' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">Time Off</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Request days off and track your manager's decision.</p>
                  </div>

                  {/* Request form */}
                  <form onSubmit={handleRequestTimeOff} className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
                    <h4 className="text-sm font-bold text-white">New Request</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">First day off</label>
                        <input
                          type="date"
                          required
                          value={timeOffStart}
                          onChange={(e) => setTimeOffStart(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 px-3 text-sm text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">Last day off</label>
                        <input
                          type="date"
                          required
                          value={timeOffEnd}
                          min={timeOffStart || undefined}
                          onChange={(e) => setTimeOffEnd(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 px-3 text-sm text-white focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Reason (optional)</label>
                      <input
                        type="text"
                        value={timeOffReason}
                        onChange={(e) => setTimeOffReason(e.target.value)}
                        placeholder="e.g. Family trip, medical appointment"
                        className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg py-2 px-3 text-sm text-white placeholder-slate-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={actionLoading || isOffline}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-bold text-sm rounded-xl transition cursor-pointer"
                    >
                      {actionLoading ? 'Submitting…' : 'Submit Request'}
                    </button>
                  </form>

                  {/* My requests */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400">My Requests</h4>
                    {myTimeOff.length === 0 ? (
                      <p className="text-xs text-slate-500">No time-off requests yet.</p>
                    ) : (
                      myTimeOff.map(req => (
                        <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-white">
                              {formatDateString(req.start_date)}
                              {req.end_date !== req.start_date && ` – ${formatDateString(req.end_date)}`}
                            </p>
                            {req.reason && <p className="text-xs text-slate-500 italic">“{req.reason}”</p>}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                              req.status === 'approved'
                                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30'
                                : req.status === 'denied'
                                  ? 'bg-rose-950/20 text-rose-400 border border-rose-900/30'
                                  : 'bg-amber-950/30 text-amber-300 border border-amber-900/30'
                            }`}>
                              {req.status}
                            </span>
                            {req.status === 'pending' && (
                              <button
                                onClick={() => handleCancelTimeOff(req)}
                                disabled={actionLoading || isOffline}
                                title="Cancel request"
                                className="p-2 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* FOOTER TAB NAV FOR MOBILE */}
      <footer className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0f172a] border-t border-slate-800 py-2 px-6 flex items-center justify-between">
        <button
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'home' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <User className="w-5 h-5" />
          <span>Home</span>
        </button>
        <button
          onClick={() => setActiveTab('myschedule')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'myschedule' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span>My Shifts</span>
        </button>
        <button
          onClick={() => setActiveTab('teamschedule')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'teamschedule' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Users className="w-5 h-5" />
          <span>Team</span>
        </button>
        <button
          onClick={() => setActiveTab('availability')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'availability' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Clock className="w-5 h-5" />
          <span>Availability</span>
        </button>
        <button
          onClick={() => setActiveTab('timeoff')}
          className={`flex flex-col items-center gap-1 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'timeoff' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <CalendarOff className="w-5 h-5" />
          <span>Time Off</span>
        </button>
      </footer>
    </div>
  );
};
