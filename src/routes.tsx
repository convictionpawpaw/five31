import { createHashRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout.tsx';
import { SettingsGate } from './SettingsGate.tsx';
import { OnboardingWizard } from './features/onboarding/OnboardingWizard.tsx';
import { TodayScreen } from './features/today/TodayScreen.tsx';
import { WorkoutScreen } from './features/workout/WorkoutScreen.tsx';
import { CycleScreen } from './features/cycle/CycleScreen.tsx';
import { ProgressScreen } from './features/progress/ProgressScreen.tsx';
import { HistoryScreen } from './features/history/HistoryScreen.tsx';
import { HistoryDetailScreen } from './features/history/HistoryDetailScreen.tsx';
import { AccessoriesScreen } from './features/accessories/AccessoriesScreen.tsx';
import { SettingsScreen } from './features/settings/SettingsScreen.tsx';

/**
 * Hash router (GitHub Pages friendly). Onboarding lives outside the tab shell
 * and the settings gate; everything else renders inside <SettingsGate> (which
 * forces onboarding when there is no completed Settings row) then <AppLayout>
 * with the bottom TabBar.
 */
export const router = createHashRouter([
  {
    path: '/onboarding',
    element: <OnboardingWizard />,
  },
  {
    element: <SettingsGate />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <TodayScreen /> },
          { path: 'workout/:id', element: <WorkoutScreen /> },
          { path: 'cycle', element: <CycleScreen /> },
          { path: 'progress', element: <ProgressScreen /> },
          { path: 'history', element: <HistoryScreen /> },
          { path: 'history/:id', element: <HistoryDetailScreen /> },
          { path: 'accessories', element: <AccessoriesScreen /> },
          { path: 'settings', element: <SettingsScreen /> },
        ],
      },
    ],
  },
]);
