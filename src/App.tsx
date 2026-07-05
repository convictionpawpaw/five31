import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from './components/index.ts';
import { router } from './routes.tsx';
import './App.css';

function App() {
  return (
    <ToastProvider>
      {/* Decorative scanline + grain overlay (off under reduced-motion). */}
      <div className="fx-overlay" aria-hidden="true" />
      <RouterProvider router={router} />
    </ToastProvider>
  );
}

export default App;
