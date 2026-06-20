import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import URLInput from '../components/URLInput/URLInput';
import ScanProgress from '../components/ScanProgress/ScanProgress';
import FlowEditor from '../components/FlowEditor/FlowEditor';
import { scanApi } from '../services/api';
import { ScanStatus } from '../types';
import type { FlowDefinition, FlowStep, ScanResponse, ScanStatusResponse } from '../types';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const [currentScan, setCurrentScan] = useState<ScanResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null);
  const [recentScans, setRecentScans] = useState<ScanResponse[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');
  const [savedFlows, setSavedFlows] = useState<FlowDefinition[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [showFlowEditor, setShowFlowEditor] = useState(false);
  const [inlineFlow, setInlineFlow] = useState<{ name: string; steps: FlowStep[] } | undefined>();

  useEffect(() => {
    loadRecentScans();
    scanApi.getFlows().then(setSavedFlows).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentScan || !currentScan.id) return;
    if (scanStatus?.status === ScanStatus.COMPLETED || scanStatus?.status === ScanStatus.FAILED) return;

    const interval = setInterval(async () => {
      try {
        const status = await scanApi.getScanStatus(currentScan.id);
        setScanStatus(status);
        if (status.status === ScanStatus.COMPLETED) {
          clearInterval(interval);
          setTimeout(() => navigate(`/report/${currentScan.id}`), 1000);
        } else if (status.status === ScanStatus.FAILED) {
          clearInterval(interval);
          setError('El análisis falló. Por favor intenta nuevamente.');
          setCurrentScan(null);
        }
      } catch (err) {
        console.error('Error polling scan status:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentScan, scanStatus, navigate]);

  const loadRecentScans = async () => {
    try {
      const scans = await scanApi.getReports(5, 0);
      setRecentScans(scans);
    } catch {
      // Silently fail - recent scans are optional
    }
  };

  const handleStartScan = async (url: string) => {
    setIsStarting(true);
    setError('');
    setCurrentScan(null);
    setScanStatus(null);

    try {
      const scanRequest: any = { url };
      if (inlineFlow) {
        scanRequest.flow = inlineFlow;
      } else if (selectedFlowId) {
        scanRequest.flowId = selectedFlowId;
      }
      const scan = await scanApi.startScan(scanRequest);
      setCurrentScan(scan);
      setScanStatus({
        id: scan.id,
        status: scan.status,
        url: scan.url,
        createdAt: scan.createdAt,
      });
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        err?.response?.data?.details?.[0]?.message ||
        err?.message ||
        'Error al iniciar el análisis';
      setError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancelScan = () => {
    setCurrentScan(null);
    setScanStatus(null);
    setError('');
  };

  const isScanning = !!currentScan && scanStatus?.status !== ScanStatus.COMPLETED && scanStatus?.status !== ScanStatus.FAILED;

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-header-content">
          <div className="home-logo">
            <span className="home-logo-icon">🔍</span>
            <div>
              <h1>SiteSentry QA</h1>
              <p>Analisis automatizado de calidad web</p>
            </div>
          </div>
          <Link to="/settings" className="home-settings-link" title="Ajustes">
            ⚙️
          </Link>
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h2>Analiza cualquier pagina web al instante</h2>
          <p className="home-subtitle">
            Ejecuta 9 controles automatizados: recursos rotos, APIs fallidas, interactividad, contenido vacio, carga diferida, formularios/modales, errores de consola, rendimiento y accesibilidad WCAG. Todo en una sola pagina.
          </p>
        </section>

        <section className="home-scan-section">
          {!isScanning ? (
            <>
              <div className="flow-selector">
                <select
                  value={selectedFlowId}
                  onChange={(e) => {
                    setSelectedFlowId(e.target.value);
                    setInlineFlow(undefined);
                  }}
                  className="flow-select"
                >
                  <option value="">Sin flujo (scan normal)</option>
                  {savedFlows.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} ({f.steps.length} pasos)</option>
                  ))}
                </select>
                <button className="new-flow-btn" onClick={() => setShowFlowEditor(true)}>
                  + Nuevo flujo
                </button>
              </div>
              <URLInput onSubmit={handleStartScan} isLoading={isStarting} />
              {error && (
                <div className="home-error">
                  <span>⚠️</span> {error}
                </div>
              )}
            </>
          ) : (
            <ScanProgress
              scanId={currentScan!.id}
              url={scanStatus?.url || ''}
              status={scanStatus?.status || ScanStatus.PENDING}
              progress={scanStatus?.progress}
              onCancel={handleCancelScan}
            />
          )}
        </section>

        <section className="home-features">
          <h3>Que detectamos?</h3>
          <div className="home-features-grid">
            <div className="feature-card">
              <span className="feature-icon">🖼️</span>
              <h4>Recursos Rotos</h4>
              <p>Imagenes, CSS, JS y fuentes que no cargan o devuelven error</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">🔌</span>
              <h4>APIs Fallidas</h4>
              <p>Llamadas XHR/fetch que fallan, errores CORS, timeouts de API</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">👆</span>
              <h4>Interactividad</h4>
              <p>Botones sin respuesta, enlaces sin destino, elementos no funcionales</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">📭</span>
              <h4>Contenido Vacio</h4>
              <p>Contenedores vacios, errores visibles, fallos de renderizado</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">⏳</span>
              <h4>Carga Diferida</h4>
              <p>Lazy load roto, spinners atascados, imagenes placeholder</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">📋</span>
              <h4>Formularios/Modales</h4>
              <p>Formularios sin envio, modales bloqueantes, banners de cookies</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">🐛</span>
              <h4>Errores de Consola</h4>
              <p>Errores JS, excepciones no capturadas, fallos CORS en runtime</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">⚡</span>
              <h4>Rendimiento</h4>
              <p>TTFB, DOMContentLoaded, carga completa, nodos DOM y recursos</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">♿</span>
              <h4>Accesibilidad</h4>
              <p>Validacion WCAG 2.0 A/AA y 2.1 A/AA con axe-core</p>
            </div>
          </div>
        </section>

        <section className="home-capabilities">
          <h3>Funcionalidades</h3>
          <div className="home-capabilities-grid">
            <div className="capability-card">
              <span className="capability-icon">🔄</span>
              <div>
                <h4>Flujos Interactivos</h4>
                <p>Define secuencias multi-paso: login, busqueda, formularios. Importa scripts de Playwright codegen.</p>
              </div>
            </div>
            <div className="capability-card">
              <span className="capability-icon">📸</span>
              <div>
                <h4>Regresion Visual</h4>
                <p>Compara screenshots entre escaneos con pixelmatch. Detecta cambios visuales no deseados.</p>
              </div>
            </div>
            <div className="capability-card">
              <span className="capability-icon">🤖</span>
              <div>
                <h4>Explicaciones con IA</h4>
                <p>Integracion con Groq LLM para explicar issues detectados con contexto tecnico.</p>
              </div>
            </div>
            <div className="capability-card">
              <span className="capability-icon">📊</span>
              <div>
                <h4>Exportacion de Reportes</h4>
                <p>Descarga reportes completos en JSON y CSV para integrar con otras herramientas.</p>
              </div>
            </div>
          </div>
        </section>

        {recentScans.length > 0 && (
          <section className="home-recent">
            <h3>Análisis recientes</h3>
            <div className="recent-scans-list">
              {recentScans.map((scan) => (
                <div
                  key={scan.id}
                  className="recent-scan-item"
                  onClick={() => scan.status === ScanStatus.COMPLETED && navigate(`/report/${scan.id}`)}
                  style={{ cursor: scan.status === ScanStatus.COMPLETED ? 'pointer' : 'default' }}
                >
                  <div className="recent-scan-url">{scan.url}</div>
                  <div className="recent-scan-meta">
                    <span className={`scan-status-badge status-${scan.status.toLowerCase()}`}>
                      {getStatusLabel(scan.status as ScanStatus)}
                    </span>
                    <span className="recent-scan-date">
                      {new Date(scan.createdAt).toLocaleDateString('es-ES', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="home-footer">
        <p>SiteSentry QA &copy; {new Date().getFullYear()} — Herramienta de QA Funcional para Pruebas Web</p>
      </footer>

      {showFlowEditor && (
        <div className="modal-overlay" onClick={() => setShowFlowEditor(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <FlowEditor
              onSave={(flow) => {
                setInlineFlow(flow);
                setSelectedFlowId('');
                setShowFlowEditor(false);
                scanApi.getFlows().then(setSavedFlows).catch(() => {});
              }}
              onCancel={() => setShowFlowEditor(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function getStatusLabel(status: ScanStatus): string {
  switch (status) {
    case ScanStatus.PENDING: return '⏳ Pendiente';
    case ScanStatus.RUNNING: return '🔄 Ejecutando';
    case ScanStatus.COMPLETED: return '✅ Completado';
    case ScanStatus.FAILED: return '❌ Fallido';
    default: return status;
  }
}
