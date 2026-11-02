/**
 * Phase 3 menu catalog. Courses, allergens, prices, and copy-only playbooks.
 * Do not auto-send. Menus are not quoted in drafts.
 */
import Link from "next/link";
import { saveMenuDishAction } from "@/app/[workspace]/menus/actions";
import { listMenus } from "@/data/menu-store";
import { usesMychefInbox } from "@/db/mode";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspaceAccess } from "@/lib/context";
import {
  ALLERGENS,
  MENU_PLAYBOOKS,
  formatIdr,
  formatWhatsApp,
  playbookText,
  searchDishes,
} from "@/lib/menu-engine";
import { canReview } from "@/lib/workspace-access";
import { cn } from "cn";

export const metadata = { title: "Menus" };

export default async function MenusPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/menus">) {
  const { workspace } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const slug = access.ctx.orgSlug;
  const error = typeof query.error === "string" ? query.error : "";
  const saved = query.saved === "1";
  const search = typeof query.q === "string" ? query.q : "";
  const neon = usesMychefInbox();
  const menus = neon ? await listMenus() : [];
  const hits = searchDishes(menus, search);
  const save = saveMenuDishAction.bind(null, slug);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Menus</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Courses, dishes, allergens, and prices for myCHEF. A playbook is text you can copy.
          Nothing on this page is sent, and a draft cannot quote a menu.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Menu not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <AlertTitle>Dish stored</AlertTitle>
          <AlertDescription>It stays pending. It is not a live rule and it is not sent.</AlertDescription>
        </Alert>
      ) : null}

      <form className="flex max-w-xl gap-2" action={`/${slug}/menus`}>
        <input
          name="q"
          defaultValue={search}
          placeholder="Search dishes or allergens"
          aria-label="Search dishes"
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Search
        </button>
      </form>
      {search ? (
        <ul className="flex flex-col gap-2">
          {hits.length === 0 ? (
            <li className="text-sm text-muted-foreground">No dish matches that search.</li>
          ) : (
            hits.map((hit) => (
              <li key={`${hit.menuId}:${hit.course}:${hit.dish.name}`} className="text-sm">
                <span className="font-medium">{hit.dish.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {hit.menuName} · {hit.course}
                  {hit.dish.priceIdr == null ? " · price on request" : ` · ${formatIdr(hit.dish.priceIdr)}`}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {menus.length === 0 ? (
        <p className="text-sm text-muted-foreground">No menus yet. Add the first dish below.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {menus.map((item) => (
            <li key={item.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{item.menu.name}</CardTitle>
                    <Badge variant="outline">Pending</Badge>
                  </div>
                  <CardDescription>Not sent. Not quoted in a draft.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {item.menu.courses.map((course) => (
                    <div key={course.name} className="flex flex-col gap-1">
                      <h2 className="text-sm font-medium">{course.name}</h2>
                      <ul className="flex flex-col gap-1">
                        {course.dishes.map((dish) => (
                          <li key={`${course.name}:${dish.name}`} className="text-sm">
                            {dish.name}
                            {dish.priceIdr == null ? " · price on request" : ` · ${formatIdr(dish.priceIdr)}`}
                            {dish.allergens.length > 0 ? (
                              <span className="text-muted-foreground"> · {dish.allergens.join(", ")}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium">WhatsApp text</h2>
                    <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                      {formatWhatsApp(item.menu)}
                    </pre>
                  </div>
                  <div className="flex flex-col gap-3">
                    {MENU_PLAYBOOKS.map((playbook) => (
                      <div key={playbook.id} className="flex flex-col gap-1">
                        <h2 className="text-sm font-medium">{playbook.label}</h2>
                        <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap">
                          {playbookText(playbook.id, item.menu)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canReview(access.ctx.role) ? (
        <form action={save} className="flex max-w-xl flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">Add a dish</h2>
          {menus.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              Existing menu
              <select name="menu_id" className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">New menu</option>
                {menus.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.menu.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            Menu name
            <input
              name="menu_name"
              maxLength={80}
              placeholder="Required when this is a new menu"
              className="h-9 rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Course
            <input
              name="course"
              required
              maxLength={40}
              placeholder="Canapés, main, dessert"
              className="h-9 rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Dish
            <input name="dish" required maxLength={80} className="h-9 rounded-md border bg-background px-3 text-sm" />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">Allergens</legend>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map((allergen) => (
                <label key={allergen} className="flex min-h-11 items-center gap-2 rounded-md border px-2 text-sm">
                  <input type="checkbox" name="allergens" value={allergen} />
                  {allergen}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            Price in rupiah
            <input
              name="price"
              inputMode="numeric"
              placeholder="Leave blank if the price is not set"
              className="h-9 rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note
            <input name="note" maxLength={160} className="h-9 rounded-md border bg-background px-3 text-sm" />
          </label>
          <button type="submit" className={cn(buttonVariants({ variant: "default" }), "w-fit")}>
            Save dish
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Your role can read menus. A reviewer adds a dish.</p>
      )}
      {!neon ? (
        <p className="text-sm text-muted-foreground">
          This workspace is not the myCHEF database, so dishes are not stored here.{" "}
          <Link href="/mychef/menus" className="underline">
            Open myCHEF menus
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
