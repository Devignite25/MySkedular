import { describe, it, expect } from 'vitest';
import {
  calculateShiftDuration,
  calculateWeeklyHours,
  detectOverlappingShifts,
  checkAvailabilityConflicts,
  validateWeeklyHoursLimit
} from './schedulingRules';
import type { EmployeeAvailability } from '../types';

describe('Scheduling Rules Utilities', () => {
  // 1. Shift duration tests (including overnight / invalid)
  describe('calculateShiftDuration', () => {
    it('calculates duration for standard shifts', () => {
      expect(calculateShiftDuration('09:00', '17:00')).toBe(8);
      expect(calculateShiftDuration('08:30', '14:15')).toBe(5.75);
    });

    it('calculates duration for overnight shifts crossing midnight', () => {
      expect(calculateShiftDuration('22:00', '06:00')).toBe(8);
      expect(calculateShiftDuration('20:00', '02:30')).toBe(6.5);
    });

    it('handles same start/end time as zero duration', () => {
      expect(calculateShiftDuration('10:00', '10:00')).toBe(0);
    });
  });

  // 2. Weekly hours calculation
  describe('calculateWeeklyHours', () => {
    it('sums shifts correctly', () => {
      const shifts = [
        { start_time: '09:00', end_time: '17:00' }, // 8h
        { start_time: '10:00', end_time: '15:30' }, // 5.5h
        { start_time: '22:00', end_time: '06:00' }, // 8h
      ];
      expect(calculateWeeklyHours(shifts)).toBe(21.5);
    });

    it('returns 0 for empty list', () => {
      expect(calculateWeeklyHours([])).toBe(0);
    });
  });

  // 3. Overlap detection
  describe('detectOverlappingShifts', () => {
    const employeeId = 'emp-1';
    
    it('detects overlapping shifts on same day', () => {
      const shifts = [
        { employee_id: employeeId, shift_date: '2026-07-13', start_time: '09:00', end_time: '15:00' },
        { employee_id: employeeId, shift_date: '2026-07-13', start_time: '14:00', end_time: '20:00' }
      ];
      expect(detectOverlappingShifts(employeeId, shifts)).toBe(true);
    });

    it('detects overnight overlap on adjacent days', () => {
      const shifts = [
        { employee_id: employeeId, shift_date: '2026-07-13', start_time: '22:00', end_time: '06:00' }, // ends 06:00 Jul 14
        { employee_id: employeeId, shift_date: '2026-07-14', start_time: '05:00', end_time: '11:00' }  // starts 05:00 Jul 14 (overlaps 5am-6am)
      ];
      expect(detectOverlappingShifts(employeeId, shifts)).toBe(true);
    });

    it('allows back-to-back shifts without overlap', () => {
      const shifts = [
        { employee_id: employeeId, shift_date: '2026-07-13', start_time: '09:00', end_time: '15:00' },
        { employee_id: employeeId, shift_date: '2026-07-13', start_time: '15:00', end_time: '21:00' }
      ];
      expect(detectOverlappingShifts(employeeId, shifts)).toBe(false);
    });
  });

  // 4. Availability conflict detection
  describe('checkAvailabilityConflicts', () => {
    const availabilities: EmployeeAvailability[] = [
      {
        id: '1',
        employee_id: 'emp-1',
        day_of_week: 0, // Mon
        available: true,
        earliest_start: '09:00:00',
        latest_end: '17:00:00',
        created_at: '',
        updated_at: ''
      },
      {
        id: '2',
        employee_id: 'emp-1',
        day_of_week: 2, // Wed
        available: false, // unavailable
        earliest_start: null,
        latest_end: null,
        created_at: '',
        updated_at: ''
      }
    ];

    it('flags conflict if scheduled on unavailable day', () => {
      const shift = { shift_date: '2026-07-15', start_time: '10:00', end_time: '14:00' };
      expect(checkAvailabilityConflicts(shift, availabilities)).toBe(true);
    });

    it('flags conflict if shift starts before earliest start time', () => {
      const shift = { shift_date: '2026-07-13', start_time: '08:00', end_time: '16:00' };
      expect(checkAvailabilityConflicts(shift, availabilities)).toBe(true);
    });

    it('flags conflict if shift ends after latest end time', () => {
      const shift = { shift_date: '2026-07-13', start_time: '10:00', end_time: '18:00' };
      expect(checkAvailabilityConflicts(shift, availabilities)).toBe(true);
    });

    it('passes (no conflict) if within availability limits', () => {
      const shift = { shift_date: '2026-07-13', start_time: '09:00', end_time: '17:00' };
      expect(checkAvailabilityConflicts(shift, availabilities)).toBe(false);
    });
  });

  // 5. 39-hour validation
  describe('validateWeeklyHoursLimit', () => {
    const employeeId = 'emp-1';
    const existingShifts = [
      { employee_id: employeeId, start_time: '09:00', end_time: '17:00' }, // 8h
      { employee_id: employeeId, start_time: '09:00', end_time: '17:00' }, // 8h
      { employee_id: employeeId, start_time: '09:00', end_time: '17:00' }, // 8h
      { employee_id: employeeId, start_time: '09:00', end_time: '17:00' }, // 8h
    ]; // Total = 32h

    it('flags limit exceeded if new shift hours exceed 39', () => {
      expect(validateWeeklyHoursLimit(existingShifts, employeeId, 8)).toBe(true); // 32 + 8 = 40h (>39)
    });

    it('allows new shift hours that keep total at or below 39', () => {
      expect(validateWeeklyHoursLimit(existingShifts, employeeId, 7)).toBe(false); // 32 + 7 = 39h (valid)
    });
  });
});
