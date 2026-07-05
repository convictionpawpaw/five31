import { NavLink } from 'react-router-dom';
import './TabBar.css';

interface Tab {
  to: string;
  label: string;
}

const TABS: Tab[] = [
  { to: '/', label: 'Today' },
  { to: '/cycle', label: 'Cycle' },
  { to: '/progress', label: 'Progress' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

/**
 * Fixed bottom navigation. 5 tabs, 56px tall + safe-area inset. Active tab is
 * amber with a cyan underline.
 */
export function TabBar() {
  return (
    <nav className="tabbar safe-bottom" aria-label="Primary">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => `tabbar__tab${isActive ? ' is-active' : ''}`}
        >
          <span className="tabbar__label label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
