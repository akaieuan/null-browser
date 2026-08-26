import {
  Activity,
  History as HistoryIcon,
  PanelLeft,
  Plus,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useRef, useState } from "react";

import { SidebarRow } from "@/components/SidebarRow";
import { SiteIcon } from "@/components/SiteIcon";
import { Button } from "@/components/ui/button";
import { SIDEBAR_HEADER_HEIGHT, TRAFFIC_LIGHT_INSET } from "@/lib/layout";
import { cn } from "@/lib/utils";
import type { Bookmark } from "@/lib/ipc";

export type Tab = {
  id: string;
  url: string;
  title: string;
  hasWebview: boolean;
};

/** What the content column is currently showing. */
export type Selection =
  | { kind: "tab" }
  | { kind: "history" }
  | { kind: "network" }
  | { kind: "settings" };

/**
 * The source list.
 *
 * **No section headings.** They used to read BOOKMARKS / TABS / LIBRARY.
 * Permanence is encoded in form and position instead: saved sites are
 * icon tiles at the top and never scroll away; tabs are labelled rows
 * below and will; utilities are an icon rail at the bottom. A heading
 * that only restates what the shape already says is three lines of
 * furniture in the calmest part of the app.
 *
 * Saved sites sit above tabs because they are a bounded, curated,
 * low-churn set and tabs are unbounded: putting the bounded one first
 * pins it to a stable y forever and gives the scroll budget to the list
 * that needs it.
 *
 * Notes is deliberately absent: it is summoned next to a page from the
 * toolbar, not a place in the source list.
 */
export function Sidebar({
  width,
  tabs,
  activeTabId,
  loadingTabs,
  bookmarks,
  selection,
  iconFor,
  onToggleSidebar,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onTabContextMenu,
  onOpenBookmark,
  onOpenBookmarkInNewTab,
  onBookmarkContextMenu,
  onReorderBookmarks,
  onSelectPanel,
  onDropTabToSplit,
  onDropBookmarkToSplit,
  onSplitDragOver,
  onPinTab,
  onGroupBookmarks,
  onMoveBookmark,
}: {
  width: number;
  tabs: Tab[];
  activeTabId: string | null;
  loadingTabs: Set<string>;
  bookmarks: Bookmark[];
  selection: Selection;
  /** Captured favicon for a URL's origin, or null for the letter tile. */
  iconFor: (url: string) => string | null;
  onToggleSidebar: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onTabContextMenu: (e: React.MouseEvent, id: string) => void;
  onOpenBookmark: (url: string) => void;
  onOpenBookmarkInNewTab: (url: string) => void;
  onBookmarkContextMenu: (e: React.MouseEvent, id: number) => void;
  onReorderBookmarks: (ids: number[]) => void;
  onSelectPanel: (kind: "history" | "network" | "settings") => void;
  /** A tab row was dragged out of the sidebar onto the page area. */
  onDropTabToSplit: (tabId: string) => void;
  /** A bookmark tile was dragged out of the sidebar onto the page area. */
  onDropBookmarkToSplit: (url: string) => void;
  /** Live during a drag: is the pointer over the page area right now?
      Drives the drop-target preview — the page yields half its width
      so the "where this will go" is shown, not guessed. */
  onSplitDragOver: (over: boolean) => void;
  /** A tab row was dropped on the pin grid (or on a folder tile). */
  onPinTab: (tabId: string, folderId: number | null) => void;
  /** A pin was dropped dead-centre on another pin: fold both. */
  onGroupBookmarks: (targetId: number, draggedId: number) => void;
  /** A pin was dropped dead-centre on a folder: move it in. */
  onMoveBookmark: (id: number, folderId: number | null) => void;
}) {
  /** Which folder's contents are spread open below the grid. */
  const [openFolder, setOpenFolder] = useState<number | null>(null);

  const roots = bookmarks.filter((b) => b.parent_id === null);
  const childrenOf = (folderId: number) =>
    bookmarks.filter((b) => b.parent_id === folderId);
  const open = openFolder !== null ? childrenOf(openFolder) : [];
  // Pointer only, deliberately. A tile's drag listeners live on the same
  // button that opens it, so a KeyboardSensor here claims Enter and Space
  // for "start a drag" and calls preventDefault — leaving no keyboard
  // path to the tile's actual purpose. Reordering by keyboard needs a
  // separate focusable activator before the sensor can come back.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Deduped: report only transitions, not every pointer move.
  const overPageRef = useRef(false);
  const reportOver = (over: boolean) => {
    if (overPageRef.current === over) return;
    overPageRef.current = over;
    onSplitDragOver(over);
  };

  const handleDragMove = (e: DragMoveEvent) => {
    const at = e.active.rect.current.translated;
    reportOver(!!at && at.left + at.width / 2 > width + 24);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    reportOver(false);
    const { active, over } = e;

    // Dropped past the sidebar's right edge = onto the page area. The
    // page is a native webview, so there is no DOM drop target to hit —
    // the *position* is the drop target.
    const at = active.rect.current.translated;
    const ontoPage = !!at && at.left + at.width / 2 > width + 24;

    const id = String(active.id);
    const target =
      over != null ? roots.find((b) => b.id === over.id) : undefined;

    // Dead-centre on a tile means "into it"; the edges mean "beside
    // it" (reorder). The iOS folder gesture, by geometry.
    const centred =
      !!at &&
      !!over?.rect &&
      at.left + at.width / 2 > over.rect.left + over.rect.width * 0.25 &&
      at.left + at.width / 2 < over.rect.left + over.rect.width * 0.75 &&
      at.top + at.height / 2 > over.rect.top + over.rect.height * 0.25 &&
      at.top + at.height / 2 < over.rect.top + over.rect.height * 0.75;

    if (id.startsWith("tab:")) {
      if (ontoPage) {
        onDropTabToSplit(id.slice(4));
      } else if (target) {
        onPinTab(id.slice(4), target.kind === "folder" ? target.id : null);
      }
      return;
    }
    const dragged = bookmarks.find((x) => x.id === active.id);
    if (!dragged) return;
    if (ontoPage) {
      if (dragged.kind === "bookmark") onDropBookmarkToSplit(dragged.url);
      return;
    }
    if (target && centred && dragged.kind === "bookmark" && target.id !== dragged.id) {
      if (target.kind === "folder") {
        onMoveBookmark(dragged.id, target.id);
      } else if (dragged.parent_id === null) {
        onGroupBookmarks(target.id, dragged.id);
      }
      return;
    }
    if (!over || active.id === over.id) return;
    const oldIdx = roots.findIndex((b) => b.id === active.id);
    const newIdx = roots.findIndex((b) => b.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onReorderBookmarks(arrayMove(roots, oldIdx, newIdx).map((b) => b.id));
  };

  const tabSelected = selection.kind === "tab";

  return (
    <aside
      // No right-hand rule, and two different mechanisms replace it
      // because the sidebar borders two different things.
      //
      // Against the page: PAGE_GUTTER leaves a band of chrome, because
      // nothing can be assumed about the pixels a website paints.
      //
      // Against a React surface (Home, a panel), there is no gutter —
      // they are DOM siblings — so the separator is the tone step from
      // `--chrome` to `--card`. In the app both are translucent washes
      // over the window vibrancy — an opaque fill here was exactly the
      // slab that killed the glass on the whole left column.
      className="relative z-20 flex h-full shrink-0 flex-col bg-chrome"
      style={{ width }}
    >
      {/* Header: window-drag surface, and the only thing allowed right of
          the traffic lights. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center"
        style={{
          height: SIDEBAR_HEADER_HEIGHT,
          paddingLeft: TRAFFIC_LIGHT_INSET,
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide sidebar"
          title="Hide sidebar · ⌃⌘S"
          onClick={onToggleSidebar}
          data-tauri-drag-region="false"
        >
          <PanelLeft strokeWidth={1.5} />
        </Button>
      </div>

      {/* One drag opt-out covers every descendant: the window-drag
          handler walks up from the target and bails on the first
          data-tauri-drag-region="false". */}
      <nav
        data-tauri-drag-region="false"
        aria-label="Sidebar"
        className="flex min-h-0 flex-1 flex-col px-2"
      >
        {/* One DndContext over tiles AND tab rows: reordering stays a
            tile affair, but anything here can be dragged onto the page
            to open a split — the drop is positional because the page
            is native and has no DOM to be a target. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={() => reportOver(false)}
        >
          {roots.length > 0 && (
            <>
              <SortableContext
                items={roots.map((b) => b.id)}
                strategy={rectSortingStrategy}
              >
                {/* aria-label, not aria-labelledby: the heading that used
                    to name this group is gone, and icon-only tiles have
                    no text of their own to fall back on. */}
                <ul
                  role="list"
                  aria-label="Saved sites"
                  className="grid shrink-0 grid-cols-4 gap-1.5 pt-1"
                >
                  {roots.map((b) =>
                    b.kind === "folder" ? (
                      <li key={b.id}>
                        <SortableTile
                          bookmark={b}
                          selected={openFolder === b.id}
                          onClick={() =>
                            setOpenFolder((cur) => (cur === b.id ? null : b.id))
                          }
                          onAuxClick={() => {}}
                          onContextMenu={(e) => onBookmarkContextMenu(e, b.id)}
                        >
                          <FolderGlyph
                            items={childrenOf(b.id)}
                            iconFor={iconFor}
                          />
                        </SortableTile>
                      </li>
                    ) : (
                      <li key={b.id}>
                        <SortableTile
                          bookmark={b}
                          onClick={() => onOpenBookmark(b.url)}
                          onAuxClick={(e) => {
                            if (e.button === 1) {
                              e.preventDefault();
                              onOpenBookmarkInNewTab(b.url);
                            }
                          }}
                          onContextMenu={(e) => onBookmarkContextMenu(e, b.id)}
                        >
                          <SiteIcon
                            url={b.url}
                            icon={iconFor(b.url)}
                            size={18}
                            className="rounded"
                          />
                        </SortableTile>
                      </li>
                    ),
                  )}
                </ul>
              </SortableContext>

              {/* The open folder's pins, spread on a recessed surface
                  directly below the grid. Plain tiles — order inside a
                  folder is arrival order for now. */}
              {openFolder !== null && open.length > 0 && (
                <ul
                  role="list"
                  aria-label={`Pins in ${
                    roots.find((b) => b.id === openFolder)?.title ?? "folder"
                  }`}
                  className="mt-1.5 grid shrink-0 grid-cols-4 gap-1.5 rounded-lg bg-card p-1.5"
                >
                  {open.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        aria-label={b.title || b.url}
                        title={`${b.title || b.url}\n${b.url}`}
                        onClick={() => onOpenBookmark(b.url)}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            onOpenBookmarkInNewTab(b.url);
                          }
                        }}
                        onContextMenu={(e) => onBookmarkContextMenu(e, b.id)}
                        className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <SiteIcon
                          url={b.url}
                          icon={iconFor(b.url)}
                          size={16}
                          className="rounded"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="h-3 shrink-0" />
            </>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul role="list" aria-label="Tabs">
              {tabs.map((t) => (
                <li key={t.id}>
                  <DraggableTabRow
                    tab={t}
                    icon={
                      t.hasWebview ? (
                        <SiteIcon url={t.url} icon={iconFor(t.url)} size={14} />
                      ) : undefined
                    }
                    selected={t.id === activeTabId}
                    focused={tabSelected}
                    loading={loadingTabs.has(t.id)}
                    closable={tabs.length > 1 || t.hasWebview}
                    onSelect={() => onSelectTab(t.id)}
                    onClose={() => onCloseTab(t.id)}
                    onContextMenu={(e) => onTabContextMenu(e, t.id)}
                  />
                </li>
              ))}
            </ul>
            <SidebarRow
              label="New tab"
              icon={<Plus size={12} strokeWidth={1.75} />}
              onClick={onNewTab}
            />
          </div>
        </DndContext>
      </nav>

      {/* Utility rail. No rule above it — the gap separates it, and a
          hairline there reads as a seam in one continuous surface. */}
      <div
        data-tauri-drag-region="false"
        className="flex shrink-0 items-center gap-0.5 px-2 pb-2 pt-1"
      >
        <RailButton
          label="History"
          selected={selection.kind === "history"}
          onClick={() => onSelectPanel("history")}
        >
          <HistoryIcon size={14} strokeWidth={1.5} />
        </RailButton>
        <RailButton
          label="Network"
          selected={selection.kind === "network"}
          onClick={() => onSelectPanel("network")}
        >
          <Activity size={14} strokeWidth={1.5} />
        </RailButton>
        <div className="flex-1" />
        <RailButton
          label="Settings"
          selected={selection.kind === "settings"}
          onClick={() => onSelectPanel("settings")}
        >
          <SettingsIcon size={14} strokeWidth={1.5} />
        </RailButton>
      </div>
    </aside>
  );
}

/**
 * A rail button cannot carry SidebarRow's 2px leading bar — it is square
 * and has no leading edge to speak of — so selection is a muted fill plus
 * full-strength ink, and the accent stays out of it.
 */
function RailButton({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A tab row that can be dragged out of the sidebar and dropped on the
 * page to open a split. The drag listeners live on the row's own
 * button (via `dragProps`), so the row stays one tab stop; the 6px
 * activation distance keeps plain clicks working.
 *
 * Honest limitation: once the pointer crosses onto a live page, the
 * drag *preview* vanishes — native webviews paint over everything
 * React draws. The drop still lands, because the pointer stream keeps
 * flowing to the view that took the pointer-down.
 */
function DraggableTabRow({
  tab,
  icon,
  selected,
  focused,
  loading,
  closable,
  onSelect,
  onClose,
  onContextMenu,
}: {
  tab: Tab;
  icon?: React.ReactNode;
  selected: boolean;
  focused: boolean;
  loading: boolean;
  closable: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `tab:${tab.id}` });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <SidebarRow
        label={tab.title || "New Tab"}
        title={tab.hasWebview ? `${tab.title}\n${tab.url}` : undefined}
        icon={icon}
        dimIcon={false}
        selected={selected}
        focused={focused}
        loading={loading}
        onClick={onSelect}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onClose();
          }
        }}
        onContextMenu={onContextMenu}
        dragProps={{ ...attributes, ...listeners }}
        trailing={
          closable ? (
            <button
              type="button"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X size={11} strokeWidth={1.5} />
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

function SortableTile({
  bookmark,
  selected = false,
  onClick,
  onAuxClick,
  onContextMenu,
  children,
}: {
  bookmark: Bookmark;
  /** Folder tiles mark their open state; pins never set this. */
  selected?: boolean;
  onClick: () => void;
  onAuxClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: bookmark.id });

  const name = bookmark.title || bookmark.url;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        onAuxClick={onAuxClick}
        onContextMenu={onContextMenu}
        // The tile shows no text, so the accessible name has to be here.
        aria-label={name}
        title={bookmark.url ? `${name}\n${bookmark.url}` : name}
        // A tone step, not an outline — and it steps off `--muted`,
        // which is the sidebar's own ground, so the step is
        // muted→accent rather than background→muted.
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-xl transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          selected ? "bg-accent" : "bg-accent/60 hover:bg-accent",
        )}
        {...attributes}
        {...listeners}
      >
        {children}
      </button>
    </div>
  );
}

/**
 * A folder tile's face: up to four member icons in a 2×2, the iOS
 * grammar for "these live together". Empty slots are faint dots so a
 * two-item folder still reads as a folder, not a broken tile.
 */
function FolderGlyph({
  items,
  iconFor,
}: {
  items: Bookmark[];
  iconFor: (url: string) => string | null;
}) {
  return (
    <span className="grid grid-cols-2 gap-1" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => {
        const b = items[i];
        return b ? (
          <SiteIcon
            key={b.id}
            url={b.url}
            icon={iconFor(b.url)}
            size={11}
            className="rounded-[2px]"
          />
        ) : (
          <span
            key={`empty-${i}`}
            className="h-[11px] w-[11px] rounded-[2px] bg-muted-foreground/15"
          />
        );
      })}
    </span>
  );
}
