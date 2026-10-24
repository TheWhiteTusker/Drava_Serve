import {
  Activity as ActivityIcon, Beer, BookOpen, Boxes, ChartColumn, ChefHat, ClipboardCheck, ClipboardList, FileBarChart, Gauge, History, LayoutGrid, Percent, QrCode, Receipt, Scale, Settings, ShoppingBasket, Store, Tag, Truck, UserCog, Users, Wallet, Wine, type LucideIcon,
} from 'lucide-react';
import { lazy } from 'react';
import type { Permission } from '@fnb/shared';

// ---------- Pages, each loaded the first time it is opened ----------

// Every page is its own download, so the first screen carries only its own code. Hovering a menu link
// fetches the page it leads to before the click (preload).
function lazyPage(load: () => Promise<() => React.JSX.Element | null>) {
  const Page = lazy(() => load().then((component) => ({ default: component })));
  return Object.assign(Page, { preload: load });
}
const ActivityPage = lazyPage(() => import('../pages/activity').then((m) => m.ActivityPage));
const AuditPage = lazyPage(() => import('../pages/audit').then((m) => m.AuditPage));
const DashboardPage = lazyPage(() => import('../pages/dashboard/dashboard').then((m) => m.DashboardPage));
const ReportsPage = lazyPage(() => import('../pages/dashboard/reports').then((m) => m.ReportsPage));
const ApprovalsPage = lazyPage(() => import('../pages/inventory/approvals').then((m) => m.ApprovalsPage));
const CountsPage = lazyPage(() => import('../pages/inventory/counts').then((m) => m.CountsPage));
const LiquorRegisterPage = lazyPage(() => import('../pages/inventory/liquor-register').then((m) => m.LiquorRegisterPage));
const StockPage = lazyPage(() => import('../pages/inventory/stock').then((m) => m.StockPage));
const BrandsPage = lazyPage(() => import('../pages/catalog').then((m) => m.BrandsPage));
const CategoriesPage = lazyPage(() => import('../pages/catalog').then((m) => m.CategoriesPage));
const LiquorTreePage = lazyPage(() => import('../pages/catalog').then((m) => m.LiquorTreePage));
const TaxClassesPage = lazyPage(() => import('../pages/catalog').then((m) => m.TaxClassesPage));
const MenuItemsPage = lazyPage(() => import('../pages/menu-items').then((m) => m.MenuItemsPage));
const CostingPage = lazyPage(() => import('../pages/pricing/costing').then((m) => m.CostingPage));
const MarginTargetsPage = lazyPage(() => import('../pages/pricing/margin-targets').then((m) => m.MarginTargetsPage));
const OffersPage = lazyPage(() => import('../pages/pricing/offers').then((m) => m.OffersPage));
const DeliveriesPage = lazyPage(() => import('../pages/purchasing/deliveries').then((m) => m.DeliveriesPage));
const GrnsPage = lazyPage(() => import('../pages/purchasing/grns').then((m) => m.GrnsPage));
const IndentsPage = lazyPage(() => import('../pages/purchasing/indents').then((m) => m.IndentsPage));
const VendorsPage = lazyPage(() => import('../pages/purchasing/vendors').then((m) => m.VendorsPage));
const OutletsPage = lazyPage(() => import('../pages/business/outlets').then((m) => m.OutletsPage));
const SettingsPage = lazyPage(() => import('../pages/business/settings').then((m) => m.SettingsPage));
const TablesPage = lazyPage(() => import('../pages/business/tables').then((m) => m.TablesPage));
const StockItemsPage = lazyPage(() => import('../pages/stock-items').then((m) => m.StockItemsPage));
const RolesPage = lazyPage(() => import('../pages/people/roles').then((m) => m.RolesPage));
const UsersPage = lazyPage(() => import('../pages/people/users').then((m) => m.UsersPage));

// ---------- Navigation ----------

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  group: string;
  page: React.ComponentType & { preload?: () => unknown };
  keywords?: string;
}
export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Gauge, group: 'Overview', perm: 'reports.view', page: DashboardPage, keywords: 'sales today home' },
  { to: '/reports', label: 'Reports', icon: FileBarChart, group: 'Overview', perm: 'reports.view', page: ReportsPage, keywords: 'menu engineering pour cost csv export day close' },
  { to: '/activity', label: 'Activity', icon: ActivityIcon, group: 'Overview', perm: 'reports.view', page: ActivityPage, keywords: 'offers log history sold out what happened' },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, group: 'Overview', page: ApprovalsPage, keywords: 'approve reject pending' },
  { to: '/menu-items', label: 'Menu items', icon: BookOpen, group: 'Menu', perm: 'catalog.view', page: MenuItemsPage, keywords: 'dishes drinks prices food' },
  { to: '/costing', label: 'Costs and order', icon: ChartColumn, group: 'Menu', perm: 'rates.view', page: CostingPage, keywords: 'recipes margin ranking pin' },
  { to: '/offers', label: 'Beverage offers', icon: Percent, group: 'Menu', perm: 'rates.view', page: OffersPage, keywords: 'discount liquor rule' },
  { to: '/margin-targets', label: 'Profit targets', icon: Scale, group: 'Menu', perm: 'rates.view', page: MarginTargetsPage },
  { to: '/stock', label: 'Stock', icon: Boxes, group: 'Inventory', perm: 'inventory.view', page: StockPage, keywords: 'wastage transfer ledger' },
  { to: '/counts', label: 'Stock counts', icon: ClipboardList, group: 'Inventory', perm: 'inventory.view', page: CountsPage, keywords: 'variance opening stock' },
  { to: '/liquor-register', label: 'Liquor register', icon: Wine, group: 'Inventory', perm: 'inventory.view', page: LiquorRegisterPage, keywords: 'excise bottles' },
  { to: '/indents', label: 'Order from vendors', icon: ShoppingBasket, group: 'Purchasing', perm: 'indent.manage', page: IndentsPage, keywords: 'nightly indent order vendor pdf whatsapp' },
  { to: '/deliveries', label: 'Deliveries', icon: Truck, group: 'Purchasing', perm: 'indent.manage', page: DeliveriesPage, keywords: 'gate receiving grn' },
  { to: '/vendors', label: 'Suppliers and prices', icon: Store, group: 'Purchasing', perm: 'vendors.manage', page: VendorsPage, keywords: 'vendors rates suppliers rate history' },
  { to: '/accounts', label: 'Bills to pay', icon: Wallet, group: 'Purchasing', perm: 'rates.view', page: GrnsPage, keywords: 'accounts payments goods received notes grn' },
  { to: '/stock-items', label: 'Ingredients and bottles', icon: ChefHat, group: 'Catalog', perm: 'catalog.view', page: StockItemsPage, keywords: 'stock items ingredients bottles units par' },
  { to: '/liquor', label: 'Liquor tree', icon: Beer, group: 'Catalog', perm: 'catalog.view', page: LiquorTreePage },
  { to: '/categories', label: 'Courses and categories', icon: LayoutGrid, group: 'Catalog', perm: 'catalog.view', page: CategoriesPage },
  { to: '/brands', label: 'Brands', icon: Tag, group: 'Catalog', perm: 'catalog.view', page: BrandsPage },
  { to: '/tax-classes', label: 'Taxes', icon: Receipt, group: 'Catalog', perm: 'catalog.view', page: TaxClassesPage, keywords: 'tax classes gst vat' },
  { to: '/outlets', label: 'Outlets', icon: Store, group: 'Business', page: OutletsPage, keywords: 'qr code fssai' },
  { to: '/tables', label: 'Tables', icon: QrCode, group: 'Business', perm: 'pos.bill', page: TablesPage, keywords: 'qr code table ordering guest' },
  { to: '/users', label: 'Users', icon: Users, group: 'Business', perm: 'users.manage', page: UsersPage, keywords: 'staff pin password' },
  { to: '/roles', label: 'Roles', icon: UserCog, group: 'Business', perm: 'users.manage', page: RolesPage, keywords: 'permissions' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'Business', perm: 'settings.manage', page: SettingsPage, keywords: 'cut-off tolerance offers switch' },
  { to: '/audit', label: 'Change history', icon: History, group: 'Business', perm: 'audit.view', page: AuditPage, keywords: 'audit log' },
];
