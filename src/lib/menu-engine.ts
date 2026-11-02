/**
 * Phase 3 menu catalog. Courses, dishes, allergens, and prices.
 * A playbook writes words a person can copy. Nothing here sends.
 * A menu is not knowledge: drafts must not quote it.
 */

export const MENU_SOURCE = "menu";

export const ALLERGENS = [
  "gluten",
  "dairy",
  "egg",
  "fish",
  "shellfish",
  "nuts",
  "peanuts",
  "soy",
  "sesame",
] as const;

export type Allergen = (typeof ALLERGENS)[number];

export type Dish = {
  name: string;
  allergens: Allergen[];
  priceIdr: number | null;
  note: string;
};

export type Course = {
  name: string;
  dishes: Dish[];
};

export type Menu = {
  name: string;
  courses: Course[];
};

export const MENU_PLAYBOOKS = [
  { id: "confirmation", label: "Official confirmation" },
  { id: "goodbye", label: "Polite goodbye" },
  { id: "check_in", label: "3-day check-in" },
] as const;

export type MenuPlaybookId = (typeof MENU_PLAYBOOKS)[number]["id"];

const ALLERGEN_SET = new Set<string>(ALLERGENS);

export function isAllergen(value: string): value is Allergen {
  return ALLERGEN_SET.has(value);
}

export function formatIdr(value: number): string {
  return `IDR ${new Intl.NumberFormat("en-GB").format(value)}`;
}

export function formatWhatsApp(menu: Menu): string {
  const lines = [`*${menu.name.trim()}*`];
  for (const course of menu.courses) {
    lines.push("");
    lines.push(course.name.trim());
    for (const dish of course.dishes) {
      const price = dish.priceIdr == null ? "price on request" : formatIdr(dish.priceIdr);
      lines.push(`• ${dish.name.trim()} — ${price}`);
      if (dish.allergens.length > 0) lines.push(`  Allergens: ${dish.allergens.join(", ")}`);
      if (dish.note.trim()) lines.push(`  ${dish.note.trim()}`);
    }
  }
  return lines.join("\n");
}

export function searchDishes(menus: { id: string; menu: Menu }[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: { menuId: string; menuName: string; course: string; dish: Dish }[] = [];
  for (const item of menus) {
    for (const course of item.menu.courses) {
      for (const dish of course.dishes) {
        const hay = `${dish.name} ${dish.note} ${dish.allergens.join(" ")} ${course.name}`.toLowerCase();
        if (hay.includes(needle)) {
          hits.push({
            menuId: item.id,
            menuName: item.menu.name,
            course: course.name,
            dish,
          });
        }
      }
    }
  }
  return hits;
}

export function playbookText(id: MenuPlaybookId, menu: Menu | null): string {
  const sheet = menu ? `\n\n${formatWhatsApp(menu)}` : "";
  if (id === "confirmation") {
    return [
      "Hello, this confirms the menu we discussed.",
      sheet,
      "",
      "Please tell us if any guest allergen is missing, or if the headcount has changed.",
      "A person still confirms the booking. This note is not sent from the console.",
    ]
      .join("\n")
      .trim();
  }
  if (id === "goodbye") {
    return [
      "Thank you for being with us. It was a pleasure to cook for you.",
      "If something from the evening should be remembered for next time, reply with that note and a person will keep it.",
      "This note is not sent from the console.",
    ].join("\n");
  }
  return [
    "Hello, your dinner is three days away.",
    "Please confirm the headcount and tell us if any allergen has changed.",
    sheet,
    "",
    "A person reads the reply before anything is promised. This note is not sent from the console.",
  ]
    .join("\n")
    .trim();
}

export function serializeMenu(menu: Menu): string {
  return JSON.stringify({
    name: menu.name.trim(),
    courses: menu.courses.map((course) => ({
      name: course.name.trim(),
      dishes: course.dishes.map((dish) => ({
        name: dish.name.trim(),
        allergens: dish.allergens,
        priceIdr: dish.priceIdr,
        note: dish.note.trim(),
      })),
    })),
  });
}

export function parseMenu(content: string): Menu | null {
  try {
    const raw = JSON.parse(content) as { name?: unknown; courses?: unknown };
    if (typeof raw.name !== "string" || !raw.name.trim() || !Array.isArray(raw.courses)) return null;
    const courses: Course[] = [];
    for (const course of raw.courses) {
      if (!course || typeof course !== "object") return null;
      const row = course as { name?: unknown; dishes?: unknown };
      if (typeof row.name !== "string" || !row.name.trim() || !Array.isArray(row.dishes)) return null;
      const dishes: Dish[] = [];
      for (const dish of row.dishes) {
        if (!dish || typeof dish !== "object") return null;
        const item = dish as { name?: unknown; allergens?: unknown; priceIdr?: unknown; note?: unknown };
        if (typeof item.name !== "string" || !item.name.trim()) return null;
        const allergens = Array.isArray(item.allergens)
          ? item.allergens.filter((value): value is Allergen => typeof value === "string" && isAllergen(value))
          : [];
        const priceIdr =
          typeof item.priceIdr === "number" && Number.isInteger(item.priceIdr) && item.priceIdr >= 0
            ? item.priceIdr
            : null;
        dishes.push({
          name: item.name.trim(),
          allergens,
          priceIdr,
          note: typeof item.note === "string" ? item.note.trim() : "",
        });
      }
      courses.push({ name: row.name.trim(), dishes });
    }
    return { name: raw.name.trim(), courses };
  } catch {
    return null;
  }
}

export function parseDishInput(input: {
  menuName: string;
  course: string;
  dish: string;
  allergens: string[];
  price: string;
  note: string;
}): { ok: true; menuName: string; course: string; dish: Dish } | { ok: false; error: string } {
  const menuName = input.menuName.trim().slice(0, 80);
  const course = input.course.trim().slice(0, 40);
  const name = input.dish.trim().slice(0, 80);
  if (!course) return { ok: false, error: "Name the course." };
  if (!name) return { ok: false, error: "Name the dish." };
  const allergens = input.allergens.filter(isAllergen);
  const rawPrice = input.price.replace(/[, ]/g, "").trim();
  let priceIdr: number | null = null;
  if (rawPrice) {
    if (!/^\d+$/.test(rawPrice)) return { ok: false, error: "Price is a whole number of rupiah, or leave it blank." };
    priceIdr = Number(rawPrice);
    if (priceIdr > 100_000_000) return { ok: false, error: "That price is too large to store." };
  }
  return {
    ok: true,
    menuName,
    course,
    dish: { name, allergens, priceIdr, note: input.note.trim().slice(0, 160) },
  };
}

export function addDish(menu: Menu, courseName: string, dish: Dish): Menu {
  const courses = menu.courses.map((course) => ({ ...course, dishes: [...course.dishes] }));
  const existing = courses.find((course) => course.name.toLowerCase() === courseName.toLowerCase());
  if (existing) existing.dishes.push(dish);
  else courses.push({ name: courseName, dishes: [dish] });
  return { name: menu.name, courses };
}
