import { createHashRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout.tsx';
import { SettingsGate } from './SettingsGate.tsx';
import { OnboardingWizard } from './features/onboarding/OnboardingWizard.tsx';
import { TodayScreen } from './features/today/TodayScreen.tsx';
import { WorkoutScreen } from './features/workout/WorkoutScreen.tsx';
import { SlSessionScreen } from './features/sl/SlSessionScreen.tsx';
import { CycleScreen } from './features/cycle/CycleScreen.tsx';
import { ProgressScreen } from './features/progress/ProgressScreen.tsx';
import { HistoryScreen } from './features/history/HistoryScreen.tsx';
import { HistoryDetailScreen } from './features/history/HistoryDetailScreen.tsx';
import { AccessoriesScreen } from './features/accessories/AccessoriesScreen.tsx';
import { SettingsScreen } from './features/settings/SettingsScreen.tsx';
import { StretchScreen } from './features/stretch/StretchScreen.tsx';
import { StretchPlayerScreen } from './features/stretch/StretchPlayerScreen.tsx';
import { StretchGalleryScreen } from './features/stretch/StretchGalleryScreen.tsx';
import { RouteErrorScreen } from './components/ErrorScreen.tsx';

/**
 * Hash router (GitHub Pages friendly). Onboarding lives outside the tab shell
 * and the settings gate; everything else renders inside <SettingsGate> (which
 * forces onboarding when there is no completed Settings row) then <AppLayout>
 * with the bottom TabBar.
 *
 * Both top-level routes carry an `errorElement`: any render error (including a
 * rethrown live-query error) or a failed db.open() lands on an app-styled
 * screen that can still Reload and Export a backup, instead of React Router's
 * default page with no way out (the installed PWA has no address bar).
 */
export const router = createHashRouter([
  {
    path: '/onboarding',
    element: <OnboardingWizard />,
    errorElement: <RouteErrorScreen />,
  },
  {
    element: <SettingsGate />,
    errorElement: <RouteErrorScreen />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <TodayScreen /> },
          { path: 'workout/:id', element: <WorkoutScreen /> },
          // A StrongLifts session is trained as a unit, so it gets its own route;
          // /workout/:id for an SL row redirects here (see WorkoutScreen).
          { path: 'sl-session/:cycleId/:n', element: <SlSessionScreen /> },
          { path: 'cycle', element: <CycleScreen /> },
          { path: 'progress', element: <ProgressScreen /> },
          { path: 'history', element: <HistoryScreen /> },
          { path: 'history/:id', element: <HistoryDetailScreen /> },
          { path: 'accessories', element: <AccessoriesScreen /> },
          { path: 'settings', element: <SettingsScreen /> },
          { path: 'stretch', element: <StretchScreen /> },
          { path: 'stretch/play', element: <StretchPlayerScreen /> },
          { path: 'stretch/gallery', element: <StretchGalleryScreen /> },
        ],
      },
    ],
  },
]);
