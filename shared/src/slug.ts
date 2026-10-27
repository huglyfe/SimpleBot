import { z } from 'zod';

export const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u);
