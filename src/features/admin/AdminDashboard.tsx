import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import type { Profile, Department, ManagerDepartment, AppSettings } from '../../types';
import {
  Building2,
  Users,
  Settings,
  Plus,
  Trash2,
  Pencil,
  CalendarRange,
  CheckCircle,
  AlertCircle,
  LogOut,
  UserPlus,
  Shield,
  WifiOff,
  KeyRound
} from 'lucide-react';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';

export const AdminDashboard: React.FC = () => {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'departments' | 'staff' | 'settings'>('departments');

  // Data
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [managerDepartments, setManagerDepartments] = useState<ManagerDepartment[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [emailById, setEmailById] = useState<Record<string, string>>({});

  // Edit staff modal
  const [editingStaff, setEditingStaff] = useState<Profile | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');

  // UI
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Departments tab
  const [newDepartmentName, setNewDepartmentName] = useState('');

  // Staff tab (create modal)
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<'manager' | 'employee'>('employee');
  const [staffDepartmentIds, setStaffDepartmentIds] = useState<string[]>([]);

  // Settings tab
  const [orgNameInput, setOrgNameInput] = useState('');
  const [hoursCapInput, setHoursCapInput] = useState('39');

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
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [deptRes, staffRes, mdRes, settingsRes, emailsRes] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('manager_departments').select('*'),
        supabase.from('app_settings').select('*').single(),
        supabase.rpc('list_staff_emails')
      ]);

      if (deptRes.error) throw deptRes.error;
      if (staffRes.error) throw staffRes.error;
      if (mdRes.error) throw mdRes.error;
      if (settingsRes.error) throw settingsRes.error;
      if (emailsRes.error) throw emailsRes.error;

      setDepartments(deptRes.data || []);
      setStaff(staffRes.data || []);
      setManagerDepartments(mdRes.data || []);
      setSettings(settingsRes.data);
      const emailMap: Record<string, string> = {};
      (emailsRes.data as Array<{ id: string; email: string }> | null)?.forEach(row => {
        emailMap[row.id] = row.email;
      });
      setEmailById(emailMap);
      setOrgNameInput(settingsRes.data?.org_name ?? '');
      setHoursCapInput(String(settingsRes.data?.weekly_hours_cap ?? 39));
    } catch (err: any) {
      setErrorMessage(err.message || 'Error loading admin data.');
    } finally {
      setLoading(false);
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

  const departmentName = (id: string | null) =>
    departments.find(d => d.id === id)?.name ?? '—';

  const managerDeptIds = (managerId: string) =>
    managerDepartments.filter(md => md.manager_id === managerId).map(md => md.department_id);

  const departmentMemberCount = (deptId: string) =>
    staff.filter(s => s.department_id === deptId).length;

  // ----- Departments -----
  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline || !newDepartmentName.trim()) return;
    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from('departments')
        .insert({ name: newDepartmentName.trim() })
        .select()
        .single();
      if (error) throw error;
      setDepartments([...departments, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewDepartmentName('');
      showToast(`Department "${data.name}" created.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to create department.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleDepartment = async (dept: Department) => {
    if (isOffline) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('departments')
        .update({ active: !dept.active })
        .eq('id', dept.id);
      if (error) throw error;
      setDepartments(departments.map(d => d.id === dept.id ? { ...d, active: !dept.active } : d));
      showToast('Department status updated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update department.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteDepartment = async (dept: Department) => {
    if (isOffline) return;
    const members = departmentMemberCount(dept.id);
    if (members > 0) {
      showToast(`"${dept.name}" still has ${members} staff member(s). Move them to another department first.`, 'error');
      return;
    }
    if (!confirm(
      `Delete department "${dept.name}"? All of its schedule weeks and shifts are permanently removed. This cannot be undone.`
    )) {
      return;
    }
    setActionLoading(true);
    try {
      const { error } = await supabase.from('departments').delete().eq('id', dept.id);
      if (error) throw error;
      setDepartments(departments.filter(d => d.id !== dept.id));
      setManagerDepartments(managerDepartments.filter(md => md.department_id !== dept.id));
      showToast(`Department "${dept.name}" deleted.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete department.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // ----- Staff -----
  const openStaffModal = () => {
    setStaffEmail('');
    setStaffPassword('');
    setStaffName('');
    setStaffRole('employee');
    setStaffDepartmentIds([]);
    setIsStaffModalOpen(true);
  };

  const toggleStaffDepartment = (deptId: string) => {
    if (staffRole === 'employee') {
      setStaffDepartmentIds([deptId]);
    } else {
      setStaffDepartmentIds(ids =>
        ids.includes(deptId) ? ids.filter(id => id !== deptId) : [...ids, deptId]
      );
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) return;
    if (staffDepartmentIds.length === 0) {
      showToast('Select at least one department.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const { error } = await supabase.rpc('create_staff_account', {
        p_email: staffEmail,
        p_password: staffPassword,
        p_full_name: staffName,
        p_role: staffRole,
        p_department_ids: staffDepartmentIds
      });
      if (error) throw error;

      showToast(`${staffRole === 'manager' ? 'Manager' : 'Employee'} ${staffName} created.`, 'success');
      setIsStaffModalOpen(false);
      await fetchAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to create staff account.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const openEditModal = (member: Profile) => {
    setEditingStaff(member);
    setEditName(member.full_name);
    setEditEmail(emailById[member.id] ?? '');
    setEditPassword('');
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline || !editingStaff) return;
    setActionLoading(true);
    try {
      const { error } = await supabase.rpc('update_staff_account', {
        p_user_id: editingStaff.id,
        p_email: editEmail.trim(),
        p_full_name: editName.trim(),
        p_password: editPassword.trim() ? editPassword : null
      });
      if (error) throw error;
      showToast(`${editName.trim()} updated.`, 'success');
      setEditingStaff(null);
      await fetchAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to update account.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStaffActive = async (member: Profile) => {
    if (isOffline) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ active: !member.active })
        .eq('id', member.id);
      if (error) throw error;
      setStaff(staff.map(s => s.id === member.id ? { ...s, active: !member.active } : s));
      showToast('Staff status updated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update staff status.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteStaff = async (member: Profile) => {
    if (isOffline) return;
    if (!confirm(
      `Permanently delete ${member.full_name}? This removes their account, availability, shifts, acknowledgments, and time-off requests. This cannot be undone.`
    )) {
      return;
    }
    setActionLoading(true);
    try {
      const { error } = await supabase.rpc('delete_employee_account', {
        p_employee_id: member.id
      });
      if (error) throw error;
      setStaff(staff.filter(s => s.id !== member.id));
      setManagerDepartments(managerDepartments.filter(md => md.manager_id !== member.id));
      showToast(`${member.full_name} has been deleted.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete staff member.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleChangeEmployeeDepartment = async (member: Profile, departmentId: string) => {
    if (isOffline) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ department_id: departmentId })
        .eq('id', member.id);
      if (error) throw error;
      setStaff(staff.map(s => s.id === member.id ? { ...s, department_id: departmentId } : s));
      showToast(`${member.full_name} moved to ${departmentName(departmentId)}.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to move employee.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleManagerDepartment = async (manager: Profile, deptId: string) => {
    if (isOffline) return;
    const existing = managerDepartments.find(
      md => md.manager_id === manager.id && md.department_id === deptId
    );
    setActionLoading(true);
    try {
      if (existing) {
        const { error } = await supabase.from('manager_departments').delete().eq('id', existing.id);
        if (error) throw error;
        setManagerDepartments(managerDepartments.filter(md => md.id !== existing.id));
      } else {
        const { data, error } = await supabase
          .from('manager_departments')
          .insert({ manager_id: manager.id, department_id: deptId })
          .select()
          .single();
        if (error) throw error;
        setManagerDepartments([...managerDepartments, data]);
      }
      showToast(`${manager.full_name}'s departments updated.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update manager departments.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // ----- Settings -----
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) return;
    const cap = parseFloat(hoursCapInput);
    if (!orgNameInput.trim() || isNaN(cap) || cap <= 0) {
      showToast('Provide an organization name and a positive weekly hours cap.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .update({ org_name: orgNameInput.trim(), weekly_hours_cap: cap })
        .eq('id', true)
        .select()
        .single();
      if (error) throw error;
      setSettings(data);
      showToast('Settings saved.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save settings.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const managers = staff.filter(s => s.role === 'manager');
  const employees = staff.filter(s => s.role === 'employee');
  const admins = staff.filter(s => s.role === 'admin');

  return (
    <div className="min-h-screen bg-[#0b0f19] flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-800/60 flex flex-col justify-between p-5 min-h-screen sticky top-0">
        <div>
          <div className="mb-8">
            <h1 className="text-xl font-extrabold text-white tracking-tight">{settings?.org_name || 'Spredsheep'}</h1>
            <p className="text-xs text-slate-500 mt-0.5">Admin Console</p>
          </div>
          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab('departments')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition cursor-pointer ${
                activeTab === 'departments' ? 'bg-indigo-600/15 text-indigo-300' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-4.5 h-4.5" />
              <span>Departments</span>
            </button>
            <button
              onClick={() => setActiveTab('staff')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition cursor-pointer ${
                activeTab === 'staff' ? 'bg-indigo-600/15 text-indigo-300' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Users className="w-4.5 h-4.5" />
              <span>Staff</span>
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition cursor-pointer ${
                activeTab === 'settings' ? 'bg-indigo-600/15 text-indigo-300' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Settings className="w-4.5 h-4.5" />
              <span>Settings</span>
            </button>
            <button
              onClick={() => navigate('/manager')}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition cursor-pointer text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            >
              <CalendarRange className="w-4.5 h-4.5" />
              <span>Open Scheduler</span>
            </button>
          </nav>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center font-bold">
              {profile?.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-white truncate">{profile?.full_name}</p>
              <p className="text-[11px] text-slate-500">Admin</p>
            </div>
          </div>
          <button
            onClick={() => setIsPasswordModalOpen(true)}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition cursor-pointer text-slate-400 hover:bg-slate-900 hover:text-slate-200"
          >
            <KeyRound className="w-4.5 h-4.5" />
            <span>Change Password</span>
          </button>
          <button
            onClick={() => signOut()}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-3 transition cursor-pointer text-slate-400 hover:bg-rose-950/30 hover:text-rose-300"
          >
            <LogOut className="w-4.5 h-4.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 space-y-6 max-w-6xl">
        {isOffline && (
          <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-300 text-sm flex items-center gap-3">
            <WifiOff className="w-5 h-5 shrink-0" />
            <span>You are offline. Changes are disabled until the connection returns.</span>
          </div>
        )}
        {errorMessage && (
          <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-emerald-300 text-sm flex items-center gap-3">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* DEPARTMENTS */}
        {activeTab === 'departments' && (
          <div className="space-y-6">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-xl font-bold text-white">Departments</h3>
                <p className="text-xs text-slate-400 mt-0.5">Each department has its own schedules, staff, and managers.</p>
              </div>
              <form onSubmit={handleCreateDepartment} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newDepartmentName}
                  onChange={e => setNewDepartmentName(e.target.value)}
                  placeholder="e.g. Kitchen, Sales, Support"
                  className="px-4 py-2.5 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition w-64"
                  disabled={actionLoading || isOffline}
                />
                <button
                  type="submit"
                  disabled={actionLoading || isOffline || !newDepartmentName.trim()}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-semibold text-sm text-white transition flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add</span>
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {departments.map(dept => {
                const deptManagers = managers.filter(m => managerDeptIds(m.id).includes(dept.id));
                return (
                  <div key={dept.id} className={`glass-panel p-5 rounded-2xl border flex flex-col justify-between min-h-[170px] ${
                    dept.active ? 'border-slate-800' : 'border-slate-900/60 opacity-60'
                  }`}>
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center">
                            <Building2 className="w-5 h-5" />
                          </div>
                          <h4 className="text-base font-bold text-white">{dept.name}</h4>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          dept.active ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-900 text-slate-500'
                        }`}>
                          {dept.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-4 space-y-1 text-xs text-slate-400">
                        <p>{departmentMemberCount(dept.id)} employee(s)</p>
                        <p>
                          {deptManagers.length > 0
                            ? `Managed by ${deptManagers.map(m => m.full_name).join(', ')}`
                            : 'No manager assigned yet'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-4 border-t border-slate-800/40 mt-4 justify-end">
                      <button
                        onClick={() => handleToggleDepartment(dept)}
                        disabled={isOffline}
                        className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                          dept.active
                            ? 'bg-rose-950/20 text-rose-400 border border-rose-900/30 hover:bg-rose-950/40'
                            : 'bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 hover:bg-emerald-950/40'
                        }`}
                      >
                        {dept.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteDepartment(dept)}
                        disabled={isOffline}
                        className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-900/50 text-[11px] font-bold text-rose-300 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STAFF */}
        {activeTab === 'staff' && (
          <div className="space-y-8">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-xl font-bold text-white">Staff</h3>
                <p className="text-xs text-slate-400 mt-0.5">Create managers and employees, assign departments, and control access.</p>
              </div>
              <button
                onClick={openStaffModal}
                disabled={isOffline || departments.length === 0}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-semibold text-sm text-white transition flex items-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Staff</span>
              </button>
            </div>

            {departments.length === 0 && (
              <p className="text-sm text-slate-400">Create a department first, then add staff to it.</p>
            )}

            {/* Managers */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400">Managers / Schedulers</h4>
              {managers.length === 0 && <p className="text-xs text-slate-500">No managers yet. Managers run day-to-day scheduling for their departments.</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {managers.map(m => (
                  <div key={m.id} className={`glass-panel p-5 rounded-2xl border ${m.active ? 'border-slate-800' : 'border-slate-900/60 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center font-bold text-lg">
                          {m.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-white">{m.full_name}</h4>
                          <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500">manager</span>
                          {emailById[m.id] && <p className="text-[11px] text-slate-500 mt-0.5 break-all">{emailById[m.id]}</p>}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                        m.active ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-900 text-slate-500'
                      }`}>
                        {m.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="mt-4 border-t border-slate-800/40 pt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Manages departments</p>
                      <div className="flex flex-wrap gap-2">
                        {departments.map(d => {
                          const assigned = managerDeptIds(m.id).includes(d.id);
                          return (
                            <button
                              key={d.id}
                              onClick={() => handleToggleManagerDepartment(m, d.id)}
                              disabled={isOffline || actionLoading}
                              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition cursor-pointer ${
                                assigned
                                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700/50'
                                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                              }`}
                            >
                              {d.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-4 border-t border-slate-800/40 mt-4 justify-end">
                      <button
                        onClick={() => openEditModal(m)}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-bold text-slate-300 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleToggleStaffActive(m)}
                        disabled={isOffline}
                        className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                          m.active
                            ? 'bg-rose-950/20 text-rose-400 border border-rose-900/30 hover:bg-rose-950/40'
                            : 'bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 hover:bg-emerald-950/40'
                        }`}
                      >
                        {m.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteStaff(m)}
                        disabled={isOffline}
                        className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-900/50 text-[11px] font-bold text-rose-300 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Employees */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400">Employees</h4>
              {employees.length === 0 && <p className="text-xs text-slate-500">No employees yet.</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {employees.map(emp => (
                  <div key={emp.id} className={`glass-panel p-5 rounded-2xl border ${emp.active ? 'border-slate-800' : 'border-slate-900/60 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-lg">
                          {emp.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-white">{emp.full_name}</h4>
                          <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500">employee</span>
                          {emailById[emp.id] && <p className="text-[11px] text-slate-500 mt-0.5 break-all">{emailById[emp.id]}</p>}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                        emp.active ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-900 text-slate-500'
                      }`}>
                        {emp.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="mt-4 border-t border-slate-800/40 pt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Department</p>
                      <select
                        value={emp.department_id ?? ''}
                        onChange={e => handleChangeEmployeeDepartment(emp, e.target.value)}
                        disabled={isOffline || actionLoading}
                        className="w-full px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        {departments.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2 pt-4 border-t border-slate-800/40 mt-4 justify-end">
                      <button
                        onClick={() => openEditModal(emp)}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-bold text-slate-300 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleToggleStaffActive(emp)}
                        disabled={isOffline}
                        className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                          emp.active
                            ? 'bg-rose-950/20 text-rose-400 border border-rose-900/30 hover:bg-rose-950/40'
                            : 'bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 hover:bg-emerald-950/40'
                        }`}
                      >
                        {emp.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteStaff(emp)}
                        disabled={isOffline}
                        className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-900/50 text-[11px] font-bold text-rose-300 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Admins */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400">Admins</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {admins.map(a => (
                  <div key={a.id} className="glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-600/10 text-amber-400 flex items-center justify-center">
                        <Shield className="w-5 h-5" />
                      </div>
                      <div className="overflow-hidden">
                        <h4 className="text-base font-bold text-white">{a.full_name}</h4>
                        <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500">admin</span>
                        {emailById[a.id] && <p className="text-[11px] text-slate-500 mt-0.5 break-all">{emailById[a.id]}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-4 border-t border-slate-800/40 mt-4 justify-end">
                      <button
                        onClick={() => openEditModal(a)}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-bold text-slate-300 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-lg">
            <div>
              <h3 className="text-xl font-bold text-white">App Settings</h3>
              <p className="text-xs text-slate-400 mt-0.5">Branding and scheduling rules for your whole organization.</p>
            </div>
            <form onSubmit={handleSaveSettings} className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={orgNameInput}
                  onChange={e => setOrgNameInput(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
                  placeholder="e.g. Acme Corp"
                  disabled={actionLoading || isOffline}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Weekly Hours Cap per Employee
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={hoursCapInput}
                  onChange={e => setHoursCapInput(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white focus:outline-none transition"
                  disabled={actionLoading || isOffline}
                />
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Schedules that push an employee past this many hours in one week are rejected.
                </p>
              </div>
              <button
                type="submit"
                disabled={actionLoading || isOffline}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-semibold text-sm text-white transition cursor-pointer"
              >
                Save Settings
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Add Staff Modal */}
      {isStaffModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="glass-panel w-full max-w-md p-7 rounded-2xl border border-slate-800 bg-[#0d1220]">
            <h3 className="text-lg font-bold text-white mb-5">Add Staff Member</h3>
            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(['employee', 'manager'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => { setStaffRole(r); setStaffDepartmentIds([]); }}
                    className={`px-3 py-2.5 rounded-xl text-sm font-semibold border transition cursor-pointer capitalize ${
                      staffRole === r
                        ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700/50'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <input
                type="text"
                required
                value={staffName}
                onChange={e => setStaffName(e.target.value)}
                placeholder="Full name"
                className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
              />
              <input
                type="email"
                required
                value={staffEmail}
                onChange={e => setStaffEmail(e.target.value)}
                placeholder="Email address"
                className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
              />
              <input
                type="password"
                required
                minLength={6}
                value={staffPassword}
                onChange={e => setStaffPassword(e.target.value)}
                placeholder="Temporary password (min 6 chars)"
                className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
              />

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  {staffRole === 'manager' ? 'Departments they manage (pick one or more)' : 'Department (pick one)'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {departments.filter(d => d.active).map(d => {
                    const selected = staffDepartmentIds.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleStaffDepartment(d.id)}
                        className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer ${
                          selected
                            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-700/50'
                            : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                        }`}
                      >
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-semibold text-sm text-white transition cursor-pointer"
                >
                  {actionLoading ? 'Creating…' : 'Create Account'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsStaffModalOpen(false)}
                  className="px-4 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl font-semibold text-sm text-slate-300 transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editingStaff && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="glass-panel w-full max-w-md p-7 rounded-2xl border border-slate-800 bg-[#0d1220]">
            <h3 className="text-lg font-bold text-white mb-1">Edit Account</h3>
            <p className="text-xs text-slate-400 mb-5 capitalize">{editingStaff.role} account</p>
            <form onSubmit={handleUpdateStaff} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Full name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email / username</label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">New password</label>
                <input
                  type="password"
                  minLength={6}
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
                />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-semibold text-sm text-white transition cursor-pointer"
                >
                  {actionLoading ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  className="px-4 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl font-semibold text-sm text-slate-300 transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ChangePasswordModal open={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
    </div>
  );
};
