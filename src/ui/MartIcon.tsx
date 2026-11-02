import { createElement, useEffect, useState } from 'react';
import {
  Activity, BadgeCheck, BadgeDollarSign, BellRing, Blocks, Box, Braces, Building2, Calendar, ChartColumn, ChartNoAxesCombined, ChartPie, Cloud, Coins, CreditCard, Database, DatabaseZap, Eye, FileCode, FileSpreadsheet, FileText, Filter, Fingerprint, Flag, FlaskConical, Gauge, Globe, Goal, Handshake, Image, Layers, LayoutDashboard, LayoutTemplate, LifeBuoy, Mail, MapPin, Megaphone, Merge, MessageCircle, MousePointerClick, Newspaper, Package, Phone, PiggyBank, Radio, Receipt, Repeat, Route, ScanEye, ScrollText, Search, Server, Sheet, ShoppingBag, ShoppingCart, Sigma, Smartphone, Star, Store, Table, Tag, Target, TicketPercent, TrendingUp, Truck, Undo2, User, UserPlus, Users, Video, Wallet, Warehouse, Webhook, Workflow,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

export { toLucideName } from './lucideName';

/*
 * A Data Mart's own icon, drawn the way the host draws it
 * (owox-data-marts apps/web/src/features/data-marts/shared/components/DataMartIcon).
 * `icon` is a recommended key, `lucide:<kebab-name>` for any library icon, or null for the default.
 */

/** Recommended keys, copied verbatim from the host's `DATA_MART_ICON_OPTIONS`. */
const BY_KEY: Record<string, LucideIcon> = {
  'purchases': ShoppingCart,
  'orders': Receipt,
  'products': Package,
  'inventory': Warehouse,
  'revenue': TrendingUp,
  'finance': Wallet,
  'ad-spend': BadgeDollarSign,
  'campaigns': Target,
  'traffic-sources': Megaphone,
  'sessions': MousePointerClick,
  'pageviews': Eye,
  'events': Activity,
  'conversions': Flag,
  'customers': Users,
  'users': User,
  'leads': UserPlus,
  'countries': MapPin,
  'devices': Smartphone,
  'email': Mail,
  'keywords': Search,
  'social': MessageCircle,
  'subscriptions': Repeat,
  'calendar': Calendar,
  'support': LifeBuoy,
  'database': Database,
  'table': Table,
  'payments': CreditCard,
  'invoices': FileText,
  'refunds': Undo2,
  'carts': ShoppingBag,
  'shipping': Truck,
  'promotions': TicketPercent,
  'stores': Store,
  'exchange-rates': Coins,
  'creatives': Image,
  'video': Video,
  'websites': Globe,
  'landing-pages': LayoutTemplate,
  'content': Newspaper,
  'deals': Handshake,
  'companies': Building2,
  'calls': Phone,
  'reviews': Star,
  'funnels': Filter,
  'segments': ChartPie,
  'experiments': FlaskConical,
  'kpis': Gauge,
  'forecasts': ChartNoAxesCombined,
  'data-sources': DatabaseZap,
  'pipelines': Workflow,
  'sql': FileCode,
  'api': Webhook,
  'cloud': Cloud,
  'servers': Server,
  'reports': FileSpreadsheet,
  'spreadsheets': Sheet,
  'dashboards': LayoutDashboard,
  'charts': ChartColumn,
  'joins': Merge,
  'schemas': Braces,
  'dimensions': Layers,
  'metrics': Sigma,
  'data-quality': BadgeCheck,
  'history': ScrollText,
  'utm': Tag,
  'attribution': Route,
  'channels': Radio,
  'budgets': PiggyBank,
  'goals': Goal,
  'identities': Fingerprint,
  'cohorts': Blocks,
  'alerts': BellRing,
  'impressions': ScanEye,
};

/** Shown when a Data Mart has no icon picked, or names one the library does not know. */
export const DEFAULT_ICON: LucideIcon = Box;

const PREFIX = 'lucide:';

type Catalog = Map<string, LucideIcon>;
let catalog: Catalog | undefined;
let pending: Promise<Catalog> | undefined;

/** The whole library is a separate chunk, loaded only when a mart picked a `lucide:` icon. */
function loadCatalog(): Promise<Catalog> {
  pending ??= import('./lucideCatalog').then(
    (lib) => (catalog = lib.ICONS),
    (e: unknown) => { pending = undefined; throw e; },
  );
  return pending;
}

export function MartIcon({ icon, ...props }: LucideProps & { icon: string | null | undefined }) {
  const library = typeof icon === 'string' && icon.startsWith(PREFIX);
  const [lib, setLib] = useState(catalog);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!library || lib) return;
    let live = true;
    loadCatalog().then((c) => live && setLib(c), () => live && setFailed(true));
    return () => { live = false; };
  }, [library, lib]);

  if (!library) return createElement((icon && BY_KEY[icon]) || DEFAULT_ICON, props);
  if (failed) return createElement(DEFAULT_ICON, props);
  // Until the library loads, an empty box of the same size holds the place.
  if (!lib) return <svg width={props.size ?? 24} height={props.size ?? 24} aria-hidden="true" />;
  return createElement(lib.get(icon.slice(PREFIX.length)) ?? DEFAULT_ICON, props);
}
