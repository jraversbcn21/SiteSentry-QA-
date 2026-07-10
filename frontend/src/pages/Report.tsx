import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReportViewer from '../components/ReportViewer/ReportViewer';
import ErrorBoundary from '../components/ErrorBoundary';
import { scanApi, unwrapApiError } from '../services/api';
import { ReportResponse } from '../types';
import './Report.css';

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!id) {
      navigate('/');
      return;
    }

    let ignore = false;

    const fetchReport = async () => {
      try {
        setLoading(true);
        setError('');
        const data = await scanApi.getReport(id);
        if (ignore) return;
        setReport(data);
      } catch (err: any) {
        if (ignore) return;
        setError(unwrapApiError(err));
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchReport();

    return () => { ignore = true; };
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="report-loading">
        <p>Cargando reporte...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="report-error">
        <p>{error || 'Reporte no encontrado'}</p>
        {error && (
          <details style={{ marginTop: '16px', textAlign: 'left', maxWidth: '600px' }}>
            <summary style={{ cursor: 'pointer', color: '#666' }}>Detalles del error</summary>
            <pre style={{ 
              marginTop: '8px', 
              padding: '12px', 
              background: '#f5f5f5', 
              borderRadius: '4px',
              fontSize: '12px',
              overflow: 'auto'
            }}>
              {JSON.stringify({ id, error, report: report ? 'exists' : 'null' }, null, 2)}
            </pre>
          </details>
        )}
        <button onClick={() => navigate('/')} className="back-button">
          Volver al inicio
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="report-page">
        <div className="report-page-header">
          <button onClick={() => navigate('/')} className="back-button">
            ← Volver al inicio
          </button>
        </div>
        <div className="report-page-content">
          <ReportViewer report={report} />
        </div>
      </div>
    </ErrorBoundary>
  );
}

