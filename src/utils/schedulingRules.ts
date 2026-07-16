import type { EmployeeAvailability } from '../types';

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

export function getDayOfWeekFromDate(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayIndex = date.getDay(); // 0 = Sunday, 1 = Monday, ...
  return dayIndex === 0 ? 6 : dayIndex - 1; // Map to 0 = Monday, ..., 6 = Sunday
}

export function calculateShiftDuration(start: string, end: string): number {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  
  if (endMinutes > startMinutes) {
    return (endMinutes - startMinutes) / 60;
  } else if (endMinutes < startMinutes) {
    // Overnight shift: crosses midnight
    return (1440 - startMinutes + endMinutes) / 60;
  } else {
    return 0;
  }
}

export function calculateWeeklyHours(shifts: { start_time: string; end_time: string }[]): number {
  return shifts.reduce((total, shift) => total + calculateShiftDuration(shift.start_time, shift.end_time), 0);
}

export function getShiftMinutesRange(shift: { shift_date: string; start_time: string; end_time: string }): { start: number; end: number } {
  const dateParts = shift.shift_date.split('-').map(Number);
  // Use UTC to avoid DST jumps and timezone shifting
  const dateMs = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]);
  const dayOffset = Math.floor(dateMs / (24 * 60 * 60 * 1000));
  
  const startMinutes = dayOffset * 1440 + parseTimeToMinutes(shift.start_time);
  let endMinutes = dayOffset * 1440 + parseTimeToMinutes(shift.end_time);
  
  if (parseTimeToMinutes(shift.end_time) <= parseTimeToMinutes(shift.start_time)) {
    // Overnight shift: ends on the next calendar day
    endMinutes += 1440;
  }
  
  return { start: startMinutes, end: endMinutes };
}

export function shiftsOverlap(
  s1: { shift_date: string; start_time: string; end_time: string },
  s2: { shift_date: string; start_time: string; end_time: string }
): boolean {
  const r1 = getShiftMinutesRange(s1);
  const r2 = getShiftMinutesRange(s2);
  return r1.start < r2.end && r2.start < r1.end;
}

export function detectOverlappingShifts(
  employeeId: string,
  shifts: { employee_id: string; shift_date: string; start_time: string; end_time: string; id?: string }[]
): boolean {
  const empShifts = shifts.filter(s => s.employee_id === employeeId);
  for (let i = 0; i < empShifts.length; i++) {
    for (let j = i + 1; j < empShifts.length; j++) {
      if (empShifts[i].id && empShifts[j].id && empShifts[i].id === empShifts[j].id) continue;
      
      if (shiftsOverlap(empShifts[i], empShifts[j])) {
        return true;
      }
    }
  }
  return false;
}

export function checkAvailabilityConflicts(
  shift: { shift_date: string; start_time: string; end_time: string },
  availabilities: EmployeeAvailability[]
): boolean {
  const dayOfWeek = getDayOfWeekFromDate(shift.shift_date);
  const avail = availabilities.find(a => a.day_of_week === dayOfWeek);

  if (!avail) return false;
  if (!avail.available) return true;

  if (avail.earliest_start) {
    const shiftStart = parseTimeToMinutes(shift.start_time);
    const availStart = parseTimeToMinutes(avail.earliest_start);
    if (shiftStart < availStart) return true;
  }

  if (avail.latest_end) {
    const shiftEnd = parseTimeToMinutes(shift.end_time);
    const availEnd = parseTimeToMinutes(avail.latest_end);
    
    let actualShiftEnd = shiftEnd;
    if (shiftEnd <= parseTimeToMinutes(shift.start_time)) {
      actualShiftEnd += 1440;
    }
    
    let actualAvailEnd = availEnd;
    const availStartMinutes = avail.earliest_start ? parseTimeToMinutes(avail.earliest_start) : 0;
    if (availEnd <= availStartMinutes) {
      actualAvailEnd += 1440;
    }

    if (actualShiftEnd > actualAvailEnd) return true;
  }

  return false;
}

export function validateWeeklyHoursLimit(
  shifts: { employee_id: string; start_time: string; end_time: string; id?: string }[],
  employeeId: string,
  newShiftHours: number = 0,
  excludeShiftId?: string
): boolean {
  const empShifts = shifts.filter(s => s.employee_id === employeeId && (!excludeShiftId || s.id !== excludeShiftId));
  const currentHours = calculateWeeklyHours(empShifts);
  return (currentHours + newShiftHours) > 39.0;
}
