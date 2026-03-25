import {
  Type, AlignLeft, Hash, Mail, Phone,
  Calendar, Clock, CalendarClock, Timer,
  CircleDot, CheckSquare, ListFilter,
  MapPin, Navigation2, Route,
  Camera, Mic, PenLine, Paperclip,
  ScanLine,
  Layers, Repeat2,
  Calculator, EyeOff,
  StickyNote, Minus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  text:               Type,
  textarea:           AlignLeft,
  number:             Hash,
  email:              Mail,
  phone:              Phone,
  date:               Calendar,
  time:               Clock,
  datetime:           CalendarClock,
  timestamp:          Timer,
  select_one:         CircleDot,
  select_multiple:    CheckSquare,
  select_one_other:   ListFilter,
  geopoint:           MapPin,
  geotrace:           Navigation2,
  route:              Route,
  photo:              Camera,
  audio:              Mic,
  signature:          PenLine,
  file:               Paperclip,
  barcode:            ScanLine,
  group:              Layers,
  repeat:             Repeat2,
  calculated:         Calculator,
  hidden:             EyeOff,
  note:               StickyNote,
  divider:            Minus,
};

const CATEGORY_MAP: Record<string, string> = {
  text: "basic", textarea: "basic", number: "basic", email: "basic", phone: "basic",
  date: "datetime", time: "datetime", datetime: "datetime", timestamp: "datetime",
  select_one: "choice", select_multiple: "choice", select_one_other: "choice",
  geopoint: "location", geotrace: "location", route: "location",
  photo: "media", audio: "media", signature: "media", file: "media",
  barcode: "scan",
  group: "structure", repeat: "structure",
  calculated: "logic", hidden: "logic",
  note: "display", divider: "display",
};

const CATEGORY_COLORS: Record<string, string> = {
  basic:     "bg-blue-100 text-blue-700",
  datetime:  "bg-purple-100 text-purple-700",
  choice:    "bg-green-100 text-green-700",
  location:  "bg-amber-100 text-amber-700",
  media:     "bg-teal-100 text-teal-700",
  scan:      "bg-indigo-100 text-indigo-700",
  structure: "bg-orange-100 text-orange-700",
  logic:     "bg-pink-100 text-pink-700",
  display:   "bg-gray-100 text-gray-600",
};

export default function FieldIcon({ type }: { type: string }) {
  const Icon = ICON_MAP[type] ?? Type;
  const category = CATEGORY_MAP[type] ?? "basic";
  const colors = CATEGORY_COLORS[category] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded flex-shrink-0 ${colors}`}>
      <Icon size={14} strokeWidth={2} />
    </span>
  );
}
