import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
export const db = new PrismaClient();
export const activityInclude = {
  executor: { select: { id: true, name: true, department: true } },
  risk: true,
  evidence: true,
  comments: { orderBy: { createdAt: 'desc' as const } },
  flags: { where: { active: true } },
};
