import {
  Activity as ActivityIcon, Beer, BookOpen, Boxes, ChartColumn, ChefHat, ClipboardCheck, ClipboardList, FileBarChart, Gauge, History, LayoutGrid, Percent, QrCode, Receipt, Scale, Settings, ShoppingBasket, Store, Tag, Truck, UserCog, Users, Wallet, Wine, type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@fnb/shared';
import { ActivityPage } from '../pages/activity';
import { AuditPage } from '../pages/audit';
import { DashboardPage } from '../pages/dashboard/dashboard';
import { ReportsPage } from '../pages/dashboard/reports';
import { ApprovalsPage } from '../pages/inventory/approvals';
import { CountsPage } from '../pages/inventory/counts';
import { LiquorRegisterPage } from '../pages/inventory/liquor-register';
import { StockPage } from '../pages/inventory/stock';
import { BrandsPage, CategoriesPage, LiquorTreePage, TaxClassesPage } from '../pages/catalog';
import { MenuItemsPage } from '../pages/menu-items';
import { CostingPage } from '../pages/pricing/costing';
import { MarginTargetsPage } from '../pages/pricing/margin-targets';
import { OffersPage } from '../pages/pricing/offers';
import { DeliveriesPage } from '../pages/purchasing/deliveries';
import { GrnsPage } from '../pages/purchasing/grns';
import { IndentsPage } from '../pages/purchasing/indents';
import { VendorsPage } from '../pages/purchasing/vendors';
import { OutletsPage } from '../pages/business/outlets';
import { SettingsPage } from '../pages/business/settings';
import { TablesPage } from '../pages/business/tables';
import { StockItemsPage } from '../pages/stock-items';
import { RolesPage } from '../pages/people/roles';
import { UsersPage } from '../pages/people/users';

// ---------- Navigation ----------

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  group: string;
  page: () => React.JSX.Element | null;
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
  { to: '/margin-targets', label: 'Margin targets', icon: Scale, group: 'Menu', perm: 'rates.view', page: MarginTargetsPage },
  { to: '/stock', label: 'Stock', icon: Boxes, group: 'Inventory', perm: 'inventory.view', page: StockPage, keywords: 'wastage transfer ledger' },
  { to: '/counts', label: 'Stock counts', icon: ClipboardList, group: 'Inventory', perm: 'inventory.view', page: CountsPage, keywords: 'variance opening stock' },
  { to: '/liquor-register', label: 'Liquor register', icon: Wine, group: 'Inventory', perm: 'inventory.view', page: LiquorRegisterPage, keywords: 'excise bottles' },
  { to: '/indents', label: 'Nightly indent', icon: ShoppingBasket, group: 'Purchasing', perm: 'indent.manage', page: IndentsPage, keywords: 'order vendor pdf whatsapp' },
  { to: '/deliveries', label: 'Deliveries', icon: Truck, group: 'Purchasing', perm: 'indent.manage', page: DeliveriesPage, keywords: 'gate receiving grn' },
  { to: '/vendors', label: 'Vendors and rates', icon: Store, group: 'Purchasing', perm: 'vendors.manage', page: VendorsPage, keywords: 'suppliers rate history' },
  { to: '/accounts', label: 'Accounts', icon: Wallet, group: 'Purchasing', perm: 'rates.view', page: GrnsPage, keywords: 'payments goods received notes' },
  { to: '/stock-items', label: 'Stock items', icon: ChefHat, group: 'Catalog', perm: 'catalog.view', page: StockItemsPage, keywords: 'ingredients bottles units par' },
  { to: '/liquor', label: 'Liquor tree', icon: Beer, group: 'Catalog', perm: 'catalog.view', page: LiquorTreePage },
  { to: '/categories', label: 'Courses and categories', icon: LayoutGrid, group: 'Catalog', perm: 'catalog.view', page: CategoriesPage },
  { to: '/brands', label: 'Brands', icon: Tag, group: 'Catalog', perm: 'catalog.view', page: BrandsPage },
  { to: '/tax-classes', label: 'Tax classes', icon: Receipt, group: 'Catalog', perm: 'catalog.view', page: TaxClassesPage, keywords: 'gst vat' },
  { to: '/outlets', label: 'Outlets', icon: Store, group: 'Business', page: OutletsPage, keywords: 'qr code fssai' },
  { to: '/tables', label: 'Tables', icon: QrCode, group: 'Business', perm: 'pos.bill', page: TablesPage, keywords: 'qr code table ordering guest' },
  { to: '/users', label: 'Users', icon: Users, group: 'Business', perm: 'users.manage', page: UsersPage, keywords: 'staff pin password' },
  { to: '/roles', label: 'Roles', icon: UserCog, group: 'Business', perm: 'users.manage', page: RolesPage, keywords: 'permissions' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'Business', perm: 'settings.manage', page: SettingsPage, keywords: 'cut-off tolerance offers switch' },
  { to: '/audit', label: 'Change history', icon: History, group: 'Business', perm: 'audit.view', page: AuditPage, keywords: 'audit log' },
];
