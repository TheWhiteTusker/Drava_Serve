import { eq, sql } from 'drizzle-orm';
import { registerApproval } from '../approvals.js';
import { Ctx, findOr404 } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { recost } from './costing.js';
import { rerankOutlet } from './ranking.js';
import { runOffers } from './offers.js';
import { writeRecipe, type RecipeLineInput } from './recipes.js';

// After a price or recipe changes: new cost row now; order and offers once committed.
export function afterMenuChange(ctx: Ctx, item: { id: string; outletId: string }, reason: string) {
  ctx.afterCommit(async () => {
    await ctx.tx((tx) => recost(ctx, tx, [item.id], reason));
    await rerankOutlet(ctx, item.outletId);
    await runOffers(ctx, item.outletId);
  });
}

registerApproval('price_change', 'Menu price change', async (ctx, tx, req) => {
  const p = req.proposed as { menuItemId: string; sellingPrice: string };
  const [item] = await tx
    .update(t.menuItem)
    .set({ sellingPrice: p.sellingPrice, version: sql`${t.menuItem.version} + 1`, updatedAt: new Date() })
    .where(eq(t.menuItem.id, p.menuItemId))
    .returning();
  afterMenuChange(ctx, item, 'price change');
});

registerApproval('recipe_change', 'Recipe change that takes margin under target', async (ctx, tx, req) => {
  const p = req.proposed as { menuItemId: string; lines: RecipeLineInput[] };
  const item = await findOr404(tx.select().from(t.menuItem).where(eq(t.menuItem.id, p.menuItemId)));
  await writeRecipe(ctx, tx, item, p.lines);
});
