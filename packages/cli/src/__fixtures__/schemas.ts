import { z } from 'zod';

/** Schemas of a "shared package", imported by the generated contracts. */
export const RenameSchema = z.object({ name: z.string().trim().min(1) });
export const HouseholdSchema = z.object({ id: z.string(), name: z.string() });
