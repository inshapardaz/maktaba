import { useQuery } from "@tanstack/react-query";
import { listAuthors, listSeries, listTags, type BrowseGroup } from "../api";

export type GroupFilterKind = "authorId" | "seriesId" | "tagId";

export interface GroupFilter {
  kind: GroupFilterKind;
  id: string;
  name: string;
}

interface SidebarProps {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
}

function GroupSection({
  title,
  kind,
  activeFilter,
  onSelect,
  groups,
}: {
  title: string;
  kind: GroupFilterKind;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  groups: BrowseGroup[] | undefined;
}) {
  if (!groups || groups.length === 0) {
    return null;
  }

  return (
    <div className="sidebar-section">
      <h3>{title}</h3>
      <ul>
        {groups.map((group) => {
          const isActive = activeFilter?.kind === kind && activeFilter.id === group.id;
          return (
            <li key={group.id}>
              <button
                type="button"
                className={isActive ? "active" : ""}
                onClick={() => onSelect(isActive ? null : { kind, id: group.id, name: group.name })}
              >
                <span>{group.name}</span>
                <span className="count">{group.bookCount}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar({ activeFilter, onSelect }: SidebarProps) {
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });

  return (
    <nav className="sidebar">
      <GroupSection
        title="Authors"
        kind="authorId"
        activeFilter={activeFilter}
        onSelect={onSelect}
        groups={authorsQuery.data}
      />
      <GroupSection
        title="Series"
        kind="seriesId"
        activeFilter={activeFilter}
        onSelect={onSelect}
        groups={seriesQuery.data}
      />
      <GroupSection
        title="Tags"
        kind="tagId"
        activeFilter={activeFilter}
        onSelect={onSelect}
        groups={tagsQuery.data}
      />
    </nav>
  );
}
