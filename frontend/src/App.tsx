import React, { useState } from 'react';
import WelcomePage from './pages/WelcomePage';
import HealthPage from './pages/HealthPage';

type Page = 'welcome' | 'health';

function App() {
  const [page, setPage] = useState<Page>('welcome');

  return (
    <>
      {page === 'welcome' && (
        <WelcomePage onNavigateToHealth={() => setPage('health')} />
      )}
      {page === 'health' && (
        <HealthPage onBack={() => setPage('welcome')} />
      )}
    </>
  );
}

export default App;
