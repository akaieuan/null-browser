/**
 * What a panel shows before it has anything to show.
 *
 * Left-aligned on the panel's own measure, not centred in the void. A
 * panel keeps one left edge whether or not it has content: the heading,
 * the first row, and this message all start at the same x, so the layout
 * does not rearrange itself the moment the first item arrives.
 *
 * The `hint` is where the honest detail goes — where the files actually
 * are, what the list will contain. Empty states are the one place a user
 * is guaranteed to read, so they carry information rather than
 * encouragement.
 */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="pt-4">
      <p className="text-sm text-foreground">{title}</p>
      {children && (
        <p className="mt-1 max-w-md text-xs font-light leading-relaxed text-muted-foreground">
          {children}
        </p>
      )}
    </div>
  );
}
