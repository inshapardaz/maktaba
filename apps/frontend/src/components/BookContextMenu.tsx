import { createPortal } from "react-dom";
import { Menu } from "@mantine/core";
import { IconArrowsExchange, IconBook2, IconCopy, IconEdit, IconInfoCircle, IconTrash } from "../icons";
import { useLanguage } from "../i18n/LanguageContext";

export interface BookContextMenuPosition {
  x: number;
  y: number;
}

interface BookContextMenuProps {
  position: BookContextMenuPosition;
  canRead: boolean;
  onClose: () => void;
  onRead: () => void;
  onProperties: () => void;
  onEdit: () => void;
  onCopyToLibrary: () => void;
  onMoveToLibrary: () => void;
  onDelete: () => void;
}

// Right-click menu shared by BookGrid's BookCard, BookList's BookRow, and HomeView's Currently
// Reading rows - a fixed 1x1 target positioned at the click coordinates (Mantine's Menu has no
// built-in "open at cursor" mode) opened programmatically via `opened`, closed the same way a
// click-away/Escape closes any other Menu.
//
// The whole thing is rendered through a portal straight into document.body rather than in place:
// BookGrid's virtualized rows are positioned with a CSS `transform`, which makes that row the
// containing block for any `position: fixed` descendant (per the CSS spec) instead of the
// viewport - without the portal, the target div's left/top ended up offset from the row's own
// transformed position rather than the actual click point, so the dropdown opened far from the
// mouse. Portalling to document.body sidesteps that ancestor entirely.
export function BookContextMenu({
  position, canRead, onClose, onRead, onProperties, onEdit, onCopyToLibrary, onMoveToLibrary, onDelete,
}: BookContextMenuProps) {
  const { t } = useLanguage();

  return createPortal(
    <Menu opened onClose={onClose} withinPortal shadow="md" position="bottom-start" offset={0}>
      <Menu.Target>
        <div style={{ position: "fixed", left: position.x, top: position.y, width: 1, height: 1 }} />
      </Menu.Target>
      <Menu.Dropdown>
        {canRead && (
          <Menu.Item leftSection={<IconBook2 size={14} />} onClick={onRead}>
            {t("bookGrid.read")}
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
          {t("bookDetail.edit")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconCopy size={14} />} onClick={onCopyToLibrary}>
          {t("bookContextMenu.copyToLibrary")}
        </Menu.Item>
        <Menu.Item leftSection={<IconArrowsExchange size={14} />} onClick={onMoveToLibrary}>
          {t("bookContextMenu.moveToLibrary")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onDelete}>
          {t("bookList.delete")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconInfoCircle size={14} />} onClick={onProperties}>
          {t("bookContextMenu.properties")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>,
    document.body,
  );
}
