import { NavLink } from 'react-router-dom';
import './TabBar.css';

interface Tab {
  to: string;
  label: string;
}

const TABS: Tab[] = [
  { to: '/', label: 'Today' },
  { to: '/cycle', label: 'Cycle' },
  { to: '/stretch', label: 'Stretch' },
  { to: '/progress', label: 'Progress' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

/**
 * Fixed bottom navigation. 6 tabs, 56px tall + safe-area inset. Active tab is
 * amber with a cyan underline. A tab stays active on its sub-routes
 * (e.g. /stretch/play), except Today which matches '/' exactly.
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
