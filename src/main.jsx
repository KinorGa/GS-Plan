import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider } from './i18n';
import Layout from './components/Layout';
import CharList from './pages/CharList';
import CharDetail from './pages/CharDetail';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/char" replace />} />
            <Route path="/char" element={<CharList />} />
            <Route path="/char/:id" element={<CharDetail />} />
            <Route path="*" element={<Navigate to="/char" replace />} />
          </Routes>
        </Layout>
      </HashRouter>
    </I18nProvider>
  </React.StrictMode>
);
