import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, resolveMediaUrl, uploadFileWithProgress } from "./api.js";

/* ==========================================================================
   Theme Transition Suppressor (/better-ui animations.md recipe)
   ========================================================================== */

export function applyThemeWithoutSmear(nextTheme) {
  if (typeof document === "undefined") return;
  const resolved = nextTheme === "dark" ? "dark" : "light";
  const style = document.createElement("style");
  style.append(document.createTextNode("*,*::before,*::after{transition:none !important}"));
  document.head?.append(style);

  document.documentElement.dataset.theme = resolved;

  if (document.body) {
    void document.body.offsetHeight;
  }

  const schedule =
    typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (fn) => setTimeout(fn, 0);

  schedule(() => {
    schedule(() => {
      style.remove();
    });
  });
}

/* ==========================================================================
   Crisp 1.5px / 2px currentColor SVG Icon Primitives (Zero Emojis)
   ========================================================================== */

function SvgBase({
  size = 16,
  weight = "regular",
  strokeWidth,
  filled = false,
  className = "",
  style,
  children,
  ...rest
}) {
  const sw = strokeWidth ?? (weight === "semibold" || weight === "bold" ? 2 : 1.5);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `studio-icon ${className}` : "studio-icon"}
      style={style}
      {...rest}
    >
      {children}
    </svg>
  );
}

function UploadIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </SvgBase>
  );
}

function FolderIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.38a1.5 1.5 0 0 1 1.17.56l1.38 1.72a1 1 0 0 0 .78.37H19.5A1.5 1.5 0 0 1 21 9.15v8.35A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z" />
    </SvgBase>
  );
}

function LinkIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M10 13a4.5 4.5 0 0 0 6.36 0l2.83-2.83a4.5 4.5 0 0 0-6.36-6.36L11.2 5.44" />
      <path d="M14 11a4.5 4.5 0 0 0-6.36 0l-2.83 2.83a4.5 4.5 0 1 0 6.36 6.36l1.63-1.63" />
    </SvgBase>
  );
}

function CheckIcon(props) {
  return (
    <SvgBase weight="semibold" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </SvgBase>
  );
}

function SparklesIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
      <path d="M19 15v4" />
      <path d="M17 17h4" />
      <path d="M5 16v3" />
      <path d="M3.5 17.5h3" />
    </SvgBase>
  );
}

function WandIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="m15 4-1 2.5L11.5 7.5 14 8.5 15 11l1-2.5 2.5-1-2.5-1L15 4Z" />
      <path d="m4 20 9.5-9.5" />
      <path d="m11.5 8.5 4 4" />
      <path d="M19 14v3" />
      <path d="M17.5 15.5h3" />
    </SvgBase>
  );
}

function BrushIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="m18.37 3.63 2 2a1.8 1.8 0 0 1 0 2.55L11.5 17.05 8 13.55l8.87-8.87a1.8 1.8 0 0 1 1.5-.05Z" />
      <path d="M8 13.55c-2.2.35-3.8 1.9-4 4.45-.1 1.2-.8 2-2 2 2.4.6 5.4.4 7.1-1.3.9-.9 1.25-1.95 1.4-2.65" />
    </SvgBase>
  );
}

function BoxSelectIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M5 3h2" />
      <path d="M11 3h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 11v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M13 21h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M3 13v-2" />
      <path d="M3 7V5a2 2 0 0 1 2-2" />
    </SvgBase>
  );
}

function ArrowUpRightIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </SvgBase>
  );
}

function PinIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </SvgBase>
  );
}

function UndoIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </SvgBase>
  );
}

function TrashIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
      <path d="M6.5 7 7.3 19.2A1.8 1.8 0 0 0 9.1 21h5.8a1.8 1.8 0 0 0 1.8-1.8L17.5 7" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </SvgBase>
  );
}

function BookmarkIcon({ filled = false, ...props }) {
  return (
    <SvgBase filled={filled} {...props}>
      <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z" />
    </SvgBase>
  );
}

function StarIcon({ filled = false, ...props }) {
  return (
    <SvgBase filled={filled} {...props}>
      <polygon points="12 2.8 14.85 8.58 21.2 9.5 16.6 13.98 17.69 20.32 12 17.32 6.31 20.32 7.4 13.98 2.8 9.5 9.15 8.58 12 2.8" />
    </SvgBase>
  );
}

function SlidersIcon(props) {
  return (
    <SvgBase {...props}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="var(--bg-surface, #ffffff)" />
      <circle cx="15" cy="12" r="2" fill="var(--bg-surface, #ffffff)" />
      <circle cx="10" cy="18" r="2" fill="var(--bg-surface, #ffffff)" />
    </SvgBase>
  );
}

function PlayIcon({ filled = true, ...props }) {
  return (
    <SvgBase filled={filled} {...props}>
      <polygon points="7 5 19 12 7 19 7 5" />
    </SvgBase>
  );
}

function DownloadIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />
    </SvgBase>
  );
}

function ChevronLeftIcon(props) {
  return (
    <SvgBase {...props}>
      <polyline points="15 18 9 12 15 6" />
    </SvgBase>
  );
}

function ChevronRightIcon(props) {
  return (
    <SvgBase {...props}>
      <polyline points="9 18 15 12 9 6" />
    </SvgBase>
  );
}

function ChevronDownIcon(props) {
  return (
    <SvgBase {...props}>
      <polyline points="6 9 12 15 18 9" />
    </SvgBase>
  );
}

function ChevronUpIcon(props) {
  return (
    <SvgBase {...props}>
      <polyline points="18 15 12 9 6 15" />
    </SvgBase>
  );
}

function ArrowLeftIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </SvgBase>
  );
}

function ArrowRightIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </SvgBase>
  );
}

function LayersIcon(props) {
  return (
    <SvgBase {...props}>
      <polygon points="12 3 21 7.5 12 12 3 7.5 12 3" />
      <polyline points="3 12 12 16.5 21 12" />
      <polyline points="3 16.5 12 21 21 16.5" />
    </SvgBase>
  );
}

function CpuIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </SvgBase>
  );
}

function SunIcon(props) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2.5 12h2.2M19.3 12h2.2M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56" />
    </SvgBase>
  );
}

function MoonIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M20.2 14.6A8.2 8.2 0 0 1 9.4 3.8a8.2 8.2 0 1 0 10.8 10.8Z" />
    </SvgBase>
  );
}

function PlusIcon(props) {
  return (
    <SvgBase {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </SvgBase>
  );
}

function XIcon(props) {
  return (
    <SvgBase {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </SvgBase>
  );
}

function LockIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </SvgBase>
  );
}

function UnlockIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.6-1.7" />
    </SvgBase>
  );
}

function RefreshIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M20 11a8 8 0 0 0-14.5-4.5L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.5 4.5L21 15" />
      <path d="M21 20v-5h-5" />
    </SvgBase>
  );
}

function EyeIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </SvgBase>
  );
}

function FilmIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="7" y1="4" x2="7" y2="20" />
      <line x1="17" y1="4" x2="17" y2="20" />
      <line x1="3" y1="9" x2="7" y2="9" />
      <line x1="3" y1="15" x2="7" y2="15" />
      <line x1="17" y1="9" x2="21" y2="9" />
      <line x1="17" y1="15" x2="21" y2="15" />
    </SvgBase>
  );
}

function MusicIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </SvgBase>
  );
}

function PaletteIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M12 3a9 9 0 0 0 0 18h1.3a2.2 2.2 0 0 0 2.2-2.2c0-.58-.22-1.1-.6-1.5a2.1 2.1 0 0 1 1.5-3.6H18a3 3 0 0 0 3-3C21 6.6 16.97 3 12 3Z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" />
    </SvgBase>
  );
}

function ShieldIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M12 3 5 6v5.5c0 4.6 3 8.6 7 9.8 4-1.2 7-5.2 7-9.8V6l-7-3Z" />
    </SvgBase>
  );
}

function AlertCircleIcon(props) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <circle cx="12" cy="16" r="0.6" fill="currentColor" />
    </SvgBase>
  );
}

function EditIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </SvgBase>
  );
}

function ImageIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </SvgBase>
  );
}

function VolumeIcon(props) {
  return (
    <SvgBase {...props}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </SvgBase>
  );
}

function ExternalLinkIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </SvgBase>
  );
}

function MicIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </SvgBase>
  );
}

function ActivityIcon(props) {
  return (
    <SvgBase {...props}>
      <polyline points="22 12 18 12 15 20 9 4 6 12 2 12" />
    </SvgBase>
  );
}

function WorkflowIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="4" width="6" height="6" rx="1.5" />
      <rect x="3" y="14" width="6" height="6" rx="1.5" />
      <rect x="15" y="9" width="6" height="6" rx="1.5" />
      <path d="M9 7h3a2 2 0 0 1 2 2v1.5" />
      <path d="M9 17h3a2 2 0 0 0 2-2v-1.5" />
    </SvgBase>
  );
}

function TrendingUpIcon(props) {
  return (
    <SvgBase {...props}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </SvgBase>
  );
}

function FileTextIcon(props) {
  return (
    <SvgBase {...props}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <polyline points="14 3 14 9 20 9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </SvgBase>
  );
}

function UserIcon(props) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </SvgBase>
  );
}

function FallbackGeometricIcon(props) {
  return (
    <SvgBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="12" cy="12" r="3" />
    </SvgBase>
  );
}

const ICON_MAP = Object.freeze({
  Upload: UploadIcon,
  Folder: FolderIcon,
  Link: LinkIcon,
  Check: CheckIcon,
  Sparkles: SparklesIcon,
  Wand: WandIcon,
  Brush: BrushIcon,
  BoxSelect: BoxSelectIcon,
  ArrowUpRight: ArrowUpRightIcon,
  Pin: PinIcon,
  Undo: UndoIcon,
  Trash: TrashIcon,
  Bookmark: BookmarkIcon,
  Star: StarIcon,
  Sliders: SlidersIcon,
  Play: PlayIcon,
  Download: DownloadIcon,
  ChevronLeft: ChevronLeftIcon,
  ChevronRight: ChevronRightIcon,
  ChevronDown: ChevronDownIcon,
  ChevronUp: ChevronUpIcon,
  ArrowLeft: ArrowLeftIcon,
  ArrowRight: ArrowRightIcon,
  Layers: LayersIcon,
  Cpu: CpuIcon,
  Sun: SunIcon,
  Moon: MoonIcon,
  Plus: PlusIcon,
  X: XIcon,
  Close: XIcon,
  Lock: LockIcon,
  Unlock: UnlockIcon,
  Refresh: RefreshIcon,
  RotateCw: RefreshIcon,
  Eye: EyeIcon,
  Film: FilmIcon,
  Video: FilmIcon,
  Image: ImageIcon,
  Music: MusicIcon,
  Volume: VolumeIcon,
  Mic: MicIcon,
  Waveform: ActivityIcon,
  Activity: ActivityIcon,
  Workflow: WorkflowIcon,
  GitBranch: WorkflowIcon,
  TrendingUp: TrendingUpIcon,
  BarChart: TrendingUpIcon,
  FileText: FileTextIcon,
  StickyNote: FileTextIcon,
  User: UserIcon,
  Palette: PaletteIcon,
  Shield: ShieldIcon,
  AlertCircle: AlertCircleIcon,
  Info: AlertCircleIcon,
  ExternalLink: ExternalLinkIcon,
  Edit: EditIcon,
});

export const Icons = new Proxy(ICON_MAP, {
  get(target, prop, receiver) {
    if (prop in target) {
      return Reflect.get(target, prop, receiver);
    }
    if (typeof prop === "string" && prop !== "$$typeof" && prop !== "then") {
      return FallbackGeometricIcon;
    }
    return undefined;
  },
});

/* ==========================================================================
   Defaults & Normalization Helpers
   ========================================================================== */

const DEFAULT_MOTION_PRESETS = [
  { id: "crash-zoom-in", name: "Crash Zoom In", ease: "expo.out" },
  { id: "dolly-out-reveal", name: "Dolly Out Reveal", ease: "power4.out" },
  { id: "isometric-3d-tilt", name: "Isometric 3D Tilt", ease: "power3.inOut" },
  { id: "whip-pan-split", name: "Whip Pan Split", ease: "expo.inOut" },
  { id: "spotlight-cursor-follow", name: "Spotlight Cursor Follow", ease: "power4.inOut" },
  { id: "bento-triptych", name: "Bento Triptych", ease: "power3.out" },
  { id: "editorial-kinetic-card", name: "Editorial Kinetic Card", ease: "expo.out" },
  { id: "parallax-float", name: "Parallax Float", ease: "sine.inOut" },
];

const ARCHETYPE_METADATA = {
  "device-3d-showcase": { name: "3D device frame", spec: "Screen with callout" },
  "split-editorial": { name: "Side-by-side split", spec: "Text beside footage" },
  "fullbleed-cinema": { name: "Full-screen video", spec: "Edge-to-edge clip" },
  "bento-feature-grid": { name: "Bento grid", spec: "Multi-card feature view" },
  "spotlight-cursor-zoom": { name: "Cursor zoom", spec: "Focused UI action" },
  "kinetic-statement-card": { name: "Statement card", spec: "Centered headline & CTA" },
  "before-after-wipe": { name: "Before & after wipe", spec: "Comparison reveal" },
  "metric-counter-wall": { name: "Metric counter wall", spec: "Animated key stats" },
};

const DEFAULT_LAYOUT_ARCHETYPES = Object.entries(ARCHETYPE_METADATA).map(([id, meta]) => ({
  id,
  name: meta.name,
  label: meta.name,
  spec: meta.spec,
}));

const DEFAULT_CATALOG = {
  cameraBodies: [],
  lenses: [],
  apertures: [],
  cameraPresets: DEFAULT_MOTION_PRESETS,
  colorLooks: [
    { id: "clean-commercial", name: "Clean Commercial" },
    { id: "kodak-2383-warm", name: "Kodak 2383 Warm" },
    { id: "emerald-vibrant", name: "Emerald Vibrant" },
    { id: "teal-orange-cinema", name: "Teal & Orange Cinema" },
    { id: "apple-keynote-crisp", name: "Apple Keynote Crisp" },
    { id: "matte-editorial", name: "Matte Editorial" },
  ],
  captionStyles: [
    { id: "kinetic-gold-pop", name: "Kinetic Gold Pop" },
    { id: "minimal-editorial-rail", name: "Minimal Editorial Rail" },
    { id: "clean-cinema-sub", name: "Clean Cinema Sub" },
  ],
  sfxCatalog: [],
  archetypes: DEFAULT_LAYOUT_ARCHETYPES,
};

const DEFAULT_AGENTS = [
  {
    id: "brand-analyst",
    name: "Brand Analyst",
    role: "Palette, typography & reference pacing intelligence",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "storyboard-director",
    name: "Storyboard Director",
    role: "Shot staging, camera vectors & speed ramps",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "frame-designer",
    name: "Frame Designer",
    role: "1080p clean & animation blueprint design plates",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "google-flow-video",
    name: "Google Flow Video",
    role: "Generative motion B-roll via Google Flow",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "audio-director",
    name: "Audio Director",
    role: "Neural voiceover, Whisper alignment, SFX & BGM",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "hyperframes-qa",
    name: "HyperFrames QA",
    role: "Scene builder & zero-error browser check gate",
    status: "idle",
    message: "Standing by",
  },
];

const DEFAULT_PROVIDER_SETTINGS = {
  providerMode: "antigravity-subscription",
  model: "gemini-4-carbon-high",
  zeroCostGuard: true,
  imageBackend: "antigravity-image-generator",
  videoBackend: "google-flow-browser",
  audioBackend: "edge-tts-neural",
  allowFreeTierApiKey: false,
};

function buildDualAgentCrew(rawCrew) {
  const sourceList = Array.isArray(rawCrew)
    ? rawCrew
    : Array.isArray(rawCrew?.agents)
      ? rawCrew.agents
      : DEFAULT_AGENTS;

  const list = sourceList.map((item) => ({ ...item }));
  const byId = {};
  for (const agent of list) {
    if (agent?.id) byId[agent.id] = agent;
  }
  const updatedAt = rawCrew?.updatedAt || null;

  Object.defineProperties(list, {
    agents: { value: list, enumerable: false },
    byId: { value: byId, enumerable: false },
    updatedAt: { value: updatedAt, enumerable: false },
  });

  return list;
}

function normalizeArchetypeList(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return DEFAULT_LAYOUT_ARCHETYPES;
  }
  return rawList.map((entry) => {
    if (typeof entry === "string") {
      const meta = ARCHETYPE_METADATA[entry] || {
        name: entry.replaceAll("-", " "),
        spec: "",
      };
      return {
        id: entry,
        name: meta.name,
        label: meta.name,
        spec: meta.spec,
      };
    }
    const id = String(entry?.id || entry?.name || "");
    const meta = ARCHETYPE_METADATA[id];
    const label = entry?.label || entry?.name || meta?.name || id;
    return {
      ...entry,
      id,
      name: entry?.name || label,
      label,
      spec: entry?.spec || entry?.description || meta?.spec || "",
    };
  });
}

function decorateFrameItem(slug, frame, idx = 0) {
  if (!frame || typeof frame !== "object") return frame;
  const version = Number(frame.currentVersion || 1);
  const cacheBust = `v${version}_${frame.updatedAt || ""}`;

  const rawDesign =
    frame.designFrameUrl ||
    frame.currentDesignImage ||
    frame.designFramePath ||
    frame.cleanUrl ||
    "";
  const rawHud =
    frame.hudFrameUrl ||
    frame.currentBlueprintImage ||
    frame.hudFramePath ||
    frame.hudUrl ||
    rawDesign;

  const designUrl = resolveMediaUrl(slug, rawDesign, cacheBust);
  const hudUrl = resolveMediaUrl(slug, rawHud, cacheBust) || designUrl;

  const kfSrc = frame.keyframes || {};
  const keyframes = {
    start: resolveMediaUrl(slug, kfSrc.start) || null,
    peak: resolveMediaUrl(slug, kfSrc.peak) || null,
    end: resolveMediaUrl(slug, kfSrc.end) || null,
  };

  let rawKeyframes = keyframes;
  if (Array.isArray(frame.rawKeyframes)) {
    rawKeyframes = frame.rawKeyframes.map((item) => resolveMediaUrl(slug, item)).filter(Boolean);
  } else if (frame.rawKeyframes && typeof frame.rawKeyframes === "object") {
    rawKeyframes = {
      start: resolveMediaUrl(slug, frame.rawKeyframes.start) || keyframes.start,
      peak: resolveMediaUrl(slug, frame.rawKeyframes.peak) || keyframes.peak,
      end: resolveMediaUrl(slug, frame.rawKeyframes.end) || keyframes.end,
    };
  }

  const history = Array.isArray(frame.history)
    ? frame.history.map((snap) => {
        const snapVer = Number(snap?.version || 1);
        const snapToken = `v${snapVer}`;
        const snapDesign = resolveMediaUrl(
          slug,
          snap?.designFrameUrl || snap?.currentDesignImage || snap?.image || snap?.designFramePath,
          snapToken,
        );
        const snapHud =
          resolveMediaUrl(
            slug,
            snap?.hudFrameUrl || snap?.currentBlueprintImage || snap?.hudFramePath,
            snapToken,
          ) || snapDesign;
        return {
          ...snap,
          designFrameUrl: snapDesign,
          hudFrameUrl: snapHud,
          currentDesignImage: snapDesign,
          currentBlueprintImage: snapHud,
          image: snapDesign,
        };
      })
    : [];

  return {
    ...frame,
    id: frame.id || `frame_${String(idx + 1).padStart(2, "0")}`,
    index: Number(frame.index ?? idx + 1),
    currentVersion: version,
    locked: Boolean(frame.locked),
    approved: Boolean(frame.approved || frame.locked),
    designFrameUrl: designUrl,
    hudFrameUrl: hudUrl,
    currentDesignImage: designUrl,
    currentBlueprintImage: hudUrl,
    cleanUrl: designUrl,
    hudUrl,
    keyframes,
    rawKeyframes,
    history,
  };
}

function decorateStoryboardData(slug, sb) {
  if (!sb || typeof sb !== "object") return null;
  const frames = Array.isArray(sb.frames)
    ? sb.frames.map((f, idx) => decorateFrameItem(slug, f, idx))
    : [];
  return { ...sb, frames };
}

function decorateSavedFramesList(slug, items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const id = String(item.savedId || item.id || "");
    const rawImg =
      item.imageUrl ||
      item.pngUrl ||
      item.designFrameUrl ||
      item.url ||
      item.savedRelPath ||
      item.relPath ||
      item.designFramePath ||
      "";
    const resolved = resolveMediaUrl(slug, rawImg);
    return {
      ...item,
      id,
      savedId: id,
      imageUrl: resolved,
      pngUrl: resolved,
      designFrameUrl: resolved,
      url: resolved,
    };
  });
}

function normalizeSkillItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((skill) => {
    const id = String(skill?.id || skill?.slug || skill?.name || "");
    return {
      ...skill,
      id,
      name: skill?.name || id,
      description: skill?.description || "",
      category: skill?.category || "general",
      sourceScope: skill?.sourceScope || "workspace-agents",
      installed: skill?.installed !== false,
      ruleHighlights: Array.isArray(skill?.ruleHighlights) ? skill.ruleHighlights : [],
    };
  });
}

function normalizeRatingData(raw) {
  if (!raw || typeof raw !== "object") return null;
  const subSource = raw.categories || raw.subScores || raw.breakdown || {};
  const keys = [
    "hookAndPacing",
    "visualHierarchyAndContrast",
    "motionContinuity",
    "skillAlignment",
    "brandConsistency",
    "audioAndCaptions",
  ];
  const categories = { ...subSource };
  for (const key of keys) {
    if (categories[key] === undefined && raw[key] !== undefined) {
      categories[key] = raw[key];
    }
  }
  return {
    ...raw,
    overallScore: Number(raw.overallScore ?? raw.score ?? 0),
    grade: String(raw.grade || "B"),
    verdict: String(raw.verdict || ""),
    categories,
    subScores: categories,
    frameRatings: Array.isArray(raw.frameRatings) ? raw.frameRatings : [],
  };
}

function parseStepFromHash() {
  if (typeof window === "undefined") return 1;
  const match = String(window.location.hash || "").match(/^#step-([1-5])$/);
  return match ? Number(match[1]) : 1;
}

function readInitialTheme() {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage?.getItem("studio-hub-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Ignore storage restriction
  }
  return "light";
}

/* ==========================================================================
   Studio Context & Provider
   ========================================================================== */

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const [step, setStepState] = useState(parseStepFromHash);
  const [theme, setThemeState] = useState(readInitialTheme);

  const [status, setStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeSlug, setActiveSlug] = useState(null);
  const [project, setProject] = useState(null);
  const [rawAnalysis, setRawAnalysis] = useState(null);
  const [aiReadyPrompt, setAiReadyPrompt] = useState("");
  const [folderScan, setFolderScan] = useState(null);

  const [storyboard, setStoryboard] = useState(null);
  const [motionPresets, setMotionPresets] = useState(DEFAULT_MOTION_PRESETS);
  const [layoutArchetypes, setLayoutArchetypes] = useState(DEFAULT_LAYOUT_ARCHETYPES);
  const [catalog, setCatalog] = useState(DEFAULT_CATALOG);

  const [skills, setSkills] = useState([]);
  const [selectedSkills, setSelectedSkillsState] = useState([]);
  const [skillDirectives, setSkillDirectives] = useState(null);
  const [videoRating, setVideoRating] = useState(null);
  const [savedFrames, setSavedFrames] = useState([]);

  // Wave 4 V3 state (Voice/Lip-Sync, Whiteboard Scene Builder, Ad Creative Analytics, PM Insights)
  const [voices, setVoices] = useState([]);
  const [whiteboard, setWhiteboard] = useState(null);
  const [adAnalytics, setAdAnalytics] = useState(null);
  const [pmInsights, setPmInsights] = useState(null);

  const [jobs, setJobs] = useState([]);
  const [compileProgress, setCompileProgress] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [agentCrew, setAgentCrew] = useState(() => buildDualAgentCrew(DEFAULT_AGENTS));
  const [providerSettings, setProviderSettings] = useState(DEFAULT_PROVIDER_SETTINGS);
  const [sseConnected, setSseConnected] = useState(false);

  const [busyMap, setBusyMap] = useState({});
  const [uploadProgress, setUploadProgress] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Shared UI drawers / modals convenience flags
  const [savedFramesDrawerOpen, setSavedFramesDrawerOpen] = useState(false);
  const [agentsDrawerOpen, setAgentsDrawerOpen] = useState(false);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [editingFrameId, setEditingFrameId] = useState(null);

  const activeSlugRef = useRef(activeSlug);
  activeSlugRef.current = activeSlug;

  const pollTimersRef = useRef(new Map());
  const toastTimersRef = useRef(new Map());

  /* ---------- Step Hash & History Navigation ---------- */
  const setStep = useCallback((nextOrUpdater) => {
    setStepState((prev) => {
      const rawNext = typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : nextOrUpdater;
      const clamped = Math.min(5, Math.max(1, Number(rawNext) || 1));
      if (typeof window !== "undefined") {
        const targetHash = `#step-${clamped}`;
        if (window.location.hash !== targetHash) {
          window.history.pushState({ step: clamped }, "", targetHash);
        }
        window.scrollTo?.({ top: 0, behavior: "instant" });
      }
      return clamped;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const initial = parseStepFromHash();
    const expectedHash = `#step-${initial}`;
    if (!window.location.hash) {
      window.history.replaceState({ step: initial }, "", expectedHash);
    }

    const syncFromHistory = () => {
      const parsed = parseStepFromHash();
      setStepState(parsed);
    };

    window.addEventListener("popstate", syncFromHistory);
    window.addEventListener("hashchange", syncFromHistory);
    return () => {
      window.removeEventListener("popstate", syncFromHistory);
      window.removeEventListener("hashchange", syncFromHistory);
    };
  }, []);

  /* ---------- White Mode Default & Smear-Free Theme Toggle ---------- */
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  const setTheme = useCallback((nextTheme) => {
    const resolved = nextTheme === "dark" ? "dark" : "light";
    applyThemeWithoutSmear(resolved);
    setThemeState(resolved);
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem("studio-hub-theme", resolved);
      } catch {
        // Ignore storage errors
      }
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyThemeWithoutSmear(next);
      if (typeof window !== "undefined") {
        try {
          window.localStorage?.setItem("studio-hub-theme", next);
        } catch {
          // Ignore storage errors
        }
      }
      return next;
    });
  }, []);

  /* ---------- Busy & Toast Helpers ---------- */
  const setBusy = useCallback((key, value) => {
    setBusyMap((prev) => {
      if (Boolean(prev[key]) === Boolean(value)) return prev;
      const next = { ...prev };
      if (value) {
        next[key] = true;
      } else {
        delete next[key];
      }
      return next;
    });
  }, []);

  const isBusy = useCallback((key) => Boolean(busyMap[key]), [busyMap]);

  const dismissToast = useCallback((id) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((msg, type = "info") => {
    if (!msg) return;
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const normalizedType =
      type === true || type === "error" ? "error" : type === "success" ? "success" : "info";
    const entry = { id, message: String(msg), type: normalizedType };
    setToasts((prev) => [...prev.slice(-3), entry]);

    const timer = setTimeout(() => {
      toastTimersRef.current.delete(id);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3800);
    toastTimersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const pollTimers = pollTimersRef.current;
    const toastTimers = toastTimersRef.current;
    return () => {
      for (const timer of pollTimers.values()) clearInterval(timer);
      pollTimers.clear();
      for (const timer of toastTimers.values()) clearTimeout(timer);
      toastTimers.clear();
    };
  }, []);

  /* ---------- Focused Project & V2 Resource Loaders ---------- */
  const loadSkillsForSlug = useCallback(async (slug) => {
    const query = slug ? `?slug=${encodeURIComponent(slug)}` : "";
    try {
      const res = await api(`/api/skills${query}`);
      if (Array.isArray(res.skills)) {
        setSkills(normalizeSkillItems(res.skills));
      }
      if (Array.isArray(res.selectedSkills)) {
        setSelectedSkillsState(res.selectedSkills);
      }
      if (res.directives) {
        setSkillDirectives(res.directives);
      }
      return res;
    } catch {
      return null;
    }
  }, []);

  const loadSavedFramesForSlug = useCallback(async (slug) => {
    if (!slug) return [];
    try {
      const res = await api(`/api/projects/${encodeURIComponent(slug)}/saved-frames`);
      const decorated = decorateSavedFramesList(slug, res.savedFrames || []);
      setSavedFrames(decorated);
      return decorated;
    } catch {
      return [];
    }
  }, []);

  const loadRatingForSlug = useCallback(async (slug) => {
    if (!slug) return null;
    try {
      const res = await api(`/api/projects/${encodeURIComponent(slug)}/rating`);
      const normalized = normalizeRatingData(res.rating || res);
      setVideoRating(normalized);
      return normalized;
    } catch {
      return null;
    }
  }, []);

  const loadProjectBundle = useCallback(
    async (slug) => {
      if (!slug) return null;
      const res = await api(`/api/projects/${encodeURIComponent(slug)}`);
      if (res.project) {
        setProject(res.project);
        if (Array.isArray(res.project.selectedSkills)) {
          setSelectedSkillsState(res.project.selectedSkills);
        }
      }
      setRawAnalysis(res.rawAnalysis || res.project?.rawAnalysis || null);
      setAiReadyPrompt(res.aiReadyPrompt || "");

      const decoratedSb = decorateStoryboardData(slug, res.storyboard);
      setStoryboard(decoratedSb);

      if (Array.isArray(res.motionPresets) && res.motionPresets.length > 0) {
        setMotionPresets(res.motionPresets);
      }
      if (Array.isArray(res.layoutArchetypes) && res.layoutArchetypes.length > 0) {
        setLayoutArchetypes(normalizeArchetypeList(res.layoutArchetypes));
      }
      if (Array.isArray(res.jobs)) {
        setJobs(res.jobs);
      }
      if (Array.isArray(res.tickets)) {
        setTickets(res.tickets);
      }
      if (res.agentCrew || res.crew) {
        setAgentCrew(buildDualAgentCrew(res.agentCrew || res.crew));
      }

      await Promise.allSettled([
        loadSkillsForSlug(slug),
        loadSavedFramesForSlug(slug),
        decoratedSb?.frames?.length > 0 ? loadRatingForSlug(slug) : Promise.resolve(null),
      ]);

      return res;
    },
    [loadRatingForSlug, loadSavedFramesForSlug, loadSkillsForSlug],
  );

  const refreshAll = useCallback(
    async (preferredSlug = null) => {
      setBusy("refreshAll", true);
      try {
        const [statusRes, projectsRes, catalogRes] = await Promise.allSettled([
          api("/api/status"),
          api("/api/projects"),
          api("/api/catalog/presets"),
        ]);

        let detectedSlug = preferredSlug || activeSlugRef.current || null;

        if (statusRes.status === "fulfilled" && statusRes.value) {
          const st = statusRes.value;
          setStatus(st);
          if (st.providerSettings) {
            setProviderSettings((prev) => ({ ...prev, ...st.providerSettings }));
          }
          if (st.agentCrew || st.crew) {
            setAgentCrew(buildDualAgentCrew(st.agentCrew || st.crew));
          }
          if (!detectedSlug && st.activeProject) {
            detectedSlug = st.activeProject;
          }
        }

        if (projectsRes.status === "fulfilled" && projectsRes.value) {
          const list = Array.isArray(projectsRes.value.projects) ? projectsRes.value.projects : [];
          setProjects(list);
          if (!detectedSlug) {
            detectedSlug = projectsRes.value.activeProject || list[0]?.slug || null;
          }
        }

        if (catalogRes.status === "fulfilled" && catalogRes.value) {
          const cat = catalogRes.value;
          setCatalog((prev) => ({
            ...prev,
            ...cat,
            archetypes: normalizeArchetypeList(cat.archetypes || prev.archetypes),
          }));
        }

        if (detectedSlug) {
          setActiveSlug(detectedSlug);
          activeSlugRef.current = detectedSlug;
          await loadProjectBundle(detectedSlug);
        } else {
          await loadSkillsForSlug(null);
        }
      } finally {
        setBusy("refreshAll", false);
      }
    },
    [loadProjectBundle, loadSkillsForSlug, setBusy],
  );

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  /* ---------- Job Polling Helper ---------- */
  const trackJobUntilSettled = useCallback(
    (jobId, slugForJob) => {
      if (!jobId || pollTimersRef.current.has(jobId)) return;
      const interval = setInterval(async () => {
        try {
          const res = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
          const job = res.job;
          if (!job) return;

          setJobs((prev) => {
            const exists = prev.some((j) => j.id === job.id);
            return exists ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev];
          });

          if (job.action === "generate-video") {
            setCompileProgress((prev) => ({
              ...(prev || {}),
              jobId: job.id,
              stage: job.stage || prev?.stage || "render",
              progress: typeof job.progress === "number" ? job.progress : prev?.progress || 0,
              status: job.status,
              output: job.output || "",
              outputRelPath: job.result?.outputRelPath || prev?.outputRelPath || null,
              error: job.error || null,
            }));
          }

          if (job.status === "done" || job.status === "failed") {
            clearInterval(interval);
            pollTimersRef.current.delete(jobId);
            if (slugForJob && slugForJob === activeSlugRef.current) {
              await loadProjectBundle(slugForJob);
            }
            if (job.status === "done") {
              notify(`${job.label || "Task"} finished.`, "success");
            } else if (job.error) {
              notify(job.error, "error");
            }
          }
        } catch {
          clearInterval(interval);
          pollTimersRef.current.delete(jobId);
        }
      }, 1200);
      pollTimersRef.current.set(jobId, interval);
    },
    [loadProjectBundle, notify],
  );

  /* ---------- Real-Time SSE Subscription (/api/events) ---------- */
  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;

    let es = null;
    try {
      es = new EventSource("/api/events");
    } catch {
      return undefined;
    }

    const parsePayload = (ev) => {
      try {
        return JSON.parse(ev.data || "{}");
      } catch {
        return {};
      }
    };

    es.addEventListener("open", () => setSseConnected(true));
    es.addEventListener("error", () => setSseConnected(false));

    es.addEventListener("connected", (ev) => {
      setSseConnected(true);
      const data = parsePayload(ev);
      if (data.crew || data.agentCrew) {
        setAgentCrew(buildDualAgentCrew(data.crew || data.agentCrew));
      }
      if (data.providerSettings) {
        setProviderSettings((prev) => ({ ...prev, ...data.providerSettings }));
      }
    });

    const handleAgentStatus = (ev) => {
      const data = parsePayload(ev);
      if (data.crew || data.agentCrew) {
        setAgentCrew(buildDualAgentCrew(data.crew || data.agentCrew));
      } else if (data.agent?.id) {
        setAgentCrew((prev) => {
          const next = prev.map((a) => (a.id === data.agent.id ? { ...a, ...data.agent } : a));
          return buildDualAgentCrew(next);
        });
      }
    };
    es.addEventListener("agent-status", handleAgentStatus);
    es.addEventListener("agent_status", handleAgentStatus);

    const handleProviderSettings = (ev) => {
      const data = parsePayload(ev);
      const settings = data.providerSettings || data.settings || data.payload;
      if (settings && typeof settings === "object") {
        setProviderSettings((prev) => ({ ...prev, ...settings }));
      }
    };
    es.addEventListener("provider-settings", handleProviderSettings);
    es.addEventListener("provider_settings", handleProviderSettings);

    const handleTicketEvent = (ev) => {
      const data = parsePayload(ev);
      if (!data.slug || data.slug === activeSlugRef.current) {
        if (Array.isArray(data.tickets)) {
          setTickets(data.tickets);
        } else if (data.ticket?.id) {
          setTickets((prev) => {
            const exists = prev.some((t) => t.id === data.ticket.id);
            return exists
              ? prev.map((t) => (t.id === data.ticket.id ? data.ticket : t))
              : [data.ticket, ...prev];
          });
        }
      }
      if (data.crew || data.agentCrew) {
        setAgentCrew(buildDualAgentCrew(data.crew || data.agentCrew));
      }
    };
    es.addEventListener("ticket_updated", handleTicketEvent);
    es.addEventListener("ticket-updated", handleTicketEvent);
    es.addEventListener("ticket-created", handleTicketEvent);
    es.addEventListener("ticket-completed", handleTicketEvent);

    const handleStoryboardUpdated = (ev) => {
      const data = parsePayload(ev);
      const slug = data.slug || activeSlugRef.current;
      if (slug && slug === activeSlugRef.current && data.storyboard) {
        setStoryboard(decorateStoryboardData(slug, data.storyboard));
      }
    };
    es.addEventListener("storyboard_updated", handleStoryboardUpdated);
    es.addEventListener("storyboard-updated", handleStoryboardUpdated);

    const handleCompileProgress = (ev) => {
      const data = parsePayload(ev);
      if (data.slug && data.slug !== activeSlugRef.current) return;
      setCompileProgress((prev) => ({
        ...(prev || {}),
        ...data,
      }));
      if (data.done || data.status === "done") {
        const slug = activeSlugRef.current;
        if (slug) {
          loadProjectBundle(slug);
        }
      }
    };
    es.addEventListener("compile_progress", handleCompileProgress);
    es.addEventListener("compile-progress", handleCompileProgress);

    const handleJobUpdated = (ev) => {
      const data = parsePayload(ev);
      if (data.slug && data.slug !== activeSlugRef.current) return;
      const job = data.job;
      if (!job?.id) return;
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === job.id);
        return exists ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev];
      });
      if (job.status === "done" && activeSlugRef.current) {
        loadProjectBundle(activeSlugRef.current);
      }
    };
    es.addEventListener("job_updated", handleJobUpdated);
    es.addEventListener("job-progress", handleJobUpdated);

    const handleProjectRefreshEvent = (ev) => {
      const data = parsePayload(ev);
      if ((!data.slug || data.slug === activeSlugRef.current) && activeSlugRef.current) {
        loadProjectBundle(activeSlugRef.current);
      }
    };
    es.addEventListener("drop_ingested", handleProjectRefreshEvent);
    es.addEventListener("raw_analyzed", handleProjectRefreshEvent);
    es.addEventListener("inspiration_analyzed", handleProjectRefreshEvent);
    es.addEventListener("brand_extracted", handleProjectRefreshEvent);

    return () => {
      es?.close();
    };
  }, [loadProjectBundle]);

  /* ==========================================================================
     Studio Actions
     ========================================================================== */

  const switchProject = useCallback(
    async (slug) => {
      if (!slug) return null;
      setBusy("switchProject", true);
      try {
        await api(`/api/projects/${encodeURIComponent(slug)}/activate`, { method: "POST" });
        setActiveSlug(slug);
        activeSlugRef.current = slug;
        setFolderScan(null);
        setVideoRating(null);
        setCompileProgress(null);
        const bundle = await loadProjectBundle(slug);
        return bundle?.project || null;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("switchProject", false);
      }
    },
    [loadProjectBundle, notify, setBusy],
  );

  const createNewProject = useCallback(
    async (nameOrPayload, extra = {}) => {
      const rawPayload =
        typeof nameOrPayload === "string"
          ? { title: nameOrPayload, name: nameOrPayload, ...extra }
          : { ...(nameOrPayload || {}) };
      const payload = {
        ...rawPayload,
        title: rawPayload.title || rawPayload.name || "Untitled project",
      };
      setBusy("createNewProject", true);
      try {
        const res = await api("/api/projects", {
          method: "POST",
          body: payload,
        });
        const newSlug = res.project?.slug || res.activeProject;
        if (newSlug) {
          setActiveSlug(newSlug);
          activeSlugRef.current = newSlug;
          setFolderScan(null);
          setVideoRating(null);
          setCompileProgress(null);
          await refreshAll(newSlug);
          setStep(1);
        }
        setNewProjectModalOpen(false);
        notify(
          `Created project "${res.project?.title || res.project?.name || newSlug}".`,
          "success",
        );
        return res.project;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("createNewProject", false);
      }
    },
    [notify, refreshAll, setBusy, setStep],
  );

  const importLooseFile = useCallback(
    async (filenameOrOpts, category = "raw-video", move = false) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body =
        typeof filenameOrOpts === "object" && filenameOrOpts !== null
          ? filenameOrOpts
          : { filename: filenameOrOpts, category, move };
      setBusy("importLooseFile", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/import-root-file`, {
          method: "POST",
          body,
        });
        if (res.project) setProject(res.project);
        if (Array.isArray(res.looseRootFiles)) {
          setStatus((prev) => (prev ? { ...prev, looseRootFiles: res.looseRootFiles } : prev));
        }
        notify(`Added ${body.filename} to project.`, "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("importLooseFile", false);
      }
    },
    [notify, setBusy],
  );

  const scanFolder = useCallback(
    async (folderPathOrOpts, opts = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const recursiveFlag = typeof opts === "boolean" ? opts : opts?.recursive !== false;
      const body =
        typeof folderPathOrOpts === "object" && folderPathOrOpts !== null
          ? folderPathOrOpts
          : { folderPath: folderPathOrOpts, recursive: recursiveFlag };
      setBusy("scanFolder", true);
      setBusy("scan-folder", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/scan-folder`, {
          method: "POST",
          body,
        });
        const scanData = res.scan || res;
        setFolderScan(scanData);
        return scanData;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("scanFolder", false);
        setBusy("scan-folder", false);
      }
    },
    [notify, setBusy],
  );

  const importScannedFolder = useCallback(
    async (folderOrPayload, selectedFilesArg = null, categoryArg = "raw-video") => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body =
        typeof folderOrPayload === "object" && folderOrPayload !== null
          ? folderOrPayload
          : {
              folderPath: folderOrPayload,
              selectedFiles: selectedFilesArg,
              category: categoryArg,
            };
      setBusy("importScannedFolder", true);
      setBusy("importFolder", true);
      setBusy("import-folder", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/import-folder`, {
          method: "POST",
          body,
        });
        if (res.project) setProject(res.project);
        else await loadProjectBundle(slug);
        notify("Imported selected media files.", "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("importScannedFolder", false);
        setBusy("importFolder", false);
        setBusy("import-folder", false);
      }
    },
    [loadProjectBundle, notify, setBusy],
  );

  const uploadFiles = useCallback(
    async (categoryOrPayload, filesArg, onProgressArg) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");

      let category = "raw-video";
      let rawFiles = [];
      let onProgress = onProgressArg;

      const isFirstFileCollection =
        Array.isArray(categoryOrPayload) ||
        (typeof FileList !== "undefined" && categoryOrPayload instanceof FileList);

      if (isFirstFileCollection) {
        rawFiles = Array.from(categoryOrPayload);
        if (typeof filesArg === "string") category = filesArg;
      } else if (typeof categoryOrPayload === "object" && categoryOrPayload !== null) {
        category = categoryOrPayload.category || "raw-video";
        rawFiles = Array.from(categoryOrPayload.files || []);
        onProgress = categoryOrPayload.onProgress || onProgressArg;
      } else {
        category = String(categoryOrPayload || "raw-video");
        rawFiles = Array.from(filesArg || []);
      }

      if (rawFiles.length === 0) return [];

      setBusy("uploadFiles", true);
      setBusy("upload", true);
      setBusy(`upload:${category}`, true);
      try {
        const uploaded = [];
        for (let i = 0; i < rawFiles.length; i += 1) {
          const file = rawFiles[i];
          const res = await uploadFileWithProgress(slug, category, file, (pct, detail) => {
            const overall = Math.round(((i + pct / 100) / rawFiles.length) * 100);
            setUploadProgress({
              category,
              filename: file.name,
              percent: overall,
              fileIndex: i + 1,
              totalFiles: rawFiles.length,
            });
            if (typeof onProgress === "function") {
              onProgress(overall, detail);
            }
          });
          uploaded.push(res);
          if (res.project) setProject(res.project);
        }
        await loadProjectBundle(slug);
        notify(
          rawFiles.length === 1
            ? `Uploaded ${rawFiles[0].name}.`
            : `Uploaded ${rawFiles.length} files.`,
          "success",
        );
        return uploaded;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setUploadProgress(null);
        setBusy("uploadFiles", false);
        setBusy("upload", false);
        setBusy(`upload:${category}`, false);
      }
    },
    [loadProjectBundle, notify, setBusy],
  );

  const ingestUrl = useCallback(
    async (urlOrPayload, categoryArg = "raw-video", extra = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body =
        typeof urlOrPayload === "object" && urlOrPayload !== null
          ? urlOrPayload
          : { url: urlOrPayload, category: categoryArg, ...extra };
      setBusy("ingestUrl", true);
      setBusy("ingest-url", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/ingest-url`, {
          method: "POST",
          body,
        });
        if (res.project) setProject(res.project);
        else await loadProjectBundle(slug);
        notify("Added link to project.", "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("ingestUrl", false);
        setBusy("ingest-url", false);
      }
    },
    [loadProjectBundle, notify, setBusy],
  );

  const analyzeRaw = useCallback(
    async (opts = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body = typeof opts === "string" ? { relPath: opts } : { ...(opts || {}) };
      setBusy("analyzeRaw", true);
      setBusy("analyze-raw", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/analyze-raw`, {
          method: "POST",
          body,
        });
        const analysis = res.analysis || res.rawAnalysis || null;
        setRawAnalysis(analysis);
        if (res.project) setProject(res.project);
        notify(`Detected ${analysis?.scenes?.length || 0} scenes in raw footage.`, "success");
        return analysis;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("analyzeRaw", false);
        setBusy("analyze-raw", false);
      }
    },
    [notify, setBusy],
  );

  const analyzeInspiration = useCallback(
    async (opts = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body = typeof opts === "string" ? { relPath: opts } : { ...(opts || {}) };
      setBusy("analyzeInspiration", true);
      setBusy("analyze-inspiration", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/analyze-inspiration`, {
          method: "POST",
          body,
        });
        if (res.project) setProject(res.project);
        notify("Inspiration style and pacing analyzed.", "success");
        return res.inspirationProfile || null;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("analyzeInspiration", false);
        setBusy("analyze-inspiration", false);
      }
    },
    [notify, setBusy],
  );

  const extractBrand = useCallback(
    async (opts = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("extractBrand", true);
      setBusy("extract-brand", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/extract-brand`, {
          method: "POST",
          body: opts || {},
        });
        if (res.project) setProject(res.project);
        notify("Brand colors and identity applied.", "success");
        return {
          ...(res.extracted || res.brand || {}),
          project: res.project,
          extracted: res.extracted || res.brand || null,
        };
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("extractBrand", false);
        setBusy("extract-brand", false);
      }
    },
    [notify, setBusy],
  );

  const saveBrief = useCallback(
    async (patch = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("saveBrief", true);
      setBusy("brief", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/brief`, {
          method: "POST",
          body: patch,
        });
        if (res.project) setProject(res.project);
        if (typeof res.aiReadyPrompt === "string") setAiReadyPrompt(res.aiReadyPrompt);
        return res.project;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("saveBrief", false);
        setBusy("brief", false);
      }
    },
    [notify, setBusy],
  );

  const generateTts = useCallback(
    async (textOrPayload, voiceArg = "bn-BD-NabanitaNeural") => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body =
        typeof textOrPayload === "object" && textOrPayload !== null
          ? textOrPayload
          : { text: textOrPayload, voice: voiceArg };
      setBusy("generateTts", true);
      setBusy("tts", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/tts`, {
          method: "POST",
          body,
        });
        if (res.project) setProject(res.project);
        notify("Voiceover generated and added to audio.", "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("generateTts", false);
        setBusy("tts", false);
      }
    },
    [notify, setBusy],
  );

  const deleteReferenceLink = useCallback(
    async (linkOrId) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body =
        typeof linkOrId === "object" && linkOrId !== null
          ? { id: linkOrId.id, url: linkOrId.url }
          : { id: linkOrId, url: linkOrId };
      setBusy("deleteFile", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/reference-link`, {
          method: "DELETE",
          body,
        });
        if (res.project) setProject(res.project);
        notify("Reference link removed.", "info");
        return res.project;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("deleteFile", false);
      }
    },
    [notify, setBusy],
  );

  const deleteProjectFile = useCallback(
    async (relPathOrObj) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");

      if (
        typeof relPathOrObj === "object" &&
        relPathOrObj !== null &&
        (relPathOrObj.isReferenceLink || (!relPathOrObj.relPath && relPathOrObj.url))
      ) {
        return deleteReferenceLink(relPathOrObj);
      }

      const relPath =
        typeof relPathOrObj === "object" && relPathOrObj !== null
          ? relPathOrObj.relPath
          : String(relPathOrObj || "");

      if (/^https?:\/\//i.test(relPath)) {
        return deleteReferenceLink({ url: relPath });
      }

      setBusy("deleteFile", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/file`, {
          method: "DELETE",
          body: { relPath },
        });
        if (res.project) setProject(res.project);
        notify("File removed.", "info");
        return res.project;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("deleteFile", false);
      }
    },
    [deleteReferenceLink, notify, setBusy],
  );

  /* ---------- V2 Dynamic Skills & Video Rating Actions ---------- */
  const setSelectedSkills = useCallback(
    async (nextIds) => {
      const slug = activeSlugRef.current;
      const cleanIds = Array.from(new Set((nextIds || []).filter(Boolean)));
      setSelectedSkillsState(cleanIds);
      if (!slug) return cleanIds;

      setBusy("skills", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/skills`, {
          method: "POST",
          body: { selectedSkills: cleanIds },
        });
        if (Array.isArray(res.selectedSkills)) {
          setSelectedSkillsState(res.selectedSkills);
        }
        if (res.directives) {
          setSkillDirectives(res.directives);
        }
        return res.selectedSkills || cleanIds;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("skills", false);
      }
    },
    [notify, setBusy],
  );

  const toggleSkillSelection = useCallback(
    async (skillId) => {
      if (!skillId) return selectedSkills;
      const exists = selectedSkills.includes(skillId);
      const nextIds = exists
        ? selectedSkills.filter((id) => id !== skillId)
        : [...selectedSkills, skillId];
      return setSelectedSkills(nextIds);
    },
    [selectedSkills, setSelectedSkills],
  );

  const installLocalSkill = useCallback(
    async (payload = {}) => {
      const slug = payload.slug || activeSlugRef.current;
      setBusy("installSkill", true);
      try {
        const res = await api("/api/skills/install", {
          method: "POST",
          body: { ...payload, slug },
        });
        if (Array.isArray(res.skills)) {
          setSkills(normalizeSkillItems(res.skills));
        } else {
          await loadSkillsForSlug(slug);
        }
        const installedId = res.installedSkill?.id || res.installedSkill?.slug;
        if (installedId && slug && !selectedSkills.includes(installedId)) {
          await setSelectedSkills([...selectedSkills, installedId]);
        }
        notify(
          `Installed skill "${res.installedSkill?.name || installedId || "skill"}".`,
          "success",
        );
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("installSkill", false);
      }
    },
    [loadSkillsForSlug, notify, selectedSkills, setBusy, setSelectedSkills],
  );

  const runVideoRating = useCallback(async () => {
    const slug = activeSlugRef.current;
    if (!slug) throw new Error("Select or create a project first.");
    setBusy("videoRating", true);
    try {
      const res = await api(`/api/projects/${encodeURIComponent(slug)}/rating`, {
        method: "POST",
        body: {},
      });
      const normalized = normalizeRatingData(res.rating || res);
      setVideoRating(normalized);
      if (normalized) {
        notify(`Video rated ${normalized.overallScore}/100 (${normalized.grade}).`, "success");
      }
      return normalized;
    } catch (err) {
      notify(err.message, "error");
      throw err;
    } finally {
      setBusy("videoRating", false);
    }
  }, [notify, setBusy]);

  /* ---------- Storyboard, Draw-on-Frame Regional Regen & Saved Vault ---------- */
  const generateStoryboardFrames = useCallback(
    async (opts = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("storyboard", true);
      setBusy("generateStoryboard", true);
      setBusy("storyboard/generate", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/storyboard/generate`, {
          method: "POST",
          body: {
            selectedSkills,
            ...opts,
          },
        });
        const decorated = decorateStoryboardData(slug, res.storyboard);
        setStoryboard(decorated);
        loadRatingForSlug(slug);
        notify(`Generated ${decorated?.frames?.length || 0} design frames.`, "success");
        return decorated;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("storyboard", false);
        setBusy("generateStoryboard", false);
        setBusy("storyboard/generate", false);
      }
    },
    [loadRatingForSlug, notify, selectedSkills, setBusy],
  );

  const regenerateShot = useCallback(
    async (frameId, payload = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body = typeof payload === "string" ? { prompt: payload } : { ...(payload || {}) };
      setBusy(`frame:${frameId}`, true);
      setBusy("regenerateShot", true);
      try {
        const res = await api(
          `/api/projects/${encodeURIComponent(slug)}/storyboard/frames/${encodeURIComponent(frameId)}/regenerate`,
          {
            method: "POST",
            body: { selectedSkills, ...body },
          },
        );
        if (res.storyboard) {
          setStoryboard(decorateStoryboardData(slug, res.storyboard));
        } else if (res.frame) {
          const nextFrame = decorateFrameItem(slug, res.frame);
          setStoryboard((prev) =>
            prev
              ? {
                  ...prev,
                  frames: (prev.frames || []).map((f) => (f.id === frameId ? nextFrame : f)),
                }
              : prev,
          );
        }
        loadRatingForSlug(slug);
        notify("Design frame regenerated.", "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy(`frame:${frameId}`, false);
        setBusy("regenerateShot", false);
      }
    },
    [loadRatingForSlug, notify, selectedSkills, setBusy],
  );

  const regenerateShotRegion = useCallback(
    async (frameId, payload = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy(`frame:${frameId}`, true);
      setBusy("regenerateShotRegion", true);
      try {
        const res = await api(
          `/api/projects/${encodeURIComponent(slug)}/storyboard/frames/${encodeURIComponent(frameId)}/regenerate-region`,
          {
            method: "POST",
            body: {
              selectedSkills,
              ...payload,
            },
          },
        );
        if (res.storyboard) {
          setStoryboard(decorateStoryboardData(slug, res.storyboard));
        } else if (res.frame) {
          const nextFrame = decorateFrameItem(slug, res.frame);
          setStoryboard((prev) =>
            prev
              ? {
                  ...prev,
                  frames: (prev.frames || []).map((f) => (f.id === frameId ? nextFrame : f)),
                }
              : prev,
          );
        }
        loadRatingForSlug(slug);
        notify("Marked area regenerated cleanly.", "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy(`frame:${frameId}`, false);
        setBusy("regenerateShotRegion", false);
      }
    },
    [loadRatingForSlug, notify, selectedSkills, setBusy],
  );

  const updateShot = useCallback(
    async (frameId, patch = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy(`frame:${frameId}`, true);
      try {
        const res = await api(
          `/api/projects/${encodeURIComponent(slug)}/storyboard/frames/${encodeURIComponent(frameId)}`,
          {
            method: "PATCH",
            body: patch,
          },
        );
        if (res.storyboard) {
          setStoryboard(decorateStoryboardData(slug, res.storyboard));
        } else if (res.frame) {
          const nextFrame = decorateFrameItem(slug, res.frame);
          setStoryboard((prev) =>
            prev
              ? {
                  ...prev,
                  frames: (prev.frames || []).map((f) => (f.id === frameId ? nextFrame : f)),
                }
              : prev,
          );
        }
        loadRatingForSlug(slug);
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy(`frame:${frameId}`, false);
      }
    },
    [loadRatingForSlug, notify, setBusy],
  );

  const approveAllShots = useCallback(
    async (opts = { locked: true, approved: true }) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("approveAllShots", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/storyboard/approve-all`, {
          method: "POST",
          body: opts,
        });
        const decorated = decorateStoryboardData(slug, res.storyboard);
        setStoryboard(decorated);
        notify("All design frames approved and locked.", "success");
        return decorated;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("approveAllShots", false);
      }
    },
    [notify, setBusy],
  );

  const saveFrameBookmark = useCallback(
    async (payloadOrFrameId, labelArg = "") => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      const body =
        typeof payloadOrFrameId === "object" && payloadOrFrameId !== null
          ? payloadOrFrameId
          : { frameId: payloadOrFrameId, label: labelArg };
      setBusy("saveFrameBookmark", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/saved-frames`, {
          method: "POST",
          body,
        });
        if (Array.isArray(res.savedFrames)) {
          setSavedFrames(decorateSavedFramesList(slug, res.savedFrames));
        } else {
          await loadSavedFramesForSlug(slug);
        }
        notify("Saved frame to vault.", "success");
        return res.savedFrame || res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("saveFrameBookmark", false);
      }
    },
    [loadSavedFramesForSlug, notify, setBusy],
  );

  const removeSavedFrame = useCallback(
    async (savedId) => {
      const slug = activeSlugRef.current;
      if (!slug || !savedId) return [];
      setBusy(`savedFrame:${savedId}`, true);
      try {
        const res = await api(
          `/api/projects/${encodeURIComponent(slug)}/saved-frames/${encodeURIComponent(savedId)}`,
          { method: "DELETE" },
        );
        const decorated = decorateSavedFramesList(slug, res.savedFrames || []);
        setSavedFrames(decorated);
        notify("Removed saved frame.", "info");
        return decorated;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy(`savedFrame:${savedId}`, false);
      }
    },
    [notify, setBusy],
  );

  /* ---------- Final Video Compilation, QA Gates & Agent Crew ---------- */
  const generateFullVideo = useCallback(
    async (settings = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("generateFullVideo", true);
      try {
        setCompileProgress({
          stage: "slice-clips",
          progress: 0.05,
          status: "running",
          message: "Starting 5-stage video compiler...",
        });
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/generate-video`, {
          method: "POST",
          body: { selectedSkills, ...settings },
        });
        if (res.job) {
          setJobs((prev) => [res.job, ...prev.filter((j) => j.id !== res.job.id)]);
          trackJobUntilSettled(res.job.id, slug);
        }
        notify("Started video generation.", "info");
        return res.job || res;
      } catch (err) {
        setCompileProgress((prev) =>
          prev ? { ...prev, status: "failed", error: err.message } : null,
        );
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("generateFullVideo", false);
      }
    },
    [notify, selectedSkills, setBusy, trackJobUntilSettled],
  );

  const runHyperframesGate = useCallback(
    async (action = "check") => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy(`gate:${action}`, true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/action`, {
          method: "POST",
          body: { action },
        });
        if (res.job) {
          setJobs((prev) => [res.job, ...prev.filter((j) => j.id !== res.job.id)]);
          trackJobUntilSettled(res.job.id, slug);
        }
        notify(`Started ${res.job?.label || action}.`, "info");
        return res.job;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy(`gate:${action}`, false);
      }
    },
    [notify, setBusy, trackJobUntilSettled],
  );

  const enqueueAgentTaskAction = useCallback(
    async (type, payload = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy(`agentTask:${type}`, true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/agent-queue`, {
          method: "POST",
          body: { type, payload },
        });
        if (Array.isArray(res.tickets)) setTickets(res.tickets);
        if (res.agentCrew || res.crew) {
          setAgentCrew(buildDualAgentCrew(res.agentCrew || res.crew));
        }
        notify("Queued task for AI crew.", "success");
        return res.ticket || res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy(`agentTask:${type}`, false);
      }
    },
    [notify, setBusy],
  );

  const updateProviderSettings = useCallback(
    async (patch = {}) => {
      setBusy("providerSettings", true);
      try {
        const res = await api("/api/provider-settings", {
          method: "POST",
          body: patch,
        });
        const next = res.providerSettings || res.settings;
        if (next) setProviderSettings((prev) => ({ ...prev, ...next }));
        notify("Provider settings updated.", "success");
        return next;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("providerSettings", false);
      }
    },
    [notify, setBusy],
  );

  /* ---------- Wave 4 V3 Actions (Voice Sync, Whiteboard & Ad Analytics) ---------- */
  const loadVoices = useCallback(async (lang = "") => {
    const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
    try {
      const res = await api(`/api/voices${query}`);
      const list = Array.isArray(res.voices) ? res.voices : res.catalog || [];
      setVoices(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const syncProjectVoice = useCallback(
    async (payload = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("voiceSync", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/voice-sync`, {
          method: "POST",
          body: payload,
        });
        if (res.project) setProject(res.project);
        if (res.storyboard) {
          setStoryboard(decorateStoryboardData(slug, res.storyboard));
        } else {
          await loadProjectBundle(slug);
        }
        notify("Voice and lip-sync setup applied.", "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("voiceSync", false);
      }
    },
    [loadProjectBundle, notify, setBusy],
  );

  const loadWhiteboard = useCallback(async (slugOverride = null) => {
    const slug = slugOverride || activeSlugRef.current;
    if (!slug) return null;
    try {
      const res = await api(`/api/projects/${encodeURIComponent(slug)}/whiteboard`);
      const graph = res.graph || res.whiteboard || res;
      setWhiteboard(graph);
      return graph;
    } catch {
      return null;
    }
  }, []);

  const saveWhiteboard = useCallback(
    async (graph) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("whiteboard", true);
      try {
        const res = await api(`/api/projects/${encodeURIComponent(slug)}/whiteboard`, {
          method: "POST",
          body: graph,
        });
        const saved = res.graph || res.whiteboard || graph;
        setWhiteboard(saved);
        return saved;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("whiteboard", false);
      }
    },
    [notify, setBusy],
  );

  const compileWhiteboardScene = useCallback(
    async (payload = {}) => {
      const slug = activeSlugRef.current;
      if (!slug) throw new Error("Select or create a project first.");
      setBusy("compileWhiteboard", true);
      try {
        const res = await api(
          `/api/projects/${encodeURIComponent(slug)}/whiteboard/compile-scene`,
          {
            method: "POST",
            body: payload,
          },
        );
        if (res.graph) setWhiteboard(res.graph);
        if (res.storyboard) {
          setStoryboard(decorateStoryboardData(slug, res.storyboard));
        }
        await loadProjectBundle(slug);
        notify("Created scene from connected whiteboard nodes.", "success");
        return res;
      } catch (err) {
        notify(err.message, "error");
        throw err;
      } finally {
        setBusy("compileWhiteboard", false);
      }
    },
    [loadProjectBundle, notify, setBusy],
  );

  const runAdAnalytics = useCallback(async () => {
    const slug = activeSlugRef.current;
    if (!slug) throw new Error("Select or create a project first.");
    setBusy("adAnalytics", true);
    try {
      const res = await api(`/api/projects/${encodeURIComponent(slug)}/ad-analytics`, {
        method: "POST",
        body: {},
      });
      const report = res.analytics || res.adAnalytics || res;
      setAdAnalytics(report);
      notify("Ad creative and retention analytics updated.", "success");
      return report;
    } catch (err) {
      notify(err.message, "error");
      throw err;
    } finally {
      setBusy("adAnalytics", false);
    }
  }, [notify, setBusy]);

  const loadPmInsights = useCallback(async () => {
    try {
      const res = await api("/api/pm-insights");
      const insights = res.insights || res;
      setPmInsights(insights);
      return insights;
    } catch {
      return null;
    }
  }, []);

  const latestToast = toasts.length > 0 ? toasts[toasts.length - 1] : null;

  const contextValue = useMemo(
    () => ({
      // Wizard step & theme
      step,
      setStep,
      theme,
      setTheme,
      toggleTheme,

      // Core project & catalog state
      status,
      looseRootFiles: status?.looseRootFiles || [],
      tools: status?.tools || null,
      projects,
      activeSlug,
      project,
      rawAnalysis,
      aiReadyPrompt,
      folderScan,
      setFolderScan,
      storyboard,
      motionPresets,
      layoutArchetypes,
      catalog,

      // V2 dynamic skills, whole-video rating & saved frames vault
      skills,
      selectedSkills,
      skillDirectives,
      videoRating,
      savedFrames,

      // V3 Voice/Lip-Sync, Whiteboard, Ad Analytics & PM Insights
      voices,
      whiteboard,
      adAnalytics,
      pmInsights,

      // Jobs, SSE, AI Crew & Provider Guard
      jobs,
      compileProgress,
      tickets,
      agentCrew,
      providerSettings,
      sseConnected,

      // Busy & Toasts
      busyMap,
      isBusy,
      uploadProgress,
      toast: latestToast,
      toasts,
      notify,
      dismissToast,

      // Shared Drawer / Modal UI state
      savedFramesDrawerOpen,
      setSavedFramesDrawerOpen,
      agentsDrawerOpen,
      setAgentsDrawerOpen,
      newProjectModalOpen,
      setNewProjectModalOpen,
      editingFrameId,
      setEditingFrameId,

      // Actions
      switchProject,
      createNewProject,
      refreshAll,
      importLooseFile,
      scanFolder,
      importScannedFolder,
      uploadFiles,
      ingestUrl,
      analyzeRaw,
      analyzeInspiration,
      extractBrand,
      saveBrief,
      generateTts,
      deleteProjectFile,
      deleteReferenceLink,
      toggleSkillSelection,
      setSelectedSkills,
      installLocalSkill,
      runVideoRating,
      generateStoryboardFrames,
      regenerateShot,
      regenerateShotRegion,
      updateShot,
      approveAllShots,
      saveFrameBookmark,
      removeSavedFrame,
      generateFullVideo,
      runHyperframesGate,
      enqueueAgentTaskAction,
      updateProviderSettings,
      loadVoices,
      syncProjectVoice,
      loadWhiteboard,
      saveWhiteboard,
      compileWhiteboardScene,
      runAdAnalytics,
      loadPmInsights,
    }),
    [
      step,
      setStep,
      theme,
      setTheme,
      toggleTheme,
      status,
      projects,
      activeSlug,
      project,
      rawAnalysis,
      aiReadyPrompt,
      folderScan,
      storyboard,
      motionPresets,
      layoutArchetypes,
      catalog,
      skills,
      selectedSkills,
      skillDirectives,
      videoRating,
      savedFrames,
      voices,
      whiteboard,
      adAnalytics,
      pmInsights,
      jobs,
      compileProgress,
      tickets,
      agentCrew,
      providerSettings,
      sseConnected,
      busyMap,
      isBusy,
      uploadProgress,
      latestToast,
      toasts,
      notify,
      dismissToast,
      savedFramesDrawerOpen,
      agentsDrawerOpen,
      newProjectModalOpen,
      editingFrameId,
      switchProject,
      createNewProject,
      refreshAll,
      importLooseFile,
      scanFolder,
      importScannedFolder,
      uploadFiles,
      ingestUrl,
      analyzeRaw,
      analyzeInspiration,
      extractBrand,
      saveBrief,
      generateTts,
      deleteProjectFile,
      deleteReferenceLink,
      toggleSkillSelection,
      setSelectedSkills,
      installLocalSkill,
      runVideoRating,
      generateStoryboardFrames,
      regenerateShot,
      regenerateShotRegion,
      updateShot,
      approveAllShots,
      saveFrameBookmark,
      removeSavedFrame,
      generateFullVideo,
      runHyperframesGate,
      enqueueAgentTaskAction,
      updateProviderSettings,
      loadVoices,
      syncProjectVoice,
      loadWhiteboard,
      saveWhiteboard,
      compileWhiteboardScene,
      runAdAnalytics,
      loadPmInsights,
    ],
  );

  return <StudioContext.Provider value={contextValue}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error("useStudio() must be used inside <StudioProvider>.");
  }
  return ctx;
}
