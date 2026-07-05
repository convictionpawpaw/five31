import { Outlet } from 'react-router-dom';
import { InstallHint, TabBar } from './components/index.ts';

/**
 * The tab-shell layout: scrollable content area (Outlet) above a fixed bottom
 * TabBar. The content region reserves space for the tab bar via padding.
 */
export function AppLayout() {
  return (
    <div className="app-shell">
      <InstallHint />
      <main className="app-content safe-x">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
