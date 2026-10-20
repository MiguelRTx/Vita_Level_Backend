import type { PrismaClient } from '../src/generated/prisma/client.ts';

export const categories = [
  { slug: 'study', name: 'Estudio', displayOrder: 1 },
  { slug: 'exercise', name: 'Ejercicio físico', displayOrder: 2 },
  { slug: 'reading', name: 'Lectura', displayOrder: 3 },
  { slug: 'personal-projects', name: 'Proyectos personales', displayOrder: 4 },
];

export const levels = Array.from({ length: 50 }, (_, index) => ({
  number: index + 1,
  minTotalXp: 100 * index ** 2,
  name: `Nivel ${index + 1}`,
}));

export async function seedCatalog(database: PrismaClient): Promise<void> {
  await database.$transaction(async (transaction) => {
    await transaction.category.createMany({ data: categories, skipDuplicates: true });
    await transaction.level.createMany({ data: levels, skipDuplicates: true });
    await transaction.badge.createMany({
      skipDuplicates: true,
      data: [
        { code: 'first-completion', name: 'Primer paso', description: 'Completa tu primera unidad de actividad.', rule: 'COMPLETION_COUNT', threshold: 1, iconKey: 'first-step' },
        { code: 'ten-completions', name: 'En marcha', description: 'Completa diez unidades de actividad.', rule: 'COMPLETION_COUNT', threshold: 10, iconKey: 'ten-steps' },
        { code: 'seven-day-streak', name: 'Constancia', description: 'Alcanza siete días consecutivos de actividad.', rule: 'STREAK_DAYS', threshold: 7, iconKey: 'flame' },
        { code: 'level-five', name: 'En ascenso', description: 'Alcanza el nivel cinco.', rule: 'LEVEL_REACHED', threshold: 5, iconKey: 'mountain' },
        { code: 'all-categories', name: 'Equilibrio', description: 'Completa al menos una unidad en cada una de las cuatro categorías.', rule: 'CATEGORY_COUNT', threshold: 4, iconKey: 'compass' },
      ],
    });
    await transaction.reward.createMany({
      skipDuplicates: true,
      data: [
        { code: 'explorer-title', name: 'Explorador', description: 'Título de perfil desbloqueado en el nivel dos.', kind: 'PROFILE_TITLE', value: 'Explorador', rule: 'LEVEL_REACHED', threshold: 2 },
        { code: 'consistent-title', name: 'Constante', description: 'Título de perfil por siete días consecutivos.', kind: 'PROFILE_TITLE', value: 'Constante', rule: 'STREAK_DAYS', threshold: 7 },
        { code: 'gold-frame', name: 'Marco dorado', description: 'Elemento visual desbloqueado en el nivel cinco.', kind: 'PROFILE_FRAME', value: 'gold', rule: 'LEVEL_REACHED', threshold: 5 },
      ],
    });
  });
}
