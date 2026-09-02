// Single entry point for every icon the app uses - the "Organic" design system (see theme.ts)
// draws icons from lucide-react rather than @tabler/icons-react, with a heavier default
// stroke-width (2.75, vs lucide's own default of 2) applied once here instead of at every call
// site. Every component imports its icons from here (keeping the original Tabler-style
// "IconWhatever" names, so call sites and JSX usage didn't need to change) rather than from
// "lucide-react" directly - that's the one thing enforcing the stroke-width consistently.
import {
  ArrowLeft,
  ArrowUpDown,
  Ban,
  Book,
  BookOpen,
  Bookmark,
  Calendar,
  Camera,
  ChartBar,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleQuestionMark,
  Coffee,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  FileUp,
  Folder,
  FolderOpen,
  Globe,
  House,
  Info,
  Languages,
  LayoutGrid,
  Library,
  List,
  ListFilter,
  Menu,
  Minus,
  Moon,
  Newspaper,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
  SquareStack,
  Store,
  Sun,
  Tag,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { createElement, forwardRef, type ComponentProps } from "react";

const DEFAULT_STROKE_WIDTH = 2.75;

function withStrokeWidth(Base: LucideIcon): LucideIcon {
  const Wrapped = forwardRef<SVGSVGElement, ComponentProps<LucideIcon>>((props, ref) =>
    createElement(Base, { strokeWidth: DEFAULT_STROKE_WIDTH, ...props, ref }),
  );
  Wrapped.displayName = Base.displayName ?? Base.name;
  return Wrapped as LucideIcon;
}

export const IconAlertCircle = withStrokeWidth(CircleAlert);
export const IconAlertTriangle = withStrokeWidth(TriangleAlert);
export const IconArrowLeft = withStrokeWidth(ArrowLeft);
export const IconArrowsSort = withStrokeWidth(ArrowUpDown);
export const IconBan = withStrokeWidth(Ban);
export const IconBook = withStrokeWidth(Book);
export const IconBook2 = withStrokeWidth(BookOpen);
export const IconBookmark = withStrokeWidth(Bookmark);
export const IconBooks = withStrokeWidth(Library);
export const IconBuildingStore = withStrokeWidth(Store);
export const IconCalendar = withStrokeWidth(Calendar);
export const IconCamera = withStrokeWidth(Camera);
export const IconChartBar = withStrokeWidth(ChartBar);
export const IconCheck = withStrokeWidth(Check);
export const IconChevronDown = withStrokeWidth(ChevronDown);
export const IconChevronUp = withStrokeWidth(ChevronUp);
export const IconCircleCheck = withStrokeWidth(CircleCheck);
export const IconCircleDashed = withStrokeWidth(CircleDashed);
export const IconCoffee = withStrokeWidth(Coffee);
export const IconCompass = withStrokeWidth(Compass);
export const IconCopy = withStrokeWidth(Copy);
export const IconEdit = withStrokeWidth(SquarePen);
export const IconExternalLink = withStrokeWidth(ExternalLink);
export const IconEye = withStrokeWidth(Eye);
export const IconFileUpload = withStrokeWidth(FileUp);
export const IconFilter = withStrokeWidth(ListFilter);
export const IconFolder = withStrokeWidth(Folder);
export const IconFolderOpen = withStrokeWidth(FolderOpen);
export const IconHelpCircle = withStrokeWidth(CircleQuestionMark);
export const IconHome2 = withStrokeWidth(House);
export const IconInfoCircle = withStrokeWidth(Info);
export const IconLanguage = withStrokeWidth(Languages);
export const IconLayoutBottombarExpand = withStrokeWidth(PanelBottomOpen);
export const IconLayoutGrid = withStrokeWidth(LayoutGrid);
export const IconLayoutSidebarLeftCollapse = withStrokeWidth(PanelLeftClose);
export const IconLayoutSidebarLeftExpand = withStrokeWidth(PanelLeftOpen);
export const IconList = withStrokeWidth(List);
export const IconMenu2 = withStrokeWidth(Menu);
export const IconMinus = withStrokeWidth(Minus);
export const IconMoon = withStrokeWidth(Moon);
export const IconNews = withStrokeWidth(Newspaper);
export const IconPalette = withStrokeWidth(Palette);
export const IconPencil = withStrokeWidth(PenLine);
export const IconPlayerPlay = withStrokeWidth(Play);
export const IconPlus = withStrokeWidth(Plus);
export const IconRefresh = withStrokeWidth(RefreshCw);
export const IconSearch = withStrokeWidth(Search);
export const IconSettings = withStrokeWidth(Settings);
export const IconStack2 = withStrokeWidth(SquareStack);
export const IconSun = withStrokeWidth(Sun);
export const IconTag = withStrokeWidth(Tag);
export const IconTrash = withStrokeWidth(Trash2);
export const IconUpload = withStrokeWidth(Upload);
export const IconUser = withStrokeWidth(User);
export const IconWorldSearch = withStrokeWidth(Globe);
export const IconX = withStrokeWidth(X);

export type { LucideIcon as Icon };
