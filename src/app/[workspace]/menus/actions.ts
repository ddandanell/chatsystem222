"use server";

/**
 * Save one dish onto a menu. Does not approve it and does not send. Do not auto-send.
 */
import { redirect } from "next/navigation";
import { saveMenuDish } from "@/data/menu-store";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { parseDishInput } from "@/lib/menu-engine";
import { canReview } from "@/lib/workspace-access";

export async function saveMenuDishAction(slug: string, formData: FormData) {
  const access = await getWorkspaceAccess(slug);
  if (access.status !== "ok" || !canReview(access.ctx.role)) {
    redirect(`/${slug}/menus?error=${encodeURIComponent("You cannot edit menus.")}`);
  }
  if (!usesMychefInbox()) {
    redirect(`/${slug}/menus?error=${encodeURIComponent("Menus are stored on the myCHEF workspace.")}`);
  }
  const parsed = parseDishInput({
    menuName: String(formData.get("menu_name") ?? ""),
    course: String(formData.get("course") ?? ""),
    dish: String(formData.get("dish") ?? ""),
    allergens: formData.getAll("allergens").map((value) => String(value)),
    price: String(formData.get("price") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.ok) {
    redirect(`/${slug}/menus?error=${encodeURIComponent(parsed.error)}`);
  }
  const menuId = String(formData.get("menu_id") ?? "").trim();
  if (!menuId && !parsed.menuName) {
    redirect(`/${slug}/menus?error=${encodeURIComponent("Name the menu.")}`);
  }
  const saved = await saveMenuDish({
    menuId: menuId || null,
    menuName: parsed.menuName,
    course: parsed.course,
    dish: parsed.dish,
  });
  if (!saved.ok) {
    redirect(`/${slug}/menus?error=${encodeURIComponent(saved.error)}`);
  }
  redirect(`/${slug}/menus?saved=1`);
}
