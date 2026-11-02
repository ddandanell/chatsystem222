/**
 * Menu rows live in mychef_inbox.knowledge with source 'menu'.
 * No new tables. The runtime role cannot create them. Do not auto-send.
 * Status stays pending, and retrieval refuses this source even if that changes.
 */
import { appPool } from "@/db/client";
import { MYCHEF_WORKSPACE } from "@/data/mychef-store";
import { MENU_SOURCE, addDish, parseMenu, serializeMenu, type Dish, type Menu } from "@/lib/menu-engine";

export type StoredMenu = {
  id: string;
  status: string;
  updatedAt: Date;
  menu: Menu;
};

async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await appPool.query(text, params);
  return result.rows as T[];
}

export async function listMenus(): Promise<StoredMenu[]> {
  const rows = await query<{ id: string; content: string; status: string; updated_at: Date }>(
    `select id, content, status, updated_at
     from mychef_inbox.knowledge
     where workspace_id = $1 and source = $2
     order by updated_at desc`,
    [MYCHEF_WORKSPACE, MENU_SOURCE],
  );
  const menus: StoredMenu[] = [];
  for (const row of rows) {
    const menu = parseMenu(row.content);
    if (!menu) continue;
    menus.push({ id: row.id, status: row.status, updatedAt: row.updated_at, menu });
  }
  return menus;
}

export async function saveMenuDish(input: {
  menuId: string | null;
  menuName: string;
  course: string;
  dish: Dish;
}) {
  if (input.menuId) {
    const existing = await query<{ id: string; content: string }>(
      `select id, content from mychef_inbox.knowledge
       where workspace_id = $1 and id = $2 and source = $3`,
      [MYCHEF_WORKSPACE, input.menuId, MENU_SOURCE],
    );
    const current = existing[0] ? parseMenu(existing[0].content) : null;
    if (!existing[0] || !current) {
      return { ok: false as const, error: "That menu is not in this workspace." };
    }
    const next = addDish(current, input.course, input.dish);
    await query(
      `update mychef_inbox.knowledge
       set content = $3, title = $4, updated_at = now(), version = version + 1
       where workspace_id = $1 and id = $2 and source = $5`,
      [MYCHEF_WORKSPACE, existing[0].id, serializeMenu(next), next.name, MENU_SOURCE],
    );
    return { ok: true as const, id: existing[0].id };
  }
  const id = `menu-${crypto.randomUUID()}`;
  const menu = addDish({ name: input.menuName, courses: [] }, input.course, input.dish);
  await query(
    `insert into mychef_inbox.knowledge
       (workspace_id, id, title, content, category, status, scope, source, version, project_id, area_id, created_at, updated_at)
     values ($1, $2, $3, $4, 'pricing', 'pending', 'menu', $5, 1, 'mychef', 'general', now(), now())`,
    [MYCHEF_WORKSPACE, id, menu.name, serializeMenu(menu), MENU_SOURCE],
  );
  return { ok: true as const, id };
}
