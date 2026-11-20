type DateValue = Date | string;

export function dayKey(date: DateValue): string {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
}

export function todayKey(now: DateValue = new Date()): string {
  return dayKey(now);
}

export function daysUntil(deadline: DateValue, now: DateValue = new Date()): number {
  return (Date.parse(dayKey(deadline)) - Date.parse(todayKey(now))) / 86400000;
}

export function isOverdue(deadline: DateValue, status: string, now: DateValue = new Date()) {
  return status !== 'COMPLETED' && dayKey(deadline) < todayKey(now);
}

export function displayStatus(
  activity: { status: string; deadline: DateValue; startDate: DateValue },
  now: DateValue = new Date(),
) {
  if (isOverdue(activity.deadline, activity.status, now)) return 'OVERDUE';
  if (activity.status === 'NOT_STARTED' && dayKey(activity.startDate) > todayKey(now)) {
    return 'NOT_DUE';
  }
  return activity.status;
}
