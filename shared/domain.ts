export const roles = { ADMIN: 'Адміністратор', COORDINATOR: 'Координатор програми', EXECUTOR: 'Виконавець', MANAGER: 'Керівник', ANALYST: 'Аналітик' } as const;
export const statuses = { NOT_STARTED: 'Не розпочато', IN_PROGRESS: 'У процесі', REVIEW: 'На погодженні', COMPLETED: 'Виконано', OVERDUE: 'Прострочено', REVISION: 'Потребує доопрацювання', NOT_DUE: 'Строк виконання не настав' } as const;
export const priorities = { LOW: 'Низький', MEDIUM: 'Середній', HIGH: 'Високий', CRITICAL: 'Критичний' } as const;
export const sections = { I: 'Загальна відомча політика', II: 'Усунення корупційних ризиків', III: 'Навчання та поширення інформації' } as const;
export const departments = ['Управління закупівель', 'Кадрова служба', 'Фінансовий відділ', 'Управління логістики', 'Відділ доброчесності'];
export type Role = keyof typeof roles;
export type Status = keyof typeof statuses;
export type Viewer = { id: string; name: string; email: string; role: Role; department: string };
export function reached(current: number | null, baseline: number, target: number) { return current !== null && (target >= baseline ? current >= target : current <= target); }
