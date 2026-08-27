import { useEffect, useState } from "react";

import {
  CustomStartPageInput,
  Dropdown,
  Row,
  SectionHeader,
} from "@/components/panels/settings/controls";
import {
  isCustomStartPage,
  SEARCH_ENGINES,
  usePreferences,
} from "@/lib/preferences";

/** Start page, search engine, and the local profile name. */
export function BrowsingSection() {
  const {
    name,
    setName,
    startPage,
    setStartPage,
    searchEngine,
    setSearchEngine,
  } = usePreferences();
  const [nameDraft, setNameDraft] = useState(name);

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  const startPageKey: "null" | "duckduckgo" | "custom" =
    startPage === "null" || startPage === "duckduckgo" ? startPage : "custom";
  const customUrl = isCustomStartPage(startPage) ? startPage : "";

  function handleStartPageChange(next: string) {
    if (next === "null" || next === "duckduckgo") {
      setStartPage(next);
    } else if (next === "custom" && !isCustomStartPage(startPage)) {
      setStartPage("");
    }
  }

  return (
    <section>
      <SectionHeader title="Browsing" />
      <div className="mt-1 flex flex-col">
        <Row label="Name">
          {/* Matches the dropdowns beneath it: same height, same width,
              same left-aligned value. Right-aligning text inside a field
              you type into fights the caret for no gain — the row's right
              rail is already held by the box's own edge. */}
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft !== name) setName(nameDraft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="Null"
            spellCheck={false}
            className="h-8 w-56 rounded-md border border-border bg-input px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </Row>
        <Row label="Start page">
          <div className="w-56">
            <Dropdown
              value={startPageKey}
              options={[
                { value: "null", label: "Null home" },
                { value: "duckduckgo", label: "DuckDuckGo" },
                { value: "custom", label: "Custom URL" },
              ]}
              onChange={handleStartPageChange}
            />
            {startPageKey === "custom" && (
              <CustomStartPageInput value={customUrl} onChange={setStartPage} />
            )}
          </div>
        </Row>
        <Row label="Search">
          <div className="w-56">
            <Dropdown
              value={searchEngine}
              options={SEARCH_ENGINES.map((e) => ({
                value: e.id,
                label: e.label,
                hint: e.note,
              }))}
              onChange={(v) => setSearchEngine(v as typeof searchEngine)}
            />
          </div>
        </Row>
      </div>
    </section>
  );
}
