import { db } from '../database/db.ts';
import type { Viewer } from '../../../shared/domain.ts';
export function audit(user: Pick<Viewer, 'id' | 'name'>, action: string, objectId: string, before: unknown, after: unknown, client = db) {
  return client.auditLog.create({ data: { userId: user.id, userName: user.name, action, objectId, before: JSON.stringify(before ?? null), after: JSON.stringify(after ?? null) } });
}
