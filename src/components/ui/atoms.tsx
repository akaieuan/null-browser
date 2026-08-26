import { PAGE_GUTTER } from "@/lib/layout";
import { cn } from "@/lib/utils";

/**
 * The three atoms every surface is built from. There are no other
 * separators in this app: a surface is a Card, a heading is a Kicker,
 * a row is a ListRow, and the space between them is the layout.
 */

/**
 * The mono-uppercase section label. One definition; it used to be this
 * exact class string pasted into seven files, which is how two of them
 * drifted a tracking value apart.
 */
export function Kicker({
  as: Tag = "h2",
  className,
  children,
}: {
  as?: "h2" | "h3" | "span";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * A content surface floating on the chrome: opaque `--background`,
 * card radius, inset by the same PAGE_GUTTER the native page webview
 * is inset by — so a React surface and a live page occupy exactly the
 * same rect and swapping between them moves nothing.
 *
 * Fills its nearest positioned ancestor. No border, no shadow: the
 * tone step off `--chrome` is the whole edge.
 */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-xl bg-card text-foreground",
        className,
      )}
      style={{
        top: 0,
        left: PAGE_GUTTER,
        right: PAGE_GUTTER,
        bottom: PAGE_GUTTER,
      }}
    >
      {children}
    </div>
  );
}

/**
 * One list row. Separation from its neighbours is space; pointing at
 * it is a soft fill. `bleed` widens the fill past the text column so
 * the highlight reads as a row rather than a boxed paragraph — on by
 * default because every list in a Card wants it.
 */
export function ListRow({
  bleed = true,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { bleed?: boolean }) {
  return (
    <div
      {...rest}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted",
        bleed && "-mx-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
