import { z } from 'zod';
import {
  authoredDocumentSchema,
  botCapabilitySchema,
  capabilityIdentity,
} from './contracts.js';
import { slug } from './authored.js';

export const botSettingsSchema = z
  .looseObject({
    defaultPreset: slug.optional(),
    capabilities: z.array(botCapabilitySchema).max(256).default([]),
  })
  .superRefine((config, context) => {
    const seen = new Set<string>();
    for (const [index, capability] of config.capabilities.entries()) {
      const key = capabilityIdentity(capability);
      if (seen.has(key))
        context.addIssue({
          code: 'custom',
          path: ['capabilities', index],
          message: `duplicates ${key}`,
        });
      seen.add(key);
    }
    for (const kind of ['memory', 'terminal'] as const) {
      if (config.capabilities.filter((item) => item.kind === kind).length > 1)
        context.addIssue({
          code: 'custom',
          path: ['capabilities'],
          message: `must contain at most one ${kind}`,
        });
    }
  });

export const cardDataSchema = z.looseObject({
  name: z.string().min(1),
  nickname: z.string().optional(),
  description: z.string().default(''),
  personality: z.string().default(''),
  scenario: z.string().default(''),
  mes_example: z.string().default(''),
  system_prompt: z.string().default(''),
  post_history_instructions: z.string().default(''),
  first_mes: z.string().default(''),
  alternate_greetings: z.array(z.string()).max(64).default([]),
  extensions: z
    .looseObject({
      simplebot: botSettingsSchema.optional(),
      depth_prompt: z
        .looseObject({
          prompt: z.string().default(''),
          depth: z.number().int().nonnegative().default(4),
        })
        .optional(),
    })
    .default({}),
});

export const cardSchema = z.discriminatedUnion('spec', [
  z.looseObject({
    spec: z.literal('chara_card_v2'),
    spec_version: z.literal('2.0'),
    data: cardDataSchema,
  }),
  z.looseObject({
    spec: z.literal('chara_card_v3'),
    spec_version: z.literal('3.0'),
    data: cardDataSchema,
  }),
]);

export type BotDocument = z.infer<typeof cardSchema>;
export type BotSource = z.input<typeof cardSchema>;

/** Validate the card without materializing defaults in the editable source. */
export const cardSourceSchema = z
  .custom<BotSource>()
  .superRefine((value, context) => {
    const result = cardSchema.safeParse(value);
    if (!result.success)
      for (const issue of result.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export const botDocumentSchema = authoredDocumentSchema.extend({
  value: cardSourceSchema,
});
export type BotSettings = z.infer<typeof botSettingsSchema>;
export type Card = z.infer<typeof cardDataSchema>;

export function botSettings(document: BotDocument): BotSettings {
  return document.data.extensions.simplebot ?? { capabilities: [] };
}

/** Blanks are authored swipe choices; a lone empty card opening means none. */
export function botGreetings(document: BotSource): string[] {
  const { first_mes = '', alternate_greetings = [] } = document.data;
  return first_mes.trim() === '' && alternate_greetings.length === 0
    ? []
    : [first_mes, ...alternate_greetings];
}
